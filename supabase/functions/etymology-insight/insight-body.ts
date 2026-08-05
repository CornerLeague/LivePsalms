// supabase/functions/etymology-insight/insight-body.ts
// Extracted, side-effect-injected generation logic so it is vitest-testable with
// plain fakes (the index.ts shell wires the real Supabase/OpenAI deps). Returns
// a GenerationOutcome for the shared runGeneration seam. Usage is recorded ONLY on
// a successful insert — cache-hit, no-entry, and model-failure all return usage:null
// so a failure spends no quota and inserts no row (spec §8).
import type { GenerationOutcome } from '../_shared/generation-lifecycle.ts';
import type { UsageCore } from '../_shared/usage.ts';
import { VERSE_INSIGHT_PROMPT_VERSION, type EtymologyInsightContext } from './prompts/verse-insight.ts';
import { applyContentRules } from '../_shared/validators.ts';
import { BANNED_PHRASES, CONTESTED_PASSAGES, GROWTH_BANNED_PHRASES } from '../_shared/voice.ts';

export interface EtymologyEntryFacts {
  lemma: string;
  root: string;
  rootGloss: string;
  development: string;
  related: Array<{ word: string; gloss: string }>;
}

export interface EtymologyInsightBodyDeps {
  loadExistingInsight(strongs: string, verseId: string): Promise<string | null>;
  loadEntry(strongs: string): Promise<EtymologyEntryFacts | null>; // reviewed=true only
  loadVerseText(verseId: string): Promise<{ reference: string; text: string } | null>;
  generate(ctx: EtymologyInsightContext): Promise<{ body: string; modelUsed: string; promptTokens: number; completionTokens: number }>;
  insertInsight(row: {
    strongs: string; verse_id: string; body: string; model_used: string; prompt_version: string; created_by: string;
  }): Promise<void>; // ON CONFLICT (strongs, verse_id) DO NOTHING
  reloadInsight(strongs: string, verseId: string): Promise<string | null>;
}

export async function buildEtymologyInsightOutcome(
  deps: EtymologyInsightBodyDeps,
  args: { strongs: string; verseId: string; userId: string },
): Promise<GenerationOutcome> {
  const { strongs, verseId, userId } = args;

  const existing = await deps.loadExistingInsight(strongs, verseId);
  if (existing) {
    return { response: { ok: true, body: existing, cached: true }, usage: null };
  }

  const entry = await deps.loadEntry(strongs);
  const verse = await deps.loadVerseText(verseId);
  if (!entry || !verse) {
    return { response: { ok: false, reason: 'no_entry' }, usage: null };
  }

  let gen: { body: string; modelUsed: string; promptTokens: number; completionTokens: number };
  try {
    gen = await deps.generate({
      reference: verse.reference,
      verseText: verse.text,
      lemma: entry.lemma,
      root: entry.root,
      rootGloss: entry.rootGloss,
      development: entry.development,
      related: entry.related,
    });
  } catch (err) {
    console.error('[etymology-insight] generate failed', err);
    // No row, no usage → no quota spent (spec §8). Client falls back to Ask + retry.
    return { response: { ok: false, reason: 'generation_failed' }, usage: null };
  }

  // Guardrail parity: verse-insight composes its own system prompt (it does not
  // inherit LAMPLIGHT_SYSTEM_FRAGMENT — the 40-word contract would drown in it),
  // so the shared content-rule families run here on the OUTPUT instead. Regex
  // only; no Layer-C classifier for a ≤40-word descriptive line. A violating
  // body is never inserted into the SHARED global cache — same contract as
  // generation_failed: no row, no usage, no quota spent; client offers retry.
  const content = await applyContentRules(gen.body, {
    banned: BANNED_PHRASES,
    contested: CONTESTED_PASSAGES,
    growth: GROWTH_BANNED_PHRASES,
  });
  if (!content.ok) {
    console.error('[etymology-insight] content rules rejected insight', content.violations);
    return { response: { ok: false, reason: 'validators_failed' }, usage: null };
  }

  await deps.insertInsight({
    strongs, verse_id: verseId, body: gen.body,
    model_used: gen.modelUsed, prompt_version: VERSE_INSIGHT_PROMPT_VERSION, created_by: userId,
  });
  const winner = (await deps.reloadInsight(strongs, verseId)) ?? gen.body;
  const cached = winner !== gen.body; // a conflict-loser reads someone else's winning row

  const usage: UsageCore = {
    model: gen.modelUsed, tokens_in: gen.promptTokens, tokens_out: gen.completionTokens, status: 'ok',
  };
  return { response: { ok: true, body: winner, cached }, usage };
}
