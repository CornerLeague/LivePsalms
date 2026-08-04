import { describe, it, expect } from 'vitest';
import {
  runConnectionWhyPipeline,
  type ConnectionWhyContext,
} from './connection-why-pipeline';
import type { LLMAdapter, GenerateOutput } from '../_shared/openai';

function makeCtx(over: Partial<ConnectionWhyContext> = {}): ConnectionWhyContext {
  return {
    userId: 'u1',
    source: { id: 'note-1', title: 'A', plaintext: 'wilderness fasting...' },
    related: { id: 'note-2', title: 'B', plaintext: 'wilderness exile...' },
    similarity: 0.91,
    compositeHash: 'abc123',
    sharedTags: ['wilderness'],
    sharedVerseRefs: [],
    ...over,
  };
}

function makeLLM(
  responses: Array<{ why: string }>,
  capturedSystems: string[] = [],
): LLMAdapter {
  let i = 0;
  return {
    async generate<T>(input: { system: string }): Promise<GenerateOutput<T>> {
      capturedSystems.push(input.system);
      const r = responses[i++];
      if (!r) throw new Error('no more LLM responses');
      return {
        parsed: r as unknown as T,
        modelUsed: 'gpt-5.6-luna',
        promptTokens: 100,
        completionTokens: 20,
      };
    },
  } as LLMAdapter;
}

interface MaybeSingleResult {
  data: { why: string; content_hash: string } | null;
  error: null;
}

function makeSupabase(opts: {
  cachedRow?: { why: string; content_hash: string };
  upsertCalls?: Array<Record<string, unknown>>;
  usageInserts?: Array<Record<string, unknown>>;
}) {
  const upsertCalls = opts.upsertCalls ?? [];
  const usageInserts = opts.usageInserts ?? [];
  return {
    from(table: string) {
      if (table === 'lamplight_usage') {
        return {
          insert: (row: Record<string, unknown>) => {
            usageInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table !== 'lamplight_connections') {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    async maybeSingle(): Promise<MaybeSingleResult> {
                      return { data: opts.cachedRow ?? null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        async upsert(payload: Record<string, unknown>) {
          upsertCalls.push(payload);
          return { data: null, error: null };
        },
      };
    },
  };
}

describe('runConnectionWhyPipeline', () => {
  it('cache hit returns cached why without LLM call', async () => {
    const captured: string[] = [];
    const llm = makeLLM([], captured);
    const supabase = makeSupabase({
      cachedRow: { why: 'cached!', content_hash: 'abc123' },
    });
    const result = await runConnectionWhyPipeline({
      llm,
      supabase: supabase as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cached).toBe(true);
      expect(result.why).toBe('cached!');
      expect(result.attempts).toBe(0);
      expect(result.usage).toBeNull();
    }
    expect(captured.length).toBe(0);
  });

  it('cache miss generates, validates, upserts', async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const usageInserts: Array<Record<string, unknown>> = [];
    const llm = makeLLM([{ why: 'Both notes return to wilderness.' }]);
    const result = await runConnectionWhyPipeline({
      llm,

      supabase: makeSupabase({ upsertCalls, usageInserts }) as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cached).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.usage).toEqual({
        model: 'gpt-5.6-luna',
        tokens_in: 100,
        tokens_out: 20,
        status: 'ok',
      });
    }
    expect(upsertCalls.length).toBe(1);
    const row = upsertCalls[0];
    expect(row.note_id).toBe('note-1');
    expect(row.related_note_id).toBe('note-2');
    expect(row.content_hash).toBe('abc123');
    expect(row.why).toBe('Both notes return to wilderness.');
    await Promise.resolve(); // drain any stray microtask
    // The pipeline no longer records usage — the lifecycle (runGeneration) does.
    expect(usageInserts).toHaveLength(0);
  });

  it('cache row with stale content_hash falls through to generation', async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const llm = makeLLM([{ why: 'fresh why for new content.' }]);
    const result = await runConnectionWhyPipeline({
      llm,
       
      supabase: makeSupabase({
        cachedRow: { why: 'stale!', content_hash: 'OLD-hash' },
        upsertCalls,
      }) as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cached).toBe(false);
      expect(result.why).toBe('fresh why for new content.');
    }
    expect(upsertCalls.length).toBe(1);
  });

  it('validator-fail-then-retry succeeds on second attempt', async () => {
    const banned = 'God is telling you to wander into the wilderness.';
    const upsertCalls: Array<Record<string, unknown>> = [];
    const llm = makeLLM([
      { why: banned },
      { why: 'Wilderness shows up in both.' },
    ]);
    const result = await runConnectionWhyPipeline({
      llm,
       
      supabase: makeSupabase({ upsertCalls }) as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
    expect(upsertCalls.length).toBe(1);
  });

  it('hard fail: both attempts violate, no persistence', async () => {
    const banned = 'God is telling you to wander.';
    const upsertCalls: Array<Record<string, unknown>> = [];
    const llm = makeLLM([{ why: banned }, { why: banned }]);
    const result = await runConnectionWhyPipeline({
      llm,
       
      supabase: makeSupabase({ upsertCalls }) as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validators_failed');
      expect(result.attempts).toBe(2);
      expect(result.usage).toEqual({
        model: 'gpt-5.6-luna',
        tokens_in: 0,
        tokens_out: 0,
        status: 'error',
        error_code: 'validators_failed',
      });
    }
    expect(upsertCalls.length).toBe(0);
  });

  it('shape violation (>24 words) triggers retry', async () => {
    const longWhy = ('w '.repeat(30)).trim();
    const upsertCalls: Array<Record<string, unknown>> = [];
    const llm = makeLLM([{ why: longWhy }, { why: 'short and clean.' }]);
    const result = await runConnectionWhyPipeline({
      llm,
       
      supabase: makeSupabase({ upsertCalls }) as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it('voice fragment is composed in system prompt without a voice_preference token', async () => {
    const captured: string[] = [];
    const llm = makeLLM([{ why: 'wilderness theme.' }], captured);
    await runConnectionWhyPipeline({
      llm,
      supabase: makeSupabase({}) as unknown as Parameters<typeof runConnectionWhyPipeline>[0]['supabase'],
      ctx: makeCtx({}),
    });
    const sys = captured[0];
    expect(sys).toContain('Lamplight');
    expect(sys).not.toContain('{{voice_preference}}');
  });
});
