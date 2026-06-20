import { describe, it, expect } from 'vitest';
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const ctx: BibleChatContext = {
  passageRef: 'jhn 10',
  passageText: '11 I am the good shepherd.',
  crossRefs: [{ ref: 'psa 23:1', text: 'The LORD is my shepherd.' }],
  notes: [],
  history: [],
  userMessage: 'What does shepherd mean here?',
  allowedNoteIds: new Set(),
  allowedVerseRefs: new Set(['jhn 10:11', 'psa 23:1']),
  bookContext: {
    book: 'John', author: 'John the Apostle (traditional)', authorNote: 'authorship debated',
    dateLabel: '~85–95 AD', region: 'Ephesus (traditional)', culturalContext: 'Greco-Roman',
    genre: 'Gospel', summary: 'The signs and discourses of Jesus.',
  },
};

describe('STUDY_CHAT_PROMPT', () => {
  it('has a versioned id and emits the shared chat-reply tool', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toMatch(/^study-chat-/);
    expect((STUDY_CHAT_PROMPT.tool as { name: string }).name).toBe('emit_chat_reply');
  });
  it('grounds messages in the book context, cross refs, and the question', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(ctx);
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('John the Apostle');
    expect(joined).toContain('psa 23:1');
    expect(joined).toContain('What does shepherd mean here?');
  });
});
