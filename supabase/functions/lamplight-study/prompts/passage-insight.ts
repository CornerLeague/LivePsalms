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
//
// B3 moved the MECHANISM to ./insight-door.ts — the section shape, the ceiling
// derivation, the tool construction, the three tail sentences — so Door 2 shares
// it rather than re-deriving it. The system PROSE stayed here on purpose, and is
// pinned byte-for-byte by passage-insight-bytes.test.ts.
import { STUDY_GROUNDING_RULES, renderStudyGrounding } from './study-chat.ts';
import {
  INSIGHT_CONTESTED_RULE,
  INSIGHT_SECTION_RULES,
  buildInsightTool,
  renderSectionBrief,
  type InsightDoorSpec,
  type InsightSection,
} from './insight-door.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

/**
 * @deprecated for new code — prefer `InsightSection` from ./insight-door.ts.
 * Re-exported so B2's importers keep working unchanged.
 */
export type PassageInsightSection = InsightSection;
export { CHARS_PER_WORD, ceilingFor } from './insight-door.ts';

/** The four sections, in reading order. Order is the order they render. */
export const PASSAGE_INSIGHT_SECTIONS: readonly InsightSection[] = [
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

const SYSTEM = [
  'You are Lamplight Study, writing a short study of one biblical passage for a reader who has just opened it and has not asked anything yet.',
  'This is not a conversation and there is no question to answer. Write the four sections described below, each standing on its own.',
  // The shared rules, composed rather than paraphrased — see STUDY_GROUNDING_RULES.
  ...STUDY_GROUNDING_RULES,
  // ── Contested passages ──
  // Shared with Door 2 — same policy, authored once. Both doors keep the
  // blanket rejection, so the prompt must steer away rather than toward. This
  // is the opposite instruction from study chat's, and deliberately so.
  INSIGHT_CONTESTED_RULE,
  // ── Sections ──
  'Write these four sections:',
  ...PASSAGE_INSIGHT_SECTIONS.map(renderSectionBrief),
  // ── Length, omission, citations ──
  // Shared across doors; see INSIGHT_SECTION_RULES for why all three are
  // load-bearing.
  ...INSIGHT_SECTION_RULES,
].join(' ');

export const PASSAGE_INSIGHT_PROMPT: ChatPromptModule = {
  promptVersion: 'passage-insight-2026-08-06-v1',
  system: SYSTEM,
  // No allowContestedRefs — see the header note.
  tool: buildInsightTool({
    name: 'emit_passage_insight',
    description: 'Return the four sections of the Passage door.',
    sections: PASSAGE_INSIGHT_SECTIONS,
  }),
  buildMessages(ctx: BibleChatContext) {
    // One turn: the shared study grounding, and nothing else. No history, no
    // question — the passage IS the prompt.
    return [{ role: 'user' as const, content: renderStudyGrounding(ctx) }];
  },
};

/**
 * Door 1, as the shared machinery consumes it.
 *
 * `id` is the `door` column value, and it is the ONLY place that string is
 * authored on the server — the cache, the stream orchestration and the eval
 * harness all read it from here rather than repeating a literal.
 */
export const PASSAGE_DOOR_SPEC: InsightDoorSpec = {
  id: 'passage',
  prompt: PASSAGE_INSIGHT_PROMPT,
  sections: PASSAGE_INSIGHT_SECTIONS,
};
