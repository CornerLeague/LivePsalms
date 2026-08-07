// Insights Door 1 — the pipeline.
//
// Composes STUDY grounding (buildStudyContext, via BibleChatContext) with a
// DEVOTION-style multi-field emit: four bounded sections rather than one reply
// string. Neither existing pipeline has both halves — `runBibleChatPipeline`
// has the grounding and a single `reply`, `runDailyDevotionPipeline` has the
// multi-field emit and no chapter apparatus.
//
// Pure of Supabase, exactly like the two it borrows from: it owns the LLM
// control flow and returns data. The cache read/write lives in
// passage-insight-cache.ts and the SSE shell in the edge function.

import type { LLMAdapter, LLMModel, ReasoningEffort } from '../_shared/openai.ts';
import { BANNED_PHRASES, CONTESTED_PASSAGES, GROWTH_BANNED_PHRASES } from '../_shared/voice.ts';
import {
  validateChatReplyCitations,
  applyContentRules,
  formatContentFamilyStricter,
  type Citation,
  type ContentRuleViolation,
} from '../_shared/validators.ts';
import { generateWithRetry } from '../_shared/generate-with-retry.ts';
import { generateStreamingWithRetry } from '../_shared/generate-streaming.ts';
import { verifyArtifactScripture, type ScriptureDeps } from '../_shared/scripture-verify.ts';
import { PASSAGE_INSIGHT_PROMPT, PASSAGE_INSIGHT_SECTIONS } from './prompts/passage-insight.ts';
import type { BibleChatContext, ChatViolations } from '../lamplight-chat/bible-chat-pipeline.ts';
import type { UsageCore } from '../_shared/usage.ts';

/** What `emit_passage_insight` returns: one string per section, plus the door's citations. */
export interface PassageInsightEmit {
  overview: string;
  in_chapter: string;
  chapter_shape: string;
  reflection: string;
  citations: Citation[];
}

/** Section key → body. Every declared section is present; an unwarranted one is ''. */
export type PassageInsightSections = Record<string, string>;

export type PassageInsightResult =
  | {
      ok: true;
      sections: PassageInsightSections;
      citations: Citation[];
      modelUsed: string;
      promptVersion: string;
      attempts: number;
      usage: UsageCore | null;
    }
  // `violations` carries WHY, from the start rather than retrofitted: study
  // chat shipped without it and every failure read as an opaque
  // "validators_failed" until #114 put it back.
  | {
      ok: false;
      reason: 'validators_failed';
      violations: ChatViolations;
      promptVersion: string;
      attempts: number;
      usage: UsageCore | null;
    };

// ── Generation config ────────────────────────────────────────────────────────

/** Design §3: the door is generated once and served to everyone; it gets the deep tier. */
const PASSAGE_INSIGHT_MODEL: LLMModel = 'deep';
const PASSAGE_INSIGHT_EFFORT: ReasoningEffort = 'medium';

/**
 * Output budget. Four sections at their word ceilings is ~570 words ≈ 3,700
 * characters ≈ 950 tokens of prose, and reasoning tokens SHARE this ceiling.
 * Set generously above that: a door truncated by the token budget is the same
 * mid-word failure the whole two-bound design exists to prevent, arriving by a
 * different route.
 */
const PASSAGE_INSIGHT_MAX_TOKENS = 6144;

// ── Section access ───────────────────────────────────────────────────────────

/**
 * Every declared section, in reading order, normalised to a string.
 *
 * A section the model returns empty — or omits altogether — becomes '', which
 * is a first-class answer here: it renders as nothing at all. Defaulting it to
 * a placeholder would put filler exactly where the model had nothing grounded
 * to say.
 */
export function sectionsOf(parsed: PassageInsightEmit): PassageInsightSections {
  const out: PassageInsightSections = {};
  for (const s of PASSAGE_INSIGHT_SECTIONS) {
    const value = (parsed as unknown as Record<string, unknown>)[s.key];
    out[s.key] = typeof value === 'string' ? value : '';
  }
  return out;
}

/** The door's prose as one string, for the content rules and the classifier. */
function flattenSections(sections: PassageInsightSections): string {
  return PASSAGE_INSIGHT_SECTIONS.map((s) => sections[s.key]).filter((b) => b.length > 0).join('\n\n');
}

// ── Validation ───────────────────────────────────────────────────────────────

export function makePassageInsightValidate(
  ctx: BibleChatContext,
  classifier?: (text: string) => Promise<ContentRuleViolation[]>,
  verifyScripture?: ScriptureDeps,
) {
  return async (
    parsed: PassageInsightEmit,
  ): Promise<{ ok: boolean; violations: ChatViolations; repaired?: PassageInsightEmit }> => {
    const sections = sectionsOf(parsed);
    const citations = Array.isArray(parsed.citations) ? parsed.citations : [];

    // The same allowlist check study chat runs, on the same structured shape.
    // Library excerpts never widened `allowedVerseRefs`, so a verse a voice
    // merely mentions is still uncitable here.
    const citation = validateChatReplyCitations(
      { reply: '', citations },
      { allowedNoteIds: ctx.allowedNoteIds, allowedVerseRefs: ctx.allowedVerseRefs },
    );

    const content = await applyContentRules(flattenSections(sections), {
      banned: BANNED_PHRASES,
      // NOT exempted. Study chat passes [] here because a reader asking a hard
      // question deserves labeled readings; Door 1 is descriptive, generated
      // once, and served to everyone from a shared cache.
      contested: CONTESTED_PASSAGES,
      growth: GROWTH_BANNED_PHRASES,
      classifier,
    });

    const violations: ChatViolations = { citation: citation.violations, content: content.violations };
    const baseOk = citation.ok && content.ok;

    // Cheapest gates first; a citation failure makes verification moot.
    if (!baseOk || !verifyScripture) return { ok: baseOk, violations };

    // PER SECTION, never over the flattened text: a repair splices by character
    // offset, and an offset into a join belongs to no section.
    const verified = await Promise.all(
      PASSAGE_INSIGHT_SECTIONS.map((s) =>
        verifyArtifactScripture(verifyScripture, {
          text: sections[s.key],
          translation: verifyScripture.translation,
        }),
      ),
    );

    const repairedSections: PassageInsightSections = {};
    let repairs = 0;
    verified.forEach((result, i) => {
      const key = PASSAGE_INSIGHT_SECTIONS[i].key;
      violations.content.push(...result.violations);
      if (result.repairedText !== undefined) {
        repairedSections[key] = result.repairedText;
        repairs++;
      }
    });

    return {
      ok: verified.every((r) => r.violations.length === 0),
      violations,
      ...(repairs > 0 ? { repaired: { ...parsed, ...repairedSections } } : {}),
    };
  };
}

function formatPassageInsightStricter(violations: ChatViolations): string {
  const parts: string[] = [];
  if (violations.citation.length > 0) {
    parts.push('On retry: the citations array must contain only the verse refs supplied to you, spelled exactly as supplied — or be empty.');
  }
  parts.push(...formatContentFamilyStricter(violations.content));
  return parts.join(' ');
}

// ── Outcome → result mapping ─────────────────────────────────────────────────
// Shared by the buffered and streaming entries so the two can never disagree
// about what a door looks like.

function passageInsightResult(
  outcome: Awaited<ReturnType<typeof generateWithRetry<PassageInsightEmit, ChatViolations>>>,
  promptVersion: string,
): PassageInsightResult {
  if (!outcome.ok) {
    return {
      ok: false,
      reason: 'validators_failed',
      violations: outcome.violations ?? { citation: [], content: [] },
      promptVersion,
      attempts: outcome.attempts,
      usage: { model: outcome.modelUsed, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'validators_failed' },
    };
  }

  return {
    ok: true,
    sections: sectionsOf(outcome.parsed),
    citations: Array.isArray(outcome.parsed.citations) ? outcome.parsed.citations : [],
    modelUsed: outcome.modelUsed,
    promptVersion,
    attempts: outcome.attempts,
    usage: { model: outcome.modelUsed, tokens_in: outcome.promptTokens, tokens_out: outcome.completionTokens, status: 'ok' },
  };
}

/** Everything both entries pass to the retry loop identically. */
function generateConfig(args: {
  llm: LLMAdapter;
  ctx: BibleChatContext;
  model?: LLMModel;
  effort?: ReasoningEffort;
  maxTokens?: number;
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
  verifyScripture?: ScriptureDeps;
}) {
  return {
    llm: args.llm,
    model: args.model ?? PASSAGE_INSIGHT_MODEL,
    effort: args.effort ?? PASSAGE_INSIGHT_EFFORT,
    maxTokens: args.maxTokens ?? PASSAGE_INSIGHT_MAX_TOKENS,
    artifactSystem: PASSAGE_INSIGHT_PROMPT.system,
    messages: PASSAGE_INSIGHT_PROMPT.buildMessages(args.ctx),
    // `as const` on the nested schema produces literal types narrower than
    // ToolSchema.input_schema (Record<string, unknown>); cast is type-only.
    tool: PASSAGE_INSIGHT_PROMPT.tool as Parameters<LLMAdapter['generate']>[0]['tool'],
    validate: makePassageInsightValidate(args.ctx, args.classifier, args.verifyScripture),
    formatStricter: formatPassageInsightStricter,
  };
}

// ── Buffered entry ───────────────────────────────────────────────────────────

export async function runPassageInsightPipeline(args: {
  llm: LLMAdapter;
  ctx: BibleChatContext;
  model?: LLMModel;
  effort?: ReasoningEffort;
  maxTokens?: number;
  /** Layer C doctrinal classifier; injected by the Deno shell, omitted by tests. */
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
  /** Scripture verification with repair-before-reject. Optional at every call site. */
  verifyScripture?: ScriptureDeps;
}): Promise<PassageInsightResult> {
  const outcome = await generateWithRetry<PassageInsightEmit, ChatViolations>(generateConfig(args));
  return passageInsightResult(outcome, PASSAGE_INSIGHT_PROMPT.promptVersion);
}

// ── Streaming entry ──────────────────────────────────────────────────────────
// D3: the reveal is worth it, and Overview lands while the rest fill in. Same
// validate / formatStricter / outcome-mapping tail as the buffered entry.

export interface PassageInsightStreamHandlers {
  onStage: (stage: 'composing') => void;
  onText: (field: string, delta: string) => void;
  onPiece: (field: string, value: unknown) => void;
  onRefining: () => void;
}

/** The four section fields stream as text; `citations` arrives whole. */
export const PASSAGE_INSIGHT_TEXT_FIELDS = PASSAGE_INSIGHT_SECTIONS.map((s) => s.key);

export async function runPassageInsightStreaming(
  args: {
    llm: LLMAdapter;
    ctx: BibleChatContext;
    model?: LLMModel;
    effort?: ReasoningEffort;
    maxTokens?: number;
    classifier?: (text: string) => Promise<ContentRuleViolation[]>;
    verifyScripture?: ScriptureDeps;
    signal?: AbortSignal;
  },
  handlers: PassageInsightStreamHandlers,
): Promise<PassageInsightResult> {
  const outcome = await generateStreamingWithRetry<PassageInsightEmit, ChatViolations>({
    ...generateConfig(args),
    textFields: PASSAGE_INSIGHT_TEXT_FIELDS,
    // No perFieldValidate: the section ceilings live in the tool schema, and a
    // per-field length gate here would reject the ONE thing the design makes
    // first-class — a section that legitimately comes back empty.
    signal: args.signal,
    onStage: handlers.onStage,
    onText: handlers.onText,
    onPiece: handlers.onPiece,
    onRefining: handlers.onRefining,
  });

  return passageInsightResult(outcome, PASSAGE_INSIGHT_PROMPT.promptVersion);
}
