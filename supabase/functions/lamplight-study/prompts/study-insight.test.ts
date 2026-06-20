import { describe, it, expect } from 'vitest';
import { STUDY_INSIGHT_PROMPT } from './study-insight.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const ctx: BibleChatContext = {
  passageRef: 'rom 8', passageText: '1 There is therefore now no condemnation.',
  crossRefs: [], notes: [], history: [], userMessage: '',
  allowedNoteIds: new Set(), allowedVerseRefs: new Set(['rom 8:1']),
  bookContext: null,
};

describe('STUDY_INSIGHT_PROMPT', () => {
  it('versions itself and produces a single user turn with no question', () => {
    expect(STUDY_INSIGHT_PROMPT.promptVersion).toMatch(/^study-insight-/);
    const msgs = STUDY_INSIGHT_PROMPT.buildMessages(ctx);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('rom 8');
  });
});
