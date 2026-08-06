// Monthly reflection pipeline (§6.4–6.5): precheck → generateWithRetry → postGeneration,
// mirroring daily-devotion-pipeline.ts but with two differences that are DESIGN DECISIONS:
//   (1) the write is an UPSERT keyed on (user_id, type, period_key) — the scheduled sweep,
//       on-demand generation, and backfill can all race to produce the same stone;
//   (2) the upsert row OMITS saved_to_notes and updated_at and never touches
//       lamplight_reflection_state — those are client-owned (Task 17).
// Off-list verses are repaired to null (§6.5 abstention), not dropped, in BOTH the
// validate fn and postGeneration. Usage is NOT written here — Task 7's runGeneration does.

import type { LLMAdapter, ToolSchema } from '../_shared/openai.ts';
import type { ReflectionArtifact } from '../_shared/artifacts.ts';
import { generateWithRetry, type RetryOutcome } from '../_shared/generate-with-retry.ts';
import { MONTHLY_PROMPT_VERSION } from '../_shared/reflection-constants.ts';
import {
  MONTHLY_REFLECTION_PROMPT,
  type MonthlyReflectionContext,
} from './prompts/monthly-reflection.ts';
import {
  validateShapeAndBounds,
  validateScriptureAllowlist,
  validateAnchoring,
  validateNoScorecard,
  validateWitnessedNotReopened,
  validateProvenance,
  type ReflectionViolation,
} from '../_shared/reflection-validators.ts';
import { judgeReflectionRegister } from './reflection-judge.ts';
import type { EdgeSupabase } from './reflection-candidates.ts';
import { applyContentRules, type ContentRuleViolation } from '../_shared/validators.ts';
import { BANNED_PHRASES, CONTESTED_PASSAGES, GROWTH_BANNED_PHRASES } from '../_shared/voice.ts';

export type ReflectionPipelineViolation =
  | ReflectionViolation
  | { rule: 'register_judge'; detail: string }
  | { rule: 'content_rules'; detail: string };

// Local usage shape recorded by Task 7's runGeneration. Field names match the daily
// pipeline's usage object (status / model_used / prompt_tokens / completion_tokens / error_code).
export interface ReflectionUsageRecord {
  status: 'ok' | 'error';
  model_used?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  error_code?: string;
}

export type MonthlyReflectionPipelineResult =
  | { ok: true; cached: boolean; artifactId: string; usage: ReflectionUsageRecord | null }
  | { ok: false; reason: 'no_notes' | 'validators_failed'; usage: ReflectionUsageRecord | null };

export interface RunMonthlyReflectionPipelineDeps {
  llm: LLMAdapter;
  supabase: EdgeSupabase;
  ctx: MonthlyReflectionContext | null;
  userId: string;
  periodKey: string;
  // Layer C (P0-5): optional LLM doctrinal classifier for applyContentRules.
  // Injected by the Deno shell / sweep wiring; tests omit it.
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
}

// §6.5 abstention: a marker whose verse is not in the candidate allowlist keeps its
// phrase/date but loses the citation (verse → null). Pure; called twice.
export function repairOffListVerses(artifact: ReflectionArtifact, allowedVerseRefs: Set<string>): ReflectionArtifact {
  return {
    ...artifact,
    markers: artifact.markers.map((m) =>
      m.verse !== null && !allowedVerseRefs.has(m.verse) ? { ...m, verse: null } : m,
    ),
  };
}

// The letter's PROSE surface for content rules: title + letter + marker phrases.
// Marker verse refs are deliberately EXCLUDED — a candidate verse the user
// actually touched may fall inside a contested range (e.g. a highlighted
// Romans 9:16), and a bare ref in a marker carries no interpretation. The
// contested rule polices prose that interprets, not citations the allowlist
// already vetted.
function flattenReflectionProse(artifact: ReflectionArtifact): string {
  return [artifact.title, artifact.letter, ...artifact.markers.map((m) => m.phrase)].join('\n');
}

// The generateWithRetry validate fn: repair off-list verses, run the 6 deterministic
// validators, then content rules (regex + optional Layer-C classifier), and ONLY if
// all pass consult the Layer-3 register judge — cheapest gates first, so a failed
// deterministic check spends no extra model calls.
//
// Slice 1d deliberately does NOT add Scripture verification here. The plan asked
// for an unresolvable_ref check on markers, but that check cannot fire: markers
// carry no quotations (validateScriptureAllowlist forbids verse-level citations
// in the letter, so there is nothing to quote-match), and every marker verse is
// already constrained to ctx.allowedVerseRefs, a set built exclusively from refs
// the database already resolved — transcription flags with status 'found',
// bible_highlights verse ids, and bible_passages candidates. A runtime lookup
// would add a round trip per reflection whose only possible failure mode is an
// internal display/parse mirror bug failing a reader's monthly letter. The
// guarantee is kept deterministically and for free by the allowlist gate below.
export function makeMonthlyReflectionValidate(
  ctx: MonthlyReflectionContext,
  llm: LLMAdapter,
  classifier?: (text: string) => Promise<ContentRuleViolation[]>,
) {
  return async (raw: ReflectionArtifact): Promise<{ ok: boolean; violations: ReflectionPipelineViolation[] }> => {
    const artifact = repairOffListVerses(raw, ctx.allowedVerseRefs);
    const monthNoteIds = ctx.notes.map((n) => n.id);
    const violations: ReflectionPipelineViolation[] = [
      ...validateShapeAndBounds(artifact).violations,
      ...validateScriptureAllowlist(artifact, { allowedVerseRefs: ctx.allowedVerseRefs }).violations,
      ...validateAnchoring(artifact, { monthStart: ctx.monthStart, monthEnd: ctx.monthEnd, allowedNoteDays: ctx.allowedNoteDays }).violations,
      ...validateNoScorecard(artifact.letter).violations,
      ...validateWitnessedNotReopened(artifact, { notes: ctx.notes }).violations,
      ...validateProvenance({ sourceNoteIds: monthNoteIds, monthNoteIds }).violations,
    ];
    if (violations.length > 0) return { ok: false, violations };

    const content = await applyContentRules(flattenReflectionProse(artifact), {
      banned: BANNED_PHRASES,
      contested: CONTESTED_PASSAGES,
      growth: GROWTH_BANNED_PHRASES,
      classifier,
    });
    if (!content.ok) {
      return {
        ok: false,
        violations: content.violations.map((v) => ({
          rule: 'content_rules' as const,
          detail: `${v.family} (${v.rule}): "${v.snippet}"`,
        })),
      };
    }

    const verdict = await judgeReflectionRegister({ llm, artifact, notes: ctx.notes, periodLabel: ctx.periodLabel });
    if (!verdict.pass) {
      return { ok: false, violations: verdict.reasons.map((r) => ({ rule: 'register_judge' as const, detail: r })) };
    }
    return { ok: true, violations: [] };
  };
}

export function formatStricterSuffix(violations: ReflectionPipelineViolation[]): string {
  const bullets = violations.map((v) => `- ${v.rule}: ${v.detail}`).join('\n');
  return (
    `The previous attempt broke these rules:\n${bullets}\n\n` +
    `Keep the voice: witnessed not reopened; no counts; verse-level citations only in markers.`
  );
}

// Idempotency + graceful-floor gate. Returns a terminal result (cached / no_notes) OR
// { notCached } to proceed to generation.
async function reflectionPreCheck(args: {
  supabase: EdgeSupabase;
  userId: string;
  periodKey: string;
  ctx: MonthlyReflectionContext | null;
}): Promise<{ notCached: true; promptVersion: string } | MonthlyReflectionPipelineResult> {
  const { supabase, userId, periodKey, ctx } = args;
  const { data: existing } = await supabase
    .from('lamplight_artifacts')
    .select('id, body, model_used, prompt_version')
    .eq('user_id', userId)
    .eq('type', 'reflection_recap')
    .eq('period_key', periodKey)
    .maybeSingle();
  if (existing) return { ok: true, cached: true, artifactId: existing.id, usage: null };
  if (!ctx || ctx.notes.length === 0) return { ok: false, reason: 'no_notes', usage: null };
  return { notCached: true, promptVersion: MONTHLY_PROMPT_VERSION };
}

async function reflectionPostGeneration(args: {
  supabase: EdgeSupabase;
  userId: string;
  periodKey: string;
  ctx: MonthlyReflectionContext;
  outcome: RetryOutcome<ReflectionArtifact, ReflectionPipelineViolation[]>;
}): Promise<MonthlyReflectionPipelineResult> {
  const { supabase, userId, periodKey, ctx, outcome } = args;
  if (!outcome.ok) {
    return { ok: false, reason: 'validators_failed', usage: { status: 'error', model_used: outcome.modelUsed, error_code: 'validators_failed' } };
  }
  const parsed = repairOffListVerses(outcome.parsed, ctx.allowedVerseRefs);
  const sourceVerses = parsed.markers.map((m) => m.verse).filter((v): v is string => v !== null);

  const { data, error } = await supabase
    .from('lamplight_artifacts')
    .upsert(
      {
        user_id: userId,
        type: 'reflection_recap',
        period_key: periodKey,
        title: parsed.title,
        body: parsed,
        source_note_ids: ctx.notes.map((n) => n.id),
        source_verses: sourceVerses,
        model_used: outcome.modelUsed,
        prompt_version: MONTHLY_PROMPT_VERSION,
      },
      { onConflict: 'user_id,type,period_key' },
    )
    .select('id')
    .single();

  if (error) {
    // Lost the race to a concurrent worker — the row exists; re-select and report cached.
    const { data: existing } = await supabase
      .from('lamplight_artifacts')
      .select('id')
      .eq('user_id', userId)
      .eq('type', 'reflection_recap')
      .eq('period_key', periodKey)
      .single();
    return { ok: true, cached: true, artifactId: existing?.id ?? '', usage: null };
  }

  return {
    ok: true,
    cached: false,
    artifactId: data?.id ?? '',
    usage: { status: 'ok', model_used: outcome.modelUsed, prompt_tokens: outcome.promptTokens, completion_tokens: outcome.completionTokens },
  };
}

export async function runMonthlyReflectionPipeline(deps: RunMonthlyReflectionPipelineDeps): Promise<MonthlyReflectionPipelineResult> {
  const { llm, supabase, ctx, userId, periodKey } = deps;

  const pre = await reflectionPreCheck({ supabase, userId, periodKey, ctx });
  if (!('notCached' in pre)) return pre;
  if (!ctx) return { ok: false, reason: 'no_notes', usage: null };

  const outcome = await generateWithRetry<ReflectionArtifact, ReflectionPipelineViolation[]>({
    llm,
    // The month's letter is the highest-stakes artifact Lamplight writes and it
    // is generated off the cron sweep (nobody is waiting on it), so it gets the
    // flagship tier at high reasoning effort. Reasoning tokens count against
    // maxTokens, hence 8192 for a ≤350-word letter plus markers.
    model: 'deep',
    effort: 'high',
    maxTokens: 8192,
    artifactSystem: MONTHLY_REFLECTION_PROMPT.system,
    systemTokens: { period_label: ctx.periodLabel },
    messages: MONTHLY_REFLECTION_PROMPT.buildMessages(ctx),
    tool: MONTHLY_REFLECTION_PROMPT.tool as unknown as ToolSchema,
    validate: makeMonthlyReflectionValidate(ctx, llm, deps.classifier),
    // One extra attempt vs the default 2: the register judge sits inside validate,
    // so with the default a judge failure consumed the ONLY retry. A monthly
    // artifact earns the extra budget.
    maxAttempts: 3,
    formatStricter: formatStricterSuffix,
  });

  return reflectionPostGeneration({ supabase, userId, periodKey, ctx, outcome });
}
