// Opening study insight (no user question). Same voice as STUDY_CHAT_PROMPT,
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

export const STUDY_INSIGHT_PROMPT: ChatPromptModule = {
  // v3: its own reply ceiling and an explicit word target. It previously
  // inherited journaling's 1400-char ceiling with no length guidance at all,
  // which is the same shape of bug the study-chat eval caught — the model
  // writes to the wall and stops mid-word. 1400 is kept as the ceiling, but it
  // is now a backstop well above the target rather than the target itself.
  promptVersion: 'study-insight-2026-08-06-v3',
  system: SYSTEM,
  tool: makeChatReplyTool({ maxReplyChars: 1400 }),
  buildMessages(ctx: BibleChatContext) {
    // Reuse the chat grounding, drop the trailing question turn.
    const grounded = STUDY_CHAT_PROMPT.buildMessages({ ...ctx, userMessage: '', history: [] });
    return [grounded[0]];
  },
};
