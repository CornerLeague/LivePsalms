// supabase/functions/lamplight-chat/prompts/bible-opener.ts
// Proactive opening insight for a passage. Same ChatReply shape + tool as
// bible-chat, but no user question: it offers ONE grounded observation that
// connects the open passage to the user's own notes, ending in one open prompt.

import type { BibleChatContext, ChatPromptModule } from '../bible-chat-pipeline.ts';
import { BIBLE_CHAT_PROMPT } from './bible-chat.ts';

export const BIBLE_OPENER_PROMPT = {
  promptVersion: 'bible-insight-2026-06-10-v3',

  system: `You are opening a study session on a specific passage. The user has not asked anything yet. Offer ONE short, grounded opening insight (50-110 words). When the user has notes, connect this passage to what they have already written — a pattern they may be too close to see. When they have none, ground the insight in the passage itself.

Rules (these compound your system fragment):
- If the user supplied related notes, lean on them. If NO notes are supplied, OPEN with one short, warm sentence naming that they haven't connected any notes to this passage yet — then offer one sharp, grounded observation about the passage itself. Never invent notes, and never imply you can see notes that were not supplied.
- End with a single open question (≤25 words) to sit with. Not advice. An invitation.
- Do not give pastoral, psychological, medical, financial, or predictive advice. Do not speak prophetically.
- citations: list the passage(s)/note(s) you actually leaned on, using exactly the supplied refs/ids. Empty array if you genuinely used none.
- Never quote more than 25 words verbatim from any single note.`,

  // Reuse the chat tool — identical { reply, citations } shape.
  tool: BIBLE_CHAT_PROMPT.tool,

  buildMessages(ctx: BibleChatContext): Array<{ role: 'user'; content: string }> {
    const passageBlock = `[Open passage ${ctx.passageRef}]\n${ctx.passageText}`;
    const crossRefBlock = ctx.crossRefs.length
      ? `Cross-reference passages:\n${ctx.crossRefs.map((p) => `[${p.ref}]\n${p.text}`).join('\n\n')}`
      : 'Cross-reference passages: (none)';
    const notesBlock = ctx.notes.length
      ? ctx.notes.map((n) => `[note id=${n.id}] ${n.title}\n${n.plaintext}`).join('\n\n')
      : '(the user has no related notes yet)';
    const refsList = [...ctx.allowedVerseRefs].join(', ') || '(none)';
    const noteIdsList = [...ctx.allowedNoteIds].join(', ') || '(none)';

    return [{
      role: 'user',
      content:
        `${passageBlock}\n\n${crossRefBlock}\n\n` +
        `User's related notes:\n${notesBlock}\n\n` +
        `When citing, verses MUST be one of: ${refsList}. Notes MUST be one of: ${noteIdsList}.\n\n` +
        `Offer the opening insight now.`,
    }];
  },
} as const satisfies ChatPromptModule;
