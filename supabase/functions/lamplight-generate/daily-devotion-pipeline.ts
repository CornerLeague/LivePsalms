// Today's Lamp pipeline. Persists to lamplight_artifacts on success;
// idempotent on (user_id, 'daily_devotion', local_date). The retry, no_notes,
// race-handling branches are added in subsequent tasks.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LLMAdapter } from '../_shared/openai.ts';
import type { DailyDevotion } from '../_shared/artifacts.ts';
import {
  BANNED_PHRASES,
  CONTESTED_PASSAGES,
  GROWTH_BANNED_PHRASES,
} from '../_shared/voice.ts';
import {
  validateDailyDevotionCitations,
  applyContentRules,
  applyNameRules,
  flattenDailyDevotionText,
  formatContentFamilyStricter,
  type CitationViolation,
  type ContentRuleViolation,
} from '../_shared/validators.ts';
import { generateWithRetry } from '../_shared/generate-with-retry.ts';
import { generateStreamingWithRetry } from '../_shared/generate-streaming.ts';
import { DAILY_DEVOTION_PROMPT } from './prompts/daily-devotion.ts';
import type { UsageCore } from '../_shared/usage.ts';
import type { LibraryExcerpt } from '../_shared/library-retrieval.ts';

export interface DailyDevotionPassage {
  source_id: string;
  text: string;
  ref: string;
  metadata: Record<string, unknown>;
}

export interface DailyDevotionContext {
  notes: Array<{ id: string; title: string; plaintext: string }>;
  passages: DailyDevotionPassage[];
  localDate: string;
  firstName: string | null;  // sanitizeFirstName(profiles.full_name)
  allowedNoteIds: Set<string>;
  allowedVerseRefs: Set<string>;
  rerankUsed: boolean;
  // Slice 1c. Absent when no library dep was injected or nothing matched.
  // Feeds the prompt silently and the source_library_chunks provenance column.
  libraryExcerpts?: LibraryExcerpt[];
}

export type DailyDevotionPipelineResult =
  | {
      ok: true;
      artifact: DailyDevotion;
      artifact_id: string;
      model_used: string;
      prompt_version: string;
      attempts: number;
      cached: boolean;
      usage: UsageCore | null;
      retrieval?: { note_neighbors: number; bible_passages: number; reranked: boolean };
    }
  | {
      ok: false;
      reason: 'no_notes' | 'validators_failed';
      violations?: { citation: CitationViolation[]; content: ContentRuleViolation[] };
      model_used?: string;
      prompt_version: string;
      attempts: number;
      usage: UsageCore | null;
    };

// ── Shared types ──────────────────────────────────────────────────────────────

type DailyViolations = { citation: CitationViolation[]; content: ContentRuleViolation[] };

// ── Shared generate config ────────────────────────────────────────────────────
// Both buffered and streaming entries use identical validate / formatStricter /
// tool / model / maxTokens. Factor them here so the two entries stay in sync.

function makeDailyDevotionValidate(
  ctx: DailyDevotionContext,
  classifier?: (text: string) => Promise<ContentRuleViolation[]>,
) {
  return async (parsed: DailyDevotion): Promise<{ ok: boolean; violations: DailyViolations }> => {
    const citation = validateDailyDevotionCitations(parsed, {
      allowedNoteIds: ctx.allowedNoteIds,
      allowedVerseRefs: ctx.allowedVerseRefs,
    });
    const content = await applyContentRules(flattenDailyDevotionText(parsed), {
      banned: BANNED_PHRASES,
      contested: CONTESTED_PASSAGES,
      growth: GROWTH_BANNED_PHRASES,
      classifier,
    });
    const nameViolations = applyNameRules({ artifact: parsed, firstName: ctx.firstName });
    return {
      ok: citation.ok && content.ok && nameViolations.length === 0,
      violations: { citation: citation.violations, content: [...content.violations, ...nameViolations] },
    };
  };
}

function formatStricterSuffix(violations: DailyViolations): string {
  const parts: string[] = [];
  if (violations.citation.length > 0) {
    parts.push(
      'On retry: every section MUST cite only refs supplied in the user prompt; note_citations MUST reference only the supplied note ids.',
    );
  }
  parts.push(...formatContentFamilyStricter(violations.content));
  if (violations.content.some(v => v.family === 'name')) {
    parts.push(
      'On retry: use the supplied first name at most twice total across the artifact, never invent or fabricate a salutation, and never combine the name with a Scripture pronouncement.',
    );
  }
  return parts.join(' ');
}

// ── Shared pre-generation logic ───────────────────────────────────────────────
// Returns the cached result if an artifact already exists for (userId, localDate),
// or { notCached: true } to signal the caller should proceed with generation.

type PreCheckResult =
  | { notCached: true; promptVersion: string }
  | ({ ok: true } & Extract<DailyDevotionPipelineResult, { ok: true }>)
  | ({ ok: false } & Extract<DailyDevotionPipelineResult, { ok: false }>);

async function devotionPreCheck(args: {
  supabase: SupabaseClient;
  userId: string;
  localDate: string;
  ctx: DailyDevotionContext | null;
}): Promise<PreCheckResult> {
  const promptVersion = DAILY_DEVOTION_PROMPT.promptVersion;

  // Idempotency: short-circuit if (user, type, period_key) already exists.
  const existing = await args.supabase
    .from('lamplight_artifacts')
    .select('id, body, model_used, prompt_version')
    .eq('user_id', args.userId)
    .eq('type', 'daily_devotion')
    .eq('period_key', args.localDate)
    .maybeSingle();
  if (existing.data) {
    return {
      ok: true,
      artifact: existing.data.body as DailyDevotion,
      artifact_id: existing.data.id as string,
      model_used: (existing.data.model_used as string) ?? 'gpt-5.6-terra',
      prompt_version: (existing.data.prompt_version as string) ?? promptVersion,
      attempts: 0,
      cached: true,
      usage: null,
    };
  }

  if (!args.ctx) {
    return { ok: false, reason: 'no_notes', prompt_version: promptVersion, attempts: 0, usage: null };
  }

  return { notCached: true, promptVersion };
}

// ── Shared post-generation logic ──────────────────────────────────────────────
// Handles the validators_failed branch, persists a clean outcome, and resolves
// INSERT race conditions — identical between buffered and streaming entries.

async function devotionPostGeneration(args: {
  supabase: SupabaseClient;
  userId: string;
  localDate: string;
  ctx: DailyDevotionContext; // guaranteed non-null: pre-check guards it
  promptVersion: string;
  outcome: Awaited<ReturnType<typeof generateWithRetry<DailyDevotion, DailyViolations>>>;
}): Promise<DailyDevotionPipelineResult> {
  const { outcome, ctx, promptVersion } = args;

  if (!outcome.ok) {
    return {
      ok: false,
      reason: 'validators_failed',
      violations: outcome.violations,
      model_used: outcome.modelUsed,
      prompt_version: promptVersion,
      attempts: outcome.attempts,
      usage: { model: outcome.modelUsed, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'validators_failed' },
    };
  }

  const { parsed, modelUsed, promptTokens, completionTokens, attempts } = outcome;
  const usageOk: UsageCore = { model: modelUsed, tokens_in: promptTokens, tokens_out: completionTokens, status: 'ok' };

  const sourceNoteIds = parsed.note_citations.map(c => c.note_id);
  const sourceVerses = [parsed.scripture.ref];
  // Library provenance (slice 1c, migration 059). Heading is SNAPSHOTTED, not
  // referenced: a re-ingest rotates chunk ids, and the panel must still be able
  // to say which excerpt was used. null rather than [] when nothing reached the
  // prompt, so the panel can tell "no library material" from a real empty list.
  const excerpts = ctx.libraryExcerpts ?? [];
  const sourceLibraryChunks = excerpts.length > 0
    ? excerpts.map(e => ({ chunk_id: e.chunkId, source_id: e.sourceId, heading: e.heading }))
    : null;
  const insertRes = await args.supabase
    .from('lamplight_artifacts')
    .insert({
      user_id: args.userId,
      type: 'daily_devotion',
      period_key: args.localDate,
      title: '',
      body: parsed,
      source_note_ids: sourceNoteIds,
      source_verses: sourceVerses,
      source_library_chunks: sourceLibraryChunks,
      model_used: modelUsed,
      prompt_version: promptVersion,
    })
    .select('id')
    .single();

  if (insertRes.error || !insertRes.data) {
    // Race: another request inserted between our pre-check and this INSERT.
    // Re-read the persisted row and return it as cached.
    const refetch = await args.supabase
      .from('lamplight_artifacts')
      .select('id, body, model_used, prompt_version')
      .eq('user_id', args.userId)
      .eq('type', 'daily_devotion')
      .eq('period_key', args.localDate)
      .single();
    if (refetch.error || !refetch.data) {
      throw insertRes.error ?? refetch.error ?? new Error('insert + re-read both failed');
    }
    return {
      ok: true,
      artifact: refetch.data.body as DailyDevotion,
      artifact_id: refetch.data.id as string,
      model_used: (refetch.data.model_used as string) ?? modelUsed,
      prompt_version: (refetch.data.prompt_version as string) ?? promptVersion,
      attempts,
      cached: true,
      usage: usageOk,
    };
  }

  return {
    ok: true,
    artifact: parsed,
    artifact_id: insertRes.data.id as string,
    model_used: modelUsed,
    prompt_version: promptVersion,
    attempts,
    cached: false,
    usage: usageOk,
    retrieval: {
      note_neighbors: ctx.notes.length,
      bible_passages: ctx.passages.length,
      reranked: ctx.rerankUsed,
    },
  };
}

// ── Per-field length gate for the streaming entry ────────────────────────────
// Character lengths are taken verbatim from the tool schema (daily-devotion.ts):
//   opening  80–280, reflection 400–900, prompt 1–200.
// `scripture` and `note_citations` are not length-gated here (structural
// validation happens in the cross-field `validate` step after streaming).
//
// Design call #2: when a length violation occurs, `formatStrickerSuffixWithLengthNote`
// detects it via reference identity against LENGTH_GATE_VIOLATION (a module-level
// sentinel). This is an explicit first-class signal rather than inferring the
// length case by the absence of other violations. The sentinel object is returned
// from `devotionFieldGate` for any out-of-range field. This avoids widening the
// shared ContentRuleViolation.family union (out of scope) while keeping the
// gate's return type as DailyViolations | null. In practice, the model corrects
// length on a second attempt because the tool schema's minLength/maxLength
// constraints remain in the prompt, supplemented by the explicit length reminder.

const LENGTH_GATE_VIOLATION: DailyViolations = { citation: [], content: [] };

function devotionFieldGate(field: string, value: unknown): DailyViolations | null {
  if (typeof value !== 'string') return null;
  const len = value.length;
  if (field === 'opening' && (len < 80 || len > 280)) {
    return LENGTH_GATE_VIOLATION;
  }
  if (field === 'reflection' && (len < 400 || len > 900)) {
    return LENGTH_GATE_VIOLATION;
  }
  if (field === 'prompt' && (len < 1 || len > 200)) {
    return LENGTH_GATE_VIOLATION;
  }
  return null;
}

// ── Buffered entry (unchanged semantics, now calls shared helpers) ─────────────

export async function runDailyDevotionPipeline(args: {
  llm: LLMAdapter;
  supabase: SupabaseClient;
  ctx: DailyDevotionContext | null;
  userId: string;
  localDate: string;
  // Layer C (P0-5): optional LLM doctrinal classifier for applyContentRules.
  // Injected by the Deno shell (makeDoctrinalClassifier); tests omit it.
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
}): Promise<DailyDevotionPipelineResult> {
  const pre = await devotionPreCheck(args);
  if (!('notCached' in pre)) return pre;
  const { promptVersion } = pre;

  const ctx = args.ctx!; // notCached implies ctx is non-null (pre-check guards it)

  const outcome = await generateWithRetry<DailyDevotion, DailyViolations>({
    llm: args.llm,
    model: 'balanced',
    // Tier-default effort ('low'); the budget is raised because reasoning tokens
    // now share the output ceiling with the artifact itself.
    maxTokens: 4096,
    artifactSystem: DAILY_DEVOTION_PROMPT.system,
    systemTokens: { local_date: ctx.localDate },
    messages: DAILY_DEVOTION_PROMPT.buildMessages(ctx),
    // `as const` on the nested schema produces literal types narrower than
    // ToolSchema.input_schema (Record<string, unknown>); cast is type-only.
    tool: DAILY_DEVOTION_PROMPT.tool as unknown as Parameters<LLMAdapter['generate']>[0]['tool'],
    validate: makeDailyDevotionValidate(ctx, args.classifier),
    formatStricter: formatStricterSuffix,
  });

  return devotionPostGeneration({ supabase: args.supabase, userId: args.userId, localDate: args.localDate, ctx, promptVersion, outcome });
}

// ── Streaming entry ───────────────────────────────────────────────────────────
// Uses generateStreamingWithRetry for attempt-1; the same validate/persist/race
// tail is identical to the buffered entry via devotionPostGeneration.

export interface DailyDevotionStreamHandlers {
  onStage: (stage: 'composing') => void;
  onPiece: (field: string, value: unknown) => void;
  onRefining: () => void;
}

export async function runDailyDevotionStreaming(
  args: {
    llm: LLMAdapter;
    supabase: SupabaseClient;
    ctx: DailyDevotionContext | null;
    userId: string;
    localDate: string;
    classifier?: (text: string) => Promise<ContentRuleViolation[]>;
    signal?: AbortSignal;
  },
  handlers: DailyDevotionStreamHandlers,
): Promise<DailyDevotionPipelineResult> {
  const pre = await devotionPreCheck(args);
  if (!('notCached' in pre)) return pre;
  const { promptVersion } = pre;

  const ctx = args.ctx!; // notCached implies ctx is non-null

  const outcome = await generateStreamingWithRetry<DailyDevotion, DailyViolations>({
    llm: args.llm,
    model: 'balanced',
    // Tier-default effort ('low'); the budget is raised because reasoning tokens
    // now share the output ceiling with the artifact itself.
    maxTokens: 4096,
    artifactSystem: DAILY_DEVOTION_PROMPT.system,
    systemTokens: { local_date: ctx.localDate },
    messages: DAILY_DEVOTION_PROMPT.buildMessages(ctx),
    tool: DAILY_DEVOTION_PROMPT.tool as unknown as Parameters<LLMAdapter['generate']>[0]['tool'],
    validate: makeDailyDevotionValidate(ctx, args.classifier),
    formatStricter: formatStrickerSuffixWithLengthNote,
    textFields: [],
    perFieldValidate: devotionFieldGate,
    signal: args.signal,
    onStage: handlers.onStage,
    onPiece: handlers.onPiece,
    onRefining: handlers.onRefining,
  });

  return devotionPostGeneration({ supabase: args.supabase, userId: args.userId, localDate: args.localDate, ctx, promptVersion, outcome });
}

// Stricter suffix for the streaming entry: same as the buffered entry, plus a
// length reminder when the outcome was triggered by the per-field length gate.
// Detected by reference identity against LENGTH_GATE_VIOLATION — an explicit
// first-class signal, not "absence of other violations".
function formatStrickerSuffixWithLengthNote(violations: DailyViolations): string {
  const base = formatStricterSuffix(violations);
  if (violations === LENGTH_GATE_VIOLATION) {
    const lengthReminder = 'On retry: ensure opening is 80–280 characters, reflection 400–900 characters, and prompt 1–200 characters.';
    return base ? `${base} ${lengthReminder}` : lengthReminder;
  }
  return base;
}
