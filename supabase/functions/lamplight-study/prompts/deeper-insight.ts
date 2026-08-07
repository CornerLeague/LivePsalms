// Insights Door 2 — "Deeper In".
//
// Door 1 answers *what is going on in this passage?* Door 2 answers the
// questions a reader arrives at once they know: how do I read this, where did it
// come from, what does it carry, and how does it get misused?
//
// The difference from Door 1 is not depth of tone but KIND OF CLAIM. Door 1's
// sections are readable off the passage and the chapter; three of these four are
// not — they need voices, which is what Phase A1 bought (corpus 34,076 →
// 111,637 chunks, three sources → eight, one broad tradition → five).
//
// Door 2 does NOT set `allowContestedRefs` (Myles, 2026-08-07). Same posture as
// Door 1 and for the same reason: descriptive, generated once, served to
// everyone from a shared cache. The consequence is sharper here — the contested
// list is disproportionately made of chapters whose theology a reader would most
// want — so the prompt has to steer around it deliberately rather than walk into
// it. There is a fixture for exactly that.
//
// The MECHANISM — section shape, ceiling derivation, tool construction, the
// contested rule, the three tail sentences — is shared with Door 1 via
// ./insight-door.ts. This file is the editorial half.
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

/** The section whose §9 constraint is enforced by a validator, not just prose. */
export const READ_WITH_CARE_KEY = 'read_with_care';

/** The four sections, in reading order. Order is the order they render. */
export const DEEPER_INSIGHT_SECTIONS: readonly InsightSection[] = [
  {
    key: 'hermeneutics',
    label: 'How to Read This Passage',
    minWords: 110,
    maxWords: 180,
    brief:
      'what kind of writing this is and the rules that come with it — what the genre is doing, what it claims and does not claim, and what a reader has to hold in mind to read it as it asks to be read',
  },
  {
    key: 'historical_setting',
    label: 'Historical & Cultural Setting',
    minWords: 120,
    maxWords: 200,
    brief:
      'the world this passage came out of — when, where, and to whom, and what its first hearers would have understood that a reader today would miss',
  },
  {
    key: 'theology',
    label: 'Theological Significance',
    minWords: 120,
    maxWords: 200,
    brief:
      "what the passage carries doctrinally and how the church's study has read it, following the supplied voices rather than your own memory of what commentators say",
  },
  {
    // ⚠️ Governed by parent design §9, which is a HARD RULE. See the section
    // rule below, and the validator that backs it.
    key: READ_WITH_CARE_KEY,
    label: 'Read With Care',
    minWords: 70,
    maxWords: 130,
    brief:
      'the interpretive moves this passage invites but does not support — the ways it is commonly misread, and what the text itself does not say',
  },
];

/**
 * §9's constraint on Read With Care, stated to the model.
 *
 * Both halves are load-bearing and neither is optional:
 *
 * - **Moves, never groups.** A caution aimed at a tradition, a denomination or
 *   a group of Christians is forbidden outright. The section is about how the
 *   passage gets misread, never about who misreads it. This half is ALSO
 *   enforced by a section-scoped validator, because a prompt sentence is a
 *   request that usually works, and §9 is a rule.
 * - **Warrant or omit.** A caution with no warrant in the supplied sources or
 *   the passage's own literary data is not written at all. This half cannot be
 *   checked as a property of the string — warrant is a judgement about
 *   grounding — so it rests on the prompt and the omission rule, and is
 *   measured by eval.
 */
const READ_WITH_CARE_RULE = [
  'In Read With Care, write about interpretive moves and never about people. Permitted: reading a verse apart from the context that governs it, treating a word\'s etymology as its meaning, mistaking the genre (a proverb read as a promise, poetry or apocalyptic read as chronology), and reading a modern situation back into a text that does not address it.',
  'Never aim a caution at a tradition, a denomination, or a group of Christians, and do not name one. The section is about how this passage gets misread, never about who misreads it.',
  'A caution you cannot ground in the supplied voices or in the passage\'s own literary data does not belong here. Leave the section empty rather than reaching for a plausible one — this section is shorter than the others because it lists only what the text actually invites.',
].join(' ');

const SYSTEM = [
  'You are Lamplight Study, writing the deeper of two studies of one biblical passage, for a reader who has read what it says and now wants to know how to read it.',
  'This is not a conversation and there is no question to answer. Write the four sections described below, each standing on its own.',
  // Actionable, unlike "do not repeat Door 1" — the model is never shown Door 1,
  // and the two doors cache independently, so a reader may well open this one
  // first. What it CAN do is decline to retell.
  'Do not summarise or retell the passage. Another door does that, and this reader has already read it; start from the assumption that they know what it says and want to know what to make of it.',
  // The shared rules, composed rather than paraphrased — see STUDY_GROUNDING_RULES.
  ...STUDY_GROUNDING_RULES,
  // ── Contested passages ──
  // Shared with Door 1 — same policy, authored once in insight-door.ts.
  INSIGHT_CONTESTED_RULE,
  // ── Sections ──
  'Write these four sections:',
  ...DEEPER_INSIGHT_SECTIONS.map(renderSectionBrief),
  // ── §9 ──
  READ_WITH_CARE_RULE,
  // ── Length, omission, citations ──
  ...INSIGHT_SECTION_RULES,
].join(' ');

export const DEEPER_INSIGHT_PROMPT: ChatPromptModule = {
  // v1 names the first prompt that can actually generate this door.
  promptVersion: 'deeper-insight-2026-08-07-v1',
  system: SYSTEM,
  // No allowContestedRefs — see the header note.
  tool: buildInsightTool({
    name: 'emit_deeper_insight',
    description: 'Return the four sections of the Deeper In door.',
    sections: DEEPER_INSIGHT_SECTIONS,
  }),
  buildMessages(ctx: BibleChatContext) {
    // One turn: the shared study grounding, and nothing else. Identical to
    // Door 1 — the two doors are grounded the same way and differ in what they
    // are asked to make of it.
    return [{ role: 'user' as const, content: renderStudyGrounding(ctx) }];
  },
};

/** Door 2, as the shared machinery consumes it. */
export const DEEPER_DOOR_SPEC: InsightDoorSpec = {
  id: 'deeper',
  prompt: DEEPER_INSIGHT_PROMPT,
  sections: DEEPER_INSIGHT_SECTIONS,
};
