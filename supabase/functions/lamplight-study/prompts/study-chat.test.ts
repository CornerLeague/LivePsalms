import { describe, it, expect } from 'vitest';
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

function baseCtx(overrides: Partial<BibleChatContext> = {}): BibleChatContext {
  return {
    passageRef: 'jhn 10',
    passageText: '11 I am the good shepherd.',
    crossRefs: [],
    notes: [],
    history: [],
    userMessage: 'How does this connect to Psalm 23?',
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set<string>(),
    ...overrides,
  };
}

const ctxFull: BibleChatContext = {
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
  it('bumps the prompt version', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toBe('study-chat-2026-08-04-v3');
  });

  it('renders the related-passages block when present', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx({
      relatedPassages: [{ ref: 'Psalm 23:1', text: 'The LORD is my shepherd' }],
    }));
    const grounding = msgs[0].content;
    expect(grounding).toContain('Related passages from across Scripture:');
    expect(grounding).toContain('- Psalm 23:1: The LORD is my shepherd');
  });

  it('omits the related-passages block when absent or empty', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx({ relatedPassages: [] }));
    expect(msgs[0].content).not.toContain('Related passages from across Scripture:');
    const msgsUndef = STUDY_CHAT_PROMPT.buildMessages(baseCtx());
    expect(msgsUndef[0].content).not.toContain('Related passages from across Scripture:');
  });

  it('keeps the user message as the final turn', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(baseCtx());
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'How does this connect to Psalm 23?' });
  });

  it('has a versioned id and emits the shared chat-reply tool', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toMatch(/^study-chat-/);
    expect((STUDY_CHAT_PROMPT.tool as { name: string }).name).toBe('emit_chat_reply');
  });

  it('grounds messages in the book context, cross refs, and the question', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(ctxFull);
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('John the Apostle');
    expect(joined).toContain('psa 23:1');
    expect(joined).toContain('What does shepherd mean here?');
  });
});
