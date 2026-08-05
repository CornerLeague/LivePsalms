// supabase/functions/_shared/generate-streaming.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { generateStreamingWithRetry } from './generate-streaming';
import type { LLMAdapter } from './openai';

// Fake adapter: generateStream replays scripted field events; generate returns a fixed object.
function fakeLlm(opts: {
  streamFields: Array<{ field: string; value: unknown }>;
  streamParsed: unknown;
  retryParsed?: unknown;
}): LLMAdapter {
  return {
    generate: vi.fn(async () => ({ parsed: opts.retryParsed ?? opts.streamParsed, modelUsed: 'gpt-5.6-terra', promptTokens: 5, completionTokens: 6 })) as any,
    generateStream: vi.fn(async (_input, handlers) => {
      for (const f of opts.streamFields) handlers.onField?.(f.field, f.value);
      return { parsed: opts.streamParsed, modelUsed: 'gpt-5.6-terra', promptTokens: 5, completionTokens: 9 };
    }) as any,
  };
}

const baseCfg = {
  model: 'balanced' as const, maxTokens: 1024, artifactSystem: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
  formatStricter: () => 'stricter',
};

describe('generateStreamingWithRetry', () => {
  it('forwards cfg.effort to the streamed attempt AND the non-streaming retry', async () => {
    const llm = fakeLlm({ streamFields: [], streamParsed: { a: 1 }, retryParsed: { a: 1 } });
    let n = 0;
    await generateStreamingWithRetry({
      ...baseCfg,
      llm,
      effort: 'medium',
      validate: async () => ({ ok: n++ > 0, violations: null }),
    });
    const streamInput = (llm.generateStream as any).mock.calls[0][0];
    const retryInput = (llm.generate as any).mock.calls[0][0];
    expect(streamInput.effort).toBe('medium');
    expect(retryInput.effort).toBe('medium');
  });

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

// ── Slice 1d: a repair after streaming must be announced ─────────────────────
// Both chat clients re-render the reply from the `done` payload
// (LamplightStudyPanel.tsx:162, LamplightChat.tsx:129/242), so a server-side
// repair DOES reach the screen and replaces text the reader already watched
// arrive. A repair passes validation, so the existing refining beat — which
// only fires on the retry path — would not cover it. Announce it explicitly.

// A streamed attempt that emits one text delta (or none) and parses to { text }.
function streamCfg(opts: { emitText?: boolean } = {}) {
  const emitText = opts.emitText ?? true;
  return {
    ...baseCfg,
    llm: {
      generate: vi.fn(async () => ({ parsed: { text: 'retry' }, modelUsed: 'm', promptTokens: 1, completionTokens: 2 })) as any,
      generateStream: vi.fn(async (_input: unknown, handlers: any) => {
        if (emitText) handlers.onText?.('text', 'streamed');
        return { parsed: { text: 'streamed' }, modelUsed: 'm', promptTokens: 1, completionTokens: 2 };
      }) as any,
    } as LLMAdapter,
  };
}

describe('generateStreamingWithRetry — repaired', () => {
  it('returns the repaired artifact and emits refining when text was already on screen', async () => {
    const beats: string[] = [];
    const outcome = await generateStreamingWithRetry({
      ...streamCfg(),
      validate: async () => ({ ok: true, violations: { reasons: [] }, repaired: { text: 'REPAIRED' } }),
      onText: () => { beats.push('text'); },
      onRefining: () => { beats.push('refining'); },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.parsed).toEqual({ text: 'REPAIRED' });
    expect(beats).toContain('refining');
    expect(beats.indexOf('text')).toBeLessThan(beats.indexOf('refining'));
  });

  it('does not flash refining when nothing had been emitted yet', async () => {
    const beats: string[] = [];
    const outcome = await generateStreamingWithRetry({
      ...streamCfg({ emitText: false }),
      validate: async () => ({ ok: true, violations: { reasons: [] }, repaired: { text: 'REPAIRED' } }),
      onRefining: () => { beats.push('refining'); },
    });
    expect(outcome.ok).toBe(true);
    expect(beats).toEqual([]);
  });

  it('does not emit refining when nothing was repaired', async () => {
    const beats: string[] = [];
    await generateStreamingWithRetry({
      ...streamCfg(),
      validate: async () => ({ ok: true, violations: { reasons: [] } }),
      onRefining: () => { beats.push('refining'); },
    });
    expect(beats).toEqual([]);
  });
});
