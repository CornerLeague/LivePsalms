import { describe, it, expect, vi } from 'vitest';
import { streamBibleChat, type BibleChatStreamDeps } from './bible-chat-stream';
import { type BibleChatContext } from './bible-chat-pipeline';
import type { LLMAdapter, GenerateOutput, GenerateStreamInput, StreamHandlers } from '../_shared/openai';

// ── Fixtures (mirrors bible-chat-pipeline.test.ts) ───────────────────────────

const fullReply = 'The shepherd lays down his life for the sheep — a complete act of sacrifice.';
const citations = [{ type: 'verse' as const, ref: 'jhn 10:11' }];

function makeCtx(overrides: Partial<BibleChatContext> = {}): BibleChatContext {
  return {
    passageRef: 'jhn 10',
    passageText: 'I am the good shepherd...',
    crossRefs: [],
    notes: [],
    history: [],
    userMessage: 'What does shepherd mean here?',
    allowedNoteIds: new Set<string>(),
    allowedVerseRefs: new Set(['jhn 10:11']),
    ...overrides,
  };
}

// Streaming LLM adapter (reused from bible-chat-pipeline.test.ts): fires onText
// deltas for the reply field, then onField for reply + citations, returns the
// full parsed result.
function makeStreamAdapter(overrides: { cites?: typeof citations } = {}): LLMAdapter {
  const cites = overrides.cites ?? citations;
  return {
    async generate<U>(): Promise<GenerateOutput<U>> {
      return {
        parsed: { reply: fullReply, citations: cites } as unknown as U,
        modelUsed: 'gpt-5.6-terra',
        promptTokens: 10,
        completionTokens: 20,
      };
    },
    async generateStream<U>(_: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<U>> {
      handlers.onText?.('reply', 'The shepherd lays down ');
      handlers.onText?.('reply', 'his life for the sheep ');
      handlers.onText?.('reply', '— a complete act of sacrifice.');
      handlers.onField?.('reply', fullReply);
      handlers.onField?.('citations', cites);
      return {
        parsed: { reply: fullReply, citations: cites } as unknown as U,
        modelUsed: 'gpt-5.6-terra',
        promptTokens: 10,
        completionTokens: 20,
      };
    },
  };
}

const CORS = { 'access-control-allow-origin': '*' };

async function drainSse(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function makeDeps(overrides: Partial<BibleChatStreamDeps> = {}): BibleChatStreamDeps {
  return {
    cors: CORS,
    isOptedIn: async () => true,
    hasChatAccess: async () => true,
    checkQuota: async () => ({ ok: true }),
    recordUsage: vi.fn(),
    upsertThread: vi.fn(async () => 'thread-1'),
    loadHistory: async () => [],
    persistUserMessage: vi.fn(async () => {}),
    persistAssistant: vi.fn(async () => {}),
    buildContext: async () => makeCtx(),
    llm: makeStreamAdapter(),
    prompt: undefined,
    ...overrides,
  };
}

describe('streamBibleChat', () => {
  it('happy path (chat mode): event-stream, stage → text → done in order, citations piece only', async () => {
    const persistUserMessage = vi.fn(async () => {});
    const persistAssistant = vi.fn(async () => {});
    const recordUsage = vi.fn();
    const res = await streamBibleChat(
      makeDeps({ persistUserMessage, persistAssistant, recordUsage }),
      { userId: 'user-1', mode: 'chat', message: 'Who is the good shepherd?', threadTitle: 't' },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    // user-before-assistant: the writer runs lazily on drain, so the user
    // message is already persisted (it precedes the stream return) but the
    // assistant is not yet.
    expect(persistUserMessage).toHaveBeenCalledTimes(1);
    expect(persistAssistant).not.toHaveBeenCalled();

    const body = await drainSse(res);

    // Order: a stage, then a text after it, then done after that.
    const stageAt = body.indexOf('"t":"stage"');
    const textAt = body.indexOf('"t":"text"');
    const doneAt = body.indexOf('"t":"done"');
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(textAt).toBeGreaterThan(stageAt);
    expect(doneAt).toBeGreaterThan(textAt);

    // text events carry the reply deltas.
    expect(body).toContain('"t":"text"');
    expect(body).toContain('"field":"reply"');

    // Emission policy: a citations piece is emitted; NO reply piece.
    expect(body).toContain('{"t":"piece","field":"citations"');
    expect(body).not.toContain('{"t":"piece","field":"reply"');

    // done payload carries ok / thread_id / reply / citations.
    expect(body).toContain('"t":"done"');
    expect(body).toContain('"ok":true');
    expect(body).toContain('"thread_id":"thread-1"');
    expect(body).toContain('jhn 10:11');

    expect(persistAssistant).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it('not opted in: JSON 403, no stream', async () => {
    const res = await streamBibleChat(
      makeDeps({ isOptedIn: async () => false }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );

    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).not.toBe('text/event-stream');
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json).toEqual({ ok: false, reason: 'not_opted_in' });
  });

  it('no entitlement: JSON 402, no stream', async () => {
    const res = await streamBibleChat(
      makeDeps({ hasChatAccess: async () => false }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );

    expect(res.status).toBe(402);
    expect(res.headers.get('content-type')).not.toBe('text/event-stream');
    const json = await res.json();
    expect(json).toEqual({ ok: false, reason: 'no_entitlement' });
  });

  it('quota exceeded: JSON 429 with aligned contract, no stream', async () => {
    const res = await streamBibleChat(
      makeDeps({ checkQuota: async () => ({ ok: false, reason: 'tier_cap' }) }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).not.toBe('text/event-stream');
    const json = await res.json();
    expect(json).toEqual({ error: 'quota_exceeded', reason: 'tier_cap' });
  });

  it('opener on a non-empty thread: JSON 200 skipped, no stream, no persistence', async () => {
    const persistUserMessage = vi.fn(async () => {});
    const persistAssistant = vi.fn(async () => {});
    const res = await streamBibleChat(
      makeDeps({
        loadHistory: async () => [{ role: 'user', content: 'hi' }],
        persistUserMessage,
        persistAssistant,
      }),
      { userId: 'user-1', mode: 'opener', message: '', threadTitle: 't' },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).not.toBe('text/event-stream');
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json).toEqual({ ok: true, thread_id: 'thread-1', skipped: true });
    expect(persistUserMessage).not.toHaveBeenCalled();
    expect(persistAssistant).not.toHaveBeenCalled();
  });

  it('spreads extraDoneFields into the done payload (study offered_notes)', async () => {
    const res = await streamBibleChat(
      makeDeps({ extraDoneFields: () => ({ offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] }) }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    expect(res.status).toBe(200);
    const body = await drainSse(res);
    expect(body).toContain('"t":"done"');
    expect(body).toContain('"offered_notes"');
    expect(body).toContain('"id":"n1"');
    // base fields still present
    expect(body).toContain('"ok":true');
    expect(body).toContain('"thread_id":"thread-1"');
  });

  it('omits offered_notes from done when extraDoneFields is not provided (bible chat unchanged)', async () => {
    const res = await streamBibleChat(
      makeDeps(),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    const body = await drainSse(res);
    expect(body).toContain('"t":"done"');
    expect(body).not.toContain('offered_notes');
  });

  it('records artifact_kind "bible_study" when artifactKind is provided (study)', async () => {
    const recordUsage = vi.fn();
    const res = await streamBibleChat(
      makeDeps({ recordUsage, artifactKind: 'bible_study' }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    await drainSse(res);
    await Promise.resolve();
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0].artifact_kind).toBe('bible_study');
  });

  it('defaults artifact_kind to "bible_chat" when artifactKind omitted (bible chat unchanged)', async () => {
    const recordUsage = vi.fn();
    const res = await streamBibleChat(
      makeDeps({ recordUsage }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    await drainSse(res);
    await Promise.resolve();
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0][0].artifact_kind).toBe('bible_chat');
  });

  it('forwards deps.model/effort/maxTokens to the LLM call (study passes "deep")', async () => {
    const seen: GenerateStreamInput[] = [];
    const base = makeStreamAdapter();
    const recording: LLMAdapter = {
      generate: base.generate,
      async generateStream<U>(input: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<U>> {
        seen.push(input);
        return base.generateStream<U>(input, handlers);
      },
    };
    const res = await streamBibleChat(
      makeDeps({ llm: recording, model: 'deep', effort: 'low', maxTokens: 4096 }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    await drainSse(res);
    expect(seen.map((i) => i.model)).toEqual(['deep']);
    expect(seen[0].effort).toBe('low');
    expect(seen[0].maxTokens).toBe(4096);
  });

  it('defaults tier "balanced", budget 2048, and no explicit effort when deps omit them', async () => {
    const seen: GenerateStreamInput[] = [];
    const base = makeStreamAdapter();
    const recording: LLMAdapter = {
      generate: base.generate,
      async generateStream<U>(input: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<U>> {
        seen.push(input);
        return base.generateStream<U>(input, handlers);
      },
    };
    const res = await streamBibleChat(
      makeDeps({ llm: recording }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    await drainSse(res);
    expect(seen.map((i) => i.model)).toEqual(['balanced']);
    // undefined effort → the adapter applies TIER_DEFAULT_EFFORT.balanced ('low')
    expect(seen[0].effort).toBeUndefined();
    expect(seen[0].maxTokens).toBe(2048);
  });

  it('validators_failed: error beat, user message persisted, no assistant row', async () => {
    // Cite a verse NOT in allowedVerseRefs so both attempts fail validation.
    const persistUserMessage = vi.fn(async () => {});
    const persistAssistant = vi.fn(async () => {});
    const res = await streamBibleChat(
      makeDeps({
        llm: makeStreamAdapter({ cites: [{ type: 'verse', ref: 'gen 1:1' }] }),
        buildContext: async () => makeCtx({ allowedVerseRefs: new Set<string>() }),
        persistUserMessage,
        persistAssistant,
      }),
      { userId: 'user-1', mode: 'chat', message: 'Who is the good shepherd?', threadTitle: 't' },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const body = await drainSse(res);
    expect(body).toContain('"t":"error"');
    expect(body).toContain('"reason":"validators_failed"');

    expect(persistUserMessage).toHaveBeenCalledTimes(1);
    expect(persistAssistant).not.toHaveBeenCalled();
  });
});
