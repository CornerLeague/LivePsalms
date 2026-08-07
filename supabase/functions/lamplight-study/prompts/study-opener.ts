// The study OPENER (no user question). Same voice as STUDY_CHAT_PROMPT,
// but a much shorter register — and therefore its own ceiling.
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import { makeChatReplyTool } from '../../lamplight-chat/prompts/bible-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const SYSTEM = STUDY_CHAT_PROMPT.system +
  ' The reader has just opened this passage and has not asked anything yet. Offer one short, grounded opening observation that invites deeper study — name a historical-cultural detail, a cross-reference worth following, or an Old-to-New-Testament connection. Keep the non-prophetic voice: a possibility to explore, not a pronouncement.' +
  // Overrides the 200–400 word target inherited from STUDY_CHAT_PROMPT.system.
  // An opener is a doorway, not an answer. Stated explicitly because the two
  // instructions would otherwise contradict each other in the same prompt.
  ' Ignore the word target above: this opener is 60–120 words, two or three sentences. Finish your final sentence.';

export const STUDY_OPENER_PROMPT: ChatPromptModule = {
  // v4. Two changes, both tracking the study system this composes:
  //  · its own reply ceiling and an explicit word target. It previously
  //    inherited journaling's 1400 with no length guidance at all — the same
  //    shape of bug the eval caught on study chat, where the model writes to
  //    the wall and stops mid-word. 1400 stays, now as a backstop above the
  //    target rather than the target itself.
  //  · exempt from the contested-passage rejection, since an opener on a
  //    divided chapter needs the same freedom to name the text — and inherits
  //    the same duty not to settle it.
  // v5: reader-facing refs, inherited. This surface reuses STUDY_CHAT_PROMPT's
  // grounding wholesale, so `displayRefs` changes it here too — same passage
  // opener, "Psalms 27:4" instead of "psa 27:4".
  promptVersion: 'study-insight-2026-08-06-v5',
  system: SYSTEM,
  allowContestedRefs: true,
  tool: makeChatReplyTool({ maxReplyChars: 1400 }),
  buildMessages(ctx: BibleChatContext) {
    // Reuse the chat grounding, drop the trailing question turn.
    const grounded = STUDY_CHAT_PROMPT.buildMessages({ ...ctx, userMessage: '', history: [] });
    return [grounded[0]];
  },
};
