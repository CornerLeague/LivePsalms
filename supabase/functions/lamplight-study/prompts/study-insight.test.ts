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

describe('STUDY_INSIGHT_PROMPT — slice 1c', () => {
  it('bumps its version alongside the study system it composes', () => {
    expect(STUDY_INSIGHT_PROMPT.promptVersion).toBe('study-insight-2026-08-06-v3');
  });

  it('overrides the study word target — an opener is a doorway, not an answer', () => {
    // It composes STUDY_CHAT_PROMPT.system, which asks for 200-400 words. Left
    // unaddressed the two instructions contradict each other in one prompt.
    expect(STUDY_INSIGHT_PROMPT.system).toContain('Ignore the word target above');
    expect(STUDY_INSIGHT_PROMPT.system).toMatch(/60.{0,3}120 words/);
  });

  it('keeps the short-register ceiling, not the study-chat one', () => {
    const reply = (STUDY_INSIGHT_PROMPT.tool as {
      input_schema: { properties: { reply: { maxLength: number } } };
    }).input_schema.properties.reply;
    expect(reply.maxLength).toBe(1400);
  });

  it('inherits the voices block and the naming rules', () => {
    const msgs = STUDY_INSIGHT_PROMPT.buildMessages({
      ...ctx,
      libraryExcerpts: [{
        chunkId: 'lc1', sourceId: 'treasury-of-david',
        sourceLabel: 'The Treasury of David · Charles H. Spurgeon, 1869–1885',
        heading: 'Romans 8:1', content: 'No condemnation — the charter of liberty.', score: 0.8,
      }],
    });
    expect(msgs[0].content).toContain("Voices from the church's study:");
    expect(msgs[0].content).toContain('No condemnation — the charter of liberty.');
    expect(STUDY_INSIGHT_PROMPT.system).toMatch(/name (it|them|the voice)/i);
  });

  it('omits the voices block on a chapter with no library coverage', () => {
    expect(STUDY_INSIGHT_PROMPT.buildMessages(ctx)[0].content).not.toContain('Voices');
  });
});
