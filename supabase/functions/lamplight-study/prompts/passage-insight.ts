// Insights Door 1 — "The Passage".
//
// Four bounded sections rather than one reply string. That shape is deliberate:
// a single `reply` holding four sections would push section boundaries into
// prose the client has to re-parse, and would lose per-section length bounds —
// the exact control whose absence chopped study-chat replies at exactly 1400
// characters, mid-word, with corrupted text at the boundary (2026-08-06 eval).
//
// Door 1 does NOT set `allowContestedRefs`. Study chat has that exemption
// because a reader asking a direct question deserves labeled readings; Door 1 is
// descriptive, generated once, and served to everyone from a shared cache — a
// different risk posture entirely.
import { STUDY_GROUNDING_RULES, renderStudyGrounding } from './study-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

export interface PassageInsightSection {
  key: string;
  label: string;
  minWords: number;
  maxWords: number;
  /** What the section is for, stated to the model in its own words. */
  brief: string;
}

/** The four sections, in reading order. Order is the order they render. */
export const PASSAGE_INSIGHT_SECTIONS: readonly PassageInsightSection[] = [
  {
    key: 'overview',
    label: 'Overview',
    minWords: 90,
    maxWords: 150,
    brief: "the passage's central message, argument, or event — what a reader would most need to grasp first",
  },
  {
    key: 'in_chapter',
    label: 'In the Chapter',
    minWords: 120,
    maxWords: 200,
    brief: 'what sits either side of this passage and why that surrounding material changes how it reads',
  },
  {
    key: 'chapter_shape',
    label: "The Chapter's Shape",
    minWords: 120,
    maxWords: 200,
    brief: "the chapter's structure, movement, and purpose — how it opens, turns, and lands",
  },
  {
    key: 'reflection',
    label: 'Reflection & Application',
    minWords: 80,
    maxWords: 140,
    brief: 'where this lands for a reader today, following from the interpretation above rather than replacing it',
  },
];

/**
 * Mean characters per word in real study prose — **measured**, not assumed:
 * 6.41 across the four replies in `docs/lamplight/evals/2026-08-06-contested-exempt`.
 * Rounded down to 6.4 so the derived ceilings sit slightly generous.
 */
export const CHARS_PER_WORD = 6.4;

/**
 * How far the schema ceiling sits above the word target.
 *
 * The ceiling is a BACKSTOP, never a budget. Without `strict`, the model treats
 * `maxLength` as a limit to write up to, so a ceiling the prompt can reach is a
 * ceiling the prompt will hit mid-word. 1.5× leaves room for a section that runs
 * long to still finish its sentence.
 */
const CEILING_HEADROOM = 1.5;

/**
 * Derive a section's character ceiling from its word target, rounded to a round
 * number for legibility. Derived rather than hand-set so the two can never drift
 * apart — a hand-set pair is how the 1400-char truncation survived unnoticed.
 */
export function ceilingFor(maxWords: number): number {
  return Math.round((maxWords * CHARS_PER_WORD * CEILING_HEADROOM) / 100) * 100;
}

const SYSTEM = [
  'You are Lamplight Study, writing a short study of one biblical passage for a reader who has just opened it and has not asked anything yet.',
  'This is not a conversation and there is no question to answer. Write the four sections described below, each standing on its own.',
  // The shared rules, composed rather than paraphrased — see STUDY_GROUNDING_RULES.
  ...STUDY_GROUNDING_RULES,
  // ── Contested passages ──
  // Door 1 keeps the blanket rejection (no allowContestedRefs), so the prompt
  // must steer away rather than toward. This is the opposite instruction from
  // study chat's, and deliberately so.
  'Where a passage turns on a question the church is genuinely divided about, describe what the text plainly says and note that the question is disputed — then stop. Do not lay out the competing positions and do not adjudicate between them; a reader who wants that should be pointed to Lamplight Study chat and to their own church.',
  // ── Sections ──
  'Write these four sections:',
  ...PASSAGE_INSIGHT_SECTIONS.map(
    (s) => `${s.label} (${s.minWords}–${s.maxWords} words): ${s.brief}.`,
  ),
  // ── Length + omission ──
  // Load-bearing, both halves. A target with no ceiling runs long; a ceiling
  // with no target gets written up to and truncated.
  'Stay inside each word range and finish every sentence you begin — never break off mid-thought to fit.',
  'If the supplied grounding gives you nothing real to say for a section, return it empty. An empty section is a legitimate answer and is rendered as nothing at all; padding it with generalities is worse than omitting it.',
  // ── Citations ──
  // The allowlist validator reads this array, not the prose. A field the prompt
  // never asks for is a field the model fills inconsistently, and an empty
  // citations array passes the allowlist check vacuously.
  'In the citations array, list every verse you actually leaned on across the four sections, using exactly the refs supplied to you. If you genuinely leaned on none, return an empty array.',
].join(' ');

export const PASSAGE_INSIGHT_PROMPT: ChatPromptModule = {
  promptVersion: 'passage-insight-2026-08-06-v1',
  system: SYSTEM,
  // No allowContestedRefs — see the header note.
  tool: {
    name: 'emit_passage_insight',
    description: 'Return the four sections of the Passage door.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: [...PASSAGE_INSIGHT_SECTIONS.map((s) => s.key), 'citations'],
      properties: {
        ...Object.fromEntries(
          PASSAGE_INSIGHT_SECTIONS.map((s) => [
            s.key,
            {
              type: 'string',
              // minLength 0: a section with no warrant must be able to come back
              // empty. Requiring at least one character would force the model to
              // invent filler precisely where it has nothing grounded to say.
              minLength: 0,
              maxLength: ceilingFor(s.maxWords),
              description: `${s.label} — ${s.brief}. Target ${s.minWords}–${s.maxWords} words; empty if unwarranted.`,
            },
          ]),
        ),
        // Door-level, not per-section: the sections are plain strings so the
        // streaming path can emit per-field deltas over them (D3), and a door
        // is cached and invalidated as a unit anyway.
        //
        // `verse` only — Door 1 is generated once and served to everyone from a
        // shared cache, so no reader's notes are ever in scope. Study chat's
        // tool allows `note` because a reader's own vault is grounding there.
        citations: {
          type: 'array',
          description: 'Every verse leaned on across the four sections. Empty if none.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'ref'],
            properties: {
              type: { type: 'string', enum: ['verse'] },
              ref: { type: 'string', description: 'Exactly one of the supplied verse refs.' },
            },
          },
        },
      },
    },
  },
  buildMessages(ctx: BibleChatContext) {
    // One turn: the shared study grounding, and nothing else. No history, no
    // question — the passage IS the prompt.
    return [{ role: 'user' as const, content: renderStudyGrounding(ctx) }];
  },
};
