import { describe, it, expect, vi } from 'vitest';
import { runBibleChatPipeline, runBibleChatStreaming, type BibleChatContext } from './bible-chat-pipeline.ts';
import type { LLMAdapter, GenerateOutput, GenerateStreamInput, StreamHandlers } from '../_shared/openai.ts';
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
      parsed: reply, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20,
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
      modelUsed: 'gpt-5.6-sol', promptTokens: 5, completionTokens: 7,
    });
    const llm = { generate } as unknown as import('../_shared/openai.ts').LLMAdapter;
    const ctx: import('./bible-chat-pipeline.ts').BibleChatContext = {
      passageRef: 'jhn 10', passageText: 'I am the good shepherd.',
      crossRefs: [], notes: [], history: [], userMessage: 'hi',
      allowedNoteIds: new Set(), allowedVerseRefs: new Set(),
    };
    await runBibleChatPipeline({ llm, ctx, model: 'deep' });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'deep' }));
  });
});

describe('runBibleChatStreaming', () => {
  const fullReply = 'The shepherd lays down his life for the sheep — a complete act of sacrifice.';
  const citations = [{ type: 'verse' as const, ref: 'jhn 10:11' }];

  // Build a streaming LLM adapter that fires onText deltas for the reply field,
  // then fires onField for citations, and returns the full parsed result.
  function makeStreamAdapter(): LLMAdapter {
    return {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return {
          parsed: { reply: fullReply, citations } as unknown as U,
          modelUsed: 'gpt-5.6-terra',
          promptTokens: 10,
          completionTokens: 20,
        };
      },
      async generateStream<U>(
        _: GenerateStreamInput,
        handlers: StreamHandlers,
      ): Promise<GenerateOutput<U>> {
        // Replay reply as several text deltas
        handlers.onText?.('reply', 'The shepherd lays down ');
        handlers.onText?.('reply', 'his life for the sheep ');
        handlers.onText?.('reply', '— a complete act of sacrifice.');
        // Fire the full reply field (text field: onField also fires at end)
        handlers.onField?.('reply', fullReply);
        // Fire citations field
        handlers.onField?.('citations', citations);
        return {
          parsed: { reply: fullReply, citations } as unknown as U,
          modelUsed: 'gpt-5.6-terra',
          promptTokens: 10,
          completionTokens: 20,
        };
      },
    };
  }

  it('happy path: onText deltas concatenate to full reply, onPiece fires for citations, result ok', async () => {
    const onStage = vi.fn();
    const onText = vi.fn();
    const onPiece = vi.fn();
    const onRefining = vi.fn();

    const result = await runBibleChatStreaming(
      { llm: makeStreamAdapter(), ctx: baseCtx },
      { onStage, onText, onPiece, onRefining },
    );

    // (a) concatenated onText deltas equal the full reply
    const textDeltas = onText.mock.calls
      .filter((c: [string, string]) => c[0] === 'reply')
      .map((c: [string, string]) => c[1]);
    expect(textDeltas.join('')).toBe(fullReply);

    // (b) onPiece fired for citations
    const citationCall = onPiece.mock.calls.find((c: [string, unknown]) => c[0] === 'citations');
    expect(citationCall).toBeDefined();
    expect(citationCall![1]).toEqual(citations);

    // (c) result is ok with the reply + citations
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reply).toBe(fullReply);
      expect(result.citations).toEqual(citations);
      expect(result.usage?.status).toBe('ok');
      expect(result.attempts).toBe(1);
    }

    // onStage('composing') fired before any text/piece
    expect(onStage).toHaveBeenCalledWith('composing');
    expect(onStage.mock.invocationCallOrder[0]).toBeLessThan(onText.mock.invocationCallOrder[0]);

    // onRefining was NOT fired on a clean first attempt
    expect(onRefining).not.toHaveBeenCalled();
  });

  it('threads the abort signal from runner args into generateStream input', async () => {
    let capturedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return { parsed: { reply: fullReply, citations } as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
      },
      async generateStream<U>(
        input: GenerateStreamInput,
        handlers: StreamHandlers,
      ): Promise<GenerateOutput<U>> {
        capturedSignal = input.signal;
        handlers.onText?.('reply', fullReply);
        handlers.onField?.('reply', fullReply);
        handlers.onField?.('citations', citations);
        return { parsed: { reply: fullReply, citations } as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
      },
    };

    await runBibleChatStreaming(
      { llm, ctx: baseCtx, signal: controller.signal },
      { onStage: vi.fn(), onText: vi.fn(), onPiece: vi.fn(), onRefining: vi.fn() },
    );

    expect(capturedSignal).toBe(controller.signal);
  });

  it('fails after retry when citations never validate', async () => {
    const badCitations = [{ type: 'verse' as const, ref: 'gen 1:1' }]; // not in allowedVerseRefs
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return {
          parsed: { reply: 'A reply.', citations: badCitations } as unknown as U,
          modelUsed: 'gpt-5.6-terra',
          promptTokens: 10,
          completionTokens: 20,
        };
      },
      async generateStream<U>(
        _: GenerateStreamInput,
        handlers: StreamHandlers,
      ): Promise<GenerateOutput<U>> {
        handlers.onText?.('reply', 'A reply.');
        handlers.onField?.('reply', 'A reply.');
        handlers.onField?.('citations', badCitations);
        return {
          parsed: { reply: 'A reply.', citations: badCitations } as unknown as U,
          modelUsed: 'gpt-5.6-terra',
          promptTokens: 10,
          completionTokens: 20,
        };
      },
    };

    const result = await runBibleChatStreaming(
      { llm, ctx: baseCtx },
      { onStage: vi.fn(), onText: vi.fn(), onPiece: vi.fn(), onRefining: vi.fn() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validators_failed');
      expect(result.attempts).toBe(2);
    }
  });
});
