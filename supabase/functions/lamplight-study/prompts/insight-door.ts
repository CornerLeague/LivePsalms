// Insights doors — the shared MECHANISM.
//
// B3's architectural line (design §1): **generic if it is mechanism, per-door if
// it is editorial.** This module is the generic half. Each door's system prose —
// its opening framing, its contested-passage sentence, its section briefs —
// stays assembled in the door's own file, plainly readable, because prompt prose
// is what this repo reviews line by line and version-stamps. A
// `buildSystem(spec)` here would bury the one thing that most needs reading and
// would buy fewer characters, not a safety property.
//
// What lives here is everything a second door must not re-derive: the section
// shape, the ceiling derivation, the tool construction, and the three sentences
// that ARE the two-bound design and the omission rule.

import type { ChatPromptModule } from '../../lamplight-chat/bible-chat-pipeline.ts';

/** One section of a door: a key, a heading, a word target, and a brief. */
export interface InsightSection {
  /** The `section` column value, and the streaming field name. */
  key: string;
  label: string;
  minWords: number;
  maxWords: number;
  /** What the section is for, stated to the model in its own words. */
  brief: string;
}

/**
 * Everything the shared machinery needs to run one door.
 *
 * This is the seam B3 exists to draw: the pipeline, the cache, the stream
 * orchestration and the edge-function shell all take one of these instead of
 * importing Door 1's constants. A second door is a second spec, not a second
 * engine.
 */
export interface InsightDoorSpec {
  /**
   * The `door` column value — 'passage' | 'deeper'. Constrained in the database
   * by migration 061's check, and part of the primary key since the same
   * migration, so two doors on one passage no longer share a row.
   */
  id: string;
  /** The door's own prose, tool and version. Editorial; lives in the door's file. */
  prompt: ChatPromptModule;
  /** Its sections, in reading order. Order is the order they render. */
  sections: readonly InsightSection[];
}

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
 *
 * Shared across doors on purpose: a second door deriving its own ceilings is a
 * second place for that drift to start.
 */
export function ceilingFor(maxWords: number): number {
  return Math.round((maxWords * CHARS_PER_WORD * CEILING_HEADROOM) / 100) * 100;
}

/**
 * The three sentences every door's system prompt ends with, in order.
 *
 * Load-bearing, all three, and shared rather than restated:
 *
 * - **Length.** A target with no ceiling runs long; a ceiling with no target
 *   gets written up to and truncated. Both halves or neither.
 * - **Omission.** A section with no warrant returns empty and renders as
 *   nothing at all. This is the primary defence against pages of mush, and it
 *   is why every section field allows `minLength: 0`.
 * - **Citations.** The allowlist validator reads the structured array, not the
 *   prose. A field the prompt never asks for is a field the model fills
 *   inconsistently — and an empty citations array passes the allowlist
 *   vacuously, which is exactly how it enforced nothing before B2's Task 5.
 */
/**
 * The contested-passage steering sentence, shared by every generated door.
 *
 * Both doors keep the blanket `CONTESTED_PASSAGES` rejection — neither sets
 * `allowContestedRefs` (Door 1: B2; Door 2: Myles, 2026-08-07). Study chat has
 * the exemption because a reader asking a direct question deserves labeled
 * readings; a door is descriptive, generated once, and served to everyone from
 * a shared cache.
 *
 * Because the validator rejects rather than warns, the prompt has to steer AWAY
 * where study chat's steers toward — and it is the same policy for both doors,
 * so it is authored once. Two copies of a sentence this consequential is two
 * chances for them to drift apart.
 */
export const INSIGHT_CONTESTED_RULE =
  'Where a passage turns on a question the church is genuinely divided about, describe what the text plainly says and note that the question is disputed — then stop. Do not lay out the competing positions and do not adjudicate between them; a reader who wants that should be pointed to Lamplight Study chat and to their own church.';

export const INSIGHT_SECTION_RULES: readonly string[] = [
  'Stay inside each word range and finish every sentence you begin — never break off mid-thought to fit.',
  'If the supplied grounding gives you nothing real to say for a section, return it empty. An empty section is a legitimate answer and is rendered as nothing at all; padding it with generalities is worse than omitting it.',
  'In the citations array, list every verse you actually leaned on across the four sections, using exactly the refs supplied to you. If you genuinely leaned on none, return an empty array.',
];

/** The one line that renders a section's word target into the system prompt. */
export function renderSectionBrief(s: InsightSection): string {
  return `${s.label} (${s.minWords}–${s.maxWords} words): ${s.brief}.`;
}

/**
 * The door's emit tool: one bounded string field per section, plus the
 * door-level citations array.
 *
 * Door-level rather than per-section citations: the sections must stay plain
 * strings so the streaming path can emit per-field deltas over them (B2's D3),
 * and a door is cached and invalidated as a unit anyway.
 *
 * `verse` only — a door is generated once and served to everyone from a shared
 * cache, so no reader's notes are ever in scope. Study chat's tool allows `note`
 * because a reader's own vault is grounding there.
 */
export function buildInsightTool(args: {
  name: string;
  description: string;
  sections: readonly InsightSection[];
}) {
  return {
    name: args.name,
    description: args.description,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: [...args.sections.map((s) => s.key), 'citations'],
      properties: {
        ...Object.fromEntries(
          args.sections.map((s) => [
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
  };
}
