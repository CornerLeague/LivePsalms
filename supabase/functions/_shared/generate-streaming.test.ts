// supabase/functions/_shared/generate-streaming.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { generateStreamingWithRetry } from './generate-streaming';
import type { LLMAdapter } from './anthropic';

// Fake adapter: generateStream replays scripted field events; generate returns a fixed object.
function fakeLlm(opts: {
  streamFields: Array<{ field: string; value: unknown }>;
  streamParsed: unknown;
  retryParsed?: unknown;
}): LLMAdapter {
  return {
    generate: vi.fn(async () => ({ parsed: opts.retryParsed ?? opts.streamParsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 5, completionTokens: 6 })) as any,
    generateStream: vi.fn(async (_input, handlers) => {
      for (const f of opts.streamFields) handlers.onField?.(f.field, f.value);
      return { parsed: opts.streamParsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 5, completionTokens: 9 };
    }) as any,
  };
}

const baseCfg = {
  model: 'sonnet' as const, maxTokens: 1024, artifactSystem: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
  formatStricter: () => 'stricter',
};

describe('generateStreamingWithRetry', () => {
  it('emits pieces as fields complete and returns ok when validate passes', async () => {
    const pieces: string[] = [];
    const out = await generateStreamingWithRetry({
      ...baseCfg,
      llm: fakeLlm({ streamFields: [{ field: 'opening', value: 'hi' }, { field: 'prompt', value: 'q' }], streamParsed: { opening: 'hi', prompt: 'q' } }),
      validate: async () => ({ ok: true, violations: null }),
      onPiece: (f) => pieces.push(f),
    });
    expect(pieces).toEqual(['opening', 'prompt']);
    expect(out.ok).toBe(true);
  });

  it('calls onRefining and retries when a cross-field validator fails after pieces showed', async () => {
    const refining = vi.fn();
    let calls = 0;
    const out = await generateStreamingWithRetry({
      ...baseCfg,
      llm: fakeLlm({ streamFields: [{ field: 'opening', value: 'hi' }], streamParsed: { opening: 'hi' }, retryParsed: { opening: 'fixed' } }),
      validate: async () => { calls++; return calls === 1 ? { ok: false, violations: ['bad'] } : { ok: true, violations: null }; },
      onRefining: refining,
    });
    expect(refining).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });

  it('suppresses a field that fails its per-field gate (no onPiece) and retries', async () => {
    const pieces: string[] = [];
    const refining = vi.fn();
    const out = await generateStreamingWithRetry({
      ...baseCfg,
      llm: fakeLlm({ streamFields: [{ field: 'reflection', value: 'too short' }], streamParsed: { reflection: 'too short' }, retryParsed: { reflection: 'long enough now' } }),
      perFieldValidate: (f, v) => (f === 'reflection' && String(v).length < 10 ? ['too_short'] : null),
      validate: async () => ({ ok: true, violations: null }),
      onPiece: (f) => pieces.push(f),
      onRefining: refining,
    });
    expect(pieces).not.toContain('reflection'); // suppressed on attempt 1
    expect(refining).toHaveBeenCalled();
    expect(out.ok).toBe(true);
  });
});
