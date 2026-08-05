// Opening study insight (no user question). Same tool + voice as STUDY_CHAT_PROMPT.
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const SYSTEM = STUDY_CHAT_PROMPT.system +
  ' The reader has just opened this passage and has not asked anything yet. Offer one short, grounded opening observation that invites deeper study — name a historical-cultural detail, a cross-reference worth following, or an Old-to-New-Testament connection. Keep the non-prophetic voice: a possibility to explore, not a pronouncement.';

export const STUDY_INSIGHT_PROMPT: ChatPromptModule = {
  // Bumped with slice 1c: this system composes STUDY_CHAT_PROMPT.system, and
  // buildMessages inherits its voices/lexicon blocks, so both changed here too.
  promptVersion: 'study-insight-2026-08-06-v2',
  system: SYSTEM,
  tool: STUDY_CHAT_PROMPT.tool,
  buildMessages(ctx: BibleChatContext) {
    // Reuse the chat grounding, drop the trailing question turn.
    const grounded = STUDY_CHAT_PROMPT.buildMessages({ ...ctx, userMessage: '', history: [] });
    return [grounded[0]];
  },
};
