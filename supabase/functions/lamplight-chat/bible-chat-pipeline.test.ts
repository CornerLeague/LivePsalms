import { describe, it, expect, vi } from 'vitest';
import { runBibleChatPipeline, type BibleChatContext } from './bible-chat-pipeline.ts';
import type { LLMAdapter } from '../_shared/anthropic.ts';
import { BIBLE_INSIGHT_PROMPT } from './prompts/bible-insight.ts';

const baseCtx: BibleChatContext = {
  passageRef: 'jhn 10',
  passageText: 'I am the good shepherd...',
  crossRefs: [],
  notes: [{ id: 'note-1', title: 'Psalm 23 study', plaintext: 'rest as trust' }],
  history: [],
  userMessage: 'What does shepherd mean here?',
  allowedNoteIds: new Set(['note-1']),
  allowedVerseRefs: new Set(['jhn 10:11']),
};

function fakeLLM(reply: unknown): LLMAdapter {
  return {
    generate: vi.fn().mockResolvedValue({
      parsed: reply, modelUsed: 'claude-sonnet-4-6', promptTokens: 10, completionTokens: 20,
    }),
  } as unknown as LLMAdapter;
}

describe('runBibleChatPipeline', () => {
  it('returns the validated reply on a clean generation', async () => {
    const llm = fakeLLM({ reply: 'The shepherd lays down his life.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] });
    const out = await runBibleChatPipeline({ llm, ctx: baseCtx });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.reply).toContain('shepherd');
      expect(out.citations).toEqual([{ type: 'verse', ref: 'jhn 10:11' }]);
      expect(out.usage?.status).toBe('ok');
    }
  });

  it('fails after retry when citations never validate', async () => {
    const llm = fakeLLM({ reply: 'x', citations: [{ type: 'verse', ref: 'gen 1:1' }] });
    const out = await runBibleChatPipeline({ llm, ctx: baseCtx });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('validators_failed');
    expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2); // one retry
  });

  it('runs with an injected prompt module (insight) and still validates', async () => {
    const llm = fakeLLM({ reply: 'A quiet opening thought on the shepherd.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] });
    const out = await runBibleChatPipeline({ llm, ctx: baseCtx, prompt: BIBLE_INSIGHT_PROMPT });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.promptVersion).toBe(BIBLE_INSIGHT_PROMPT.promptVersion);
  });

  it('uses the bumped insight prompt version', () => {
    expect(BIBLE_INSIGHT_PROMPT.promptVersion).toBe('bible-insight-2026-06-10-v3');
  });

  it('runs the insight path cleanly with an empty-notes context', async () => {
    const emptyNotesCtx: BibleChatContext = {
      ...baseCtx,
      notes: [],
      allowedNoteIds: new Set<string>(),
      userMessage: '',
    };
    // buildMessages must still emit the no-notes marker the model relies on.
    const msg = BIBLE_INSIGHT_PROMPT.buildMessages(emptyNotesCtx)[0].content;
    expect(msg).toContain('no related notes yet');

    const llm = fakeLLM({
      reply: 'You haven’t connected any notes here yet — still, the shepherd lays down his life freely.',
      citations: [{ type: 'verse', ref: 'jhn 10:11' }],
    });
    const out = await runBibleChatPipeline({ llm, ctx: emptyNotesCtx, prompt: BIBLE_INSIGHT_PROMPT });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.citations).toEqual([{ type: 'verse', ref: 'jhn 10:11' }]);
  });

  it('passes the requested model through to the LLM adapter', async () => {
    const generate = vi.fn().mockResolvedValue({
      parsed: { reply: 'ok', citations: [] },
      modelUsed: 'claude-opus-4-8', promptTokens: 5, completionTokens: 7,
    });
    const llm = { generate } as unknown as import('../_shared/anthropic.ts').LLMAdapter;
    const ctx: import('./bible-chat-pipeline.ts').BibleChatContext = {
      passageRef: 'jhn 10', passageText: 'I am the good shepherd.',
      crossRefs: [], notes: [], history: [], userMessage: 'hi',
      allowedNoteIds: new Set(), allowedVerseRefs: new Set(),
    };
    await runBibleChatPipeline({ llm, ctx, model: 'opus' });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
  });
});
