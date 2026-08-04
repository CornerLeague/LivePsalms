import { describe, it, expect, vi } from 'vitest';
import { runDailyDevotionPipeline, runDailyDevotionStreaming, type DailyDevotionContext } from './daily-devotion-pipeline';
import type { LLMAdapter, GenerateOutput, GenerateStreamInput, StreamHandlers } from '../_shared/openai';
import type { DailyDevotion } from '../_shared/artifacts';

function makeCtx(overrides: Partial<DailyDevotionContext> = {}): DailyDevotionContext {
  return {
    notes: [{ id: 'note-1', title: 'On rest', plaintext: 'I have been weary lately.' }],
    passages: [{
      source_id: 'psa.23.4',
      text: 'Even though I walk through the valley of the shadow of death…',
      ref: 'Psalm 23:4',
      metadata: { book: 'Psalm', chapter: 23 },
    }],
    localDate: '2026-05-27',
    firstName: null,
    allowedNoteIds: new Set(['note-1']),
    allowedVerseRefs: new Set(['Psalm 23:4']),
    rerankUsed: false,
    ...overrides,
  };
}

function makeAdapter<T>(responses: T[]): LLMAdapter {
  let i = 0;
  return {
    async generate<U>(): Promise<GenerateOutput<U>> {
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
    },
  };
}

const cleanArtifact: DailyDevotion = {
  opening: 'A quiet greeting. Welcome back; the lamp is lit and the day is yours.',
  scripture: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley of the shadow of death…' },
  reflection: 'This passage may speak to weariness. The shepherd does not pull the weary forward but walks beside them through the valley. Scripture suggests that fear, in this verse, is not banished but accompanied. For someone walking through what you have described, this verse often becomes less a promise to be fearless than an invitation to be unalone. The rod and the staff are not weapons against your weariness — they are signs that you have not been left.',
  prompt: 'What part of being accompanied through the valley reaches you today?',
  note_citations: [{ note_id: 'note-1', reason: 'recurring weariness across recent notes' }],
};

function makeSupabaseMock(opts: {
  existing?: DailyDevotion | null;
  insertedId?: string;
  insertError?: { code?: string; message: string } | null;
} = {}) {
  const existing = opts.existing ?? null;
  const insertedId = opts.insertedId ?? 'artifact-1';
  const insertError = opts.insertError ?? null;
  const inserts: Array<Record<string, unknown>> = [];
  const usageInserts: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table === 'lamplight_usage') {
        return {
          insert: (row: Record<string, unknown>) => {
            usageInserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                async maybeSingle() {
                  if (existing) {
                    return { data: { id: 'cached-id', body: existing, model_used: 'gpt-5.6-terra', prompt_version: 'daily-devotion-2026-05-27-v1' }, error: null };
                  }
                  return { data: null, error: null };
                },
                async single() {
                  if (existing) {
                    return { data: { id: 'cached-id', body: existing, model_used: 'gpt-5.6-terra', prompt_version: 'daily-devotion-2026-05-27-v1' }, error: null };
                  }
                  return { data: null, error: { message: 'no row' } };
                },
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return {
            select: () => ({
              async single() {
                if (insertError) return { data: null, error: insertError };
                return { data: { id: insertedId }, error: null };
              },
            }),
          };
        },
      };
    },
  };
  return { supabase: supabase as unknown as Parameters<typeof runDailyDevotionPipeline>[0]['supabase'], inserts, usageInserts };
}

describe('runDailyDevotionPipeline', () => {
  it('idempotency: returns cached artifact when one already exists, no LLM call', async () => {
    const { supabase, inserts } = makeSupabaseMock({ existing: cleanArtifact });
    let llmCalls = 0;
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        llmCalls++;
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'm', promptTokens: 0, completionTokens: 0 };
      },
    };
    const result = await runDailyDevotionPipeline({
      llm,
      supabase,
      ctx: makeCtx(),
      userId: 'user-1',
      localDate: '2026-05-27',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cached).toBe(true);
      expect(result.attempts).toBe(0);
      expect(result.artifact_id).toBe('cached-id');
      expect(result.usage).toBeNull();
    }
    expect(llmCalls).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('no_notes: when ctx is null, returns ok:false reason:no_notes with attempts:0, no LLM call', async () => {
    const { supabase, inserts } = makeSupabaseMock();
    let llmCalls = 0;
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        llmCalls++;
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'm', promptTokens: 0, completionTokens: 0 };
      },
    };
    const result = await runDailyDevotionPipeline({
      llm,
      supabase,
      ctx: null,
      userId: 'user-1',
      localDate: '2026-05-27',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_notes');
      expect(result.attempts).toBe(0);
    }
    expect(llmCalls).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('happy path: generates, validates, persists, returns ok with artifact_id', async () => {
    const { supabase, inserts, usageInserts } = makeSupabaseMock();
    const result = await runDailyDevotionPipeline({
      llm: makeAdapter([cleanArtifact]),
      supabase,
      ctx: makeCtx(),
      userId: 'user-1',
      localDate: '2026-05-27',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact_id).toBe('artifact-1');
      expect(result.attempts).toBe(1);
      expect(result.cached).toBe(false);
      expect(result.artifact.scripture.ref).toBe('Psalm 23:4');
      expect(result.usage).toEqual({
        model: 'gpt-5.6-terra',
        tokens_in: 10,
        tokens_out: 20,
        status: 'ok',
      });
    }
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: 'user-1',
      type: 'daily_devotion',
      period_key: '2026-05-27',
      source_note_ids: ['note-1'],
      source_verses: ['Psalm 23:4'],
      prompt_version: 'daily-devotion-2026-06-09-v3',
    });
    await Promise.resolve(); // drain any stray microtask
    // The pipeline no longer records usage — the lifecycle (runGeneration) does.
    expect(usageInserts).toHaveLength(0);
  });

  it('composed system prompt: LAMPLIGHT_SYSTEM_FRAGMENT first, artifact stance second, {{local_date}} substituted, stricter suffix only on retry', async () => {
    const dirty: DailyDevotion = {
      ...cleanArtifact,
      scripture: { ref: 'Made Up 1:1', text: 'fake passage' },
    };
    const { supabase } = makeSupabaseMock();
    const capturedSystems: string[] = [];
    const llm: LLMAdapter = {
      async generate<U>(input: Parameters<LLMAdapter['generate']>[0]): Promise<GenerateOutput<U>> {
        capturedSystems.push(input.system);
        const next = capturedSystems.length === 1 ? dirty : cleanArtifact;
        return { parsed: next as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 1, completionTokens: 1 };
      },
    };
    await runDailyDevotionPipeline({
      llm,
      supabase,
      ctx: makeCtx(),
      userId: 'user-1',
      localDate: '2026-05-27',
    });

    expect(capturedSystems).toHaveLength(2);
    // Voice fragment composed first.
    expect(capturedSystems[0]).toMatch(/You are Lamplight/);
    expect(capturedSystems[0]).toMatch(/illumination, not pronouncement/);
    // Artifact stance composed second.
    expect(capturedSystems[0]).toMatch(/Write a brief daily devotion/);
    // {{local_date}} substituted, not left as a placeholder.
    expect(capturedSystems[0]).toContain('Today is 2026-05-27.');
    expect(capturedSystems[0]).not.toContain('{{local_date}}');
    // No stricter suffix on first attempt.
    expect(capturedSystems[0]).not.toMatch(/On retry:/);
    // Stricter suffix present on retry.
    expect(capturedSystems[1]).toMatch(/On retry:/);
  });

  it('validator-fail-then-retry: first attempt has unknown verse ref, second is clean, ok:true attempts:2', async () => {
    const dirty: DailyDevotion = {
      ...cleanArtifact,
      scripture: { ref: 'Made Up 1:1', text: 'fake passage' },
    };
    const { supabase, inserts } = makeSupabaseMock();
    const result = await runDailyDevotionPipeline({
      llm: makeAdapter([dirty, cleanArtifact]),
      supabase,
      ctx: makeCtx(),
      userId: 'user-1',
      localDate: '2026-05-27',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
      expect(result.cached).toBe(false);
    }
    expect(inserts).toHaveLength(1);
  });

  it('race: INSERT conflict triggers re-read; returns cached:true with the existing row', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const supabase = {
      from(table: string) {
        if (table === 'lamplight_usage') {
          return {
            insert: () => Promise.resolve({ error: null }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                  async single() {
                    return {
                      data: {
                        id: 'race-id',
                        body: cleanArtifact,
                        model_used: 'gpt-5.6-terra',
                        prompt_version: 'daily-devotion-2026-06-09-v3',
                      },
                      error: null,
                    };
                  },
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return {
              select: () => ({
                async single() {
                  return { data: null, error: { code: '23505', message: 'unique violation' } };
                },
              }),
            };
          },
        };
      },
    } as unknown as Parameters<typeof runDailyDevotionPipeline>[0]['supabase'];

    const result = await runDailyDevotionPipeline({
      llm: makeAdapter([cleanArtifact]),
      supabase,
      ctx: makeCtx(),
      userId: 'user-1',
      localDate: '2026-05-27',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cached).toBe(true);
      expect(result.artifact_id).toBe('race-id');
    }
    expect(inserts).toHaveLength(1);
  });

  it('hard-fail: both attempts violate → ok:false validators_failed, no row inserted', async () => {
    const banned: DailyDevotion = {
      ...cleanArtifact,
      reflection: 'God is telling you to forgive him. ' + cleanArtifact.reflection,
    };
    const { supabase, inserts } = makeSupabaseMock();
    const result = await runDailyDevotionPipeline({
      llm: makeAdapter([banned, banned]),
      supabase,
      ctx: makeCtx(),
      userId: 'user-1',
      localDate: '2026-05-27',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('validators_failed');
      expect(result.attempts).toBe(2);
      expect(result.violations?.content.some(v => v.family === 'banned')).toBe(true);
      expect(result.usage).toEqual({
        model: 'gpt-5.6-terra',
        tokens_in: 0,
        tokens_out: 0,
        status: 'error',
        error_code: 'validators_failed',
      });
    }
    expect(inserts).toHaveLength(0);
  });
});

describe('runDailyDevotionStreaming', () => {
  // A fixture that satisfies the streaming length gate:
  //   opening 80–280 chars, reflection 400–900 chars, prompt 1–200 chars.
  // cleanArtifact.opening is 69 chars (fails the 80-char floor), so we extend it.
  const streamArtifact: DailyDevotion = {
    ...cleanArtifact,
    opening: 'A quiet greeting, and an arresting thread from your notes: the lamp is lit and the day is yours.',
  };

  // Build a streaming LLM adapter that fires onField for each of the five
  // daily-devotion fields in order, then returns the full parsed artifact.
  function makeStreamAdapter(artifact: DailyDevotion): LLMAdapter {
    return {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return { parsed: artifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
      },
      async generateStream<U>(
        _: GenerateStreamInput,
        handlers: StreamHandlers,
      ): Promise<GenerateOutput<U>> {
        // Replay fields in schema-declared order
        handlers.onField?.('opening', artifact.opening);
        handlers.onField?.('scripture', artifact.scripture);
        handlers.onField?.('reflection', artifact.reflection);
        handlers.onField?.('prompt', artifact.prompt);
        handlers.onField?.('note_citations', artifact.note_citations);
        return { parsed: artifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
      },
    };
  }

  it('happy path: onPiece fires for each field in order, result persists', async () => {
    const { supabase, inserts } = makeSupabaseMock();
    const onStage = vi.fn();
    const onPiece = vi.fn();
    const onRefining = vi.fn();

    const result = await runDailyDevotionStreaming(
      {
        llm: makeStreamAdapter(streamArtifact),
        supabase,
        ctx: makeCtx(),
        userId: 'user-1',
        localDate: '2026-05-27',
      },
      { onStage, onPiece, onRefining },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact_id).toBe('artifact-1');
      expect(result.attempts).toBe(1);
      expect(result.cached).toBe(false);
      expect(result.artifact.scripture.ref).toBe('Psalm 23:4');
    }

    // onPiece should have fired once per field, in order
    expect(onPiece).toHaveBeenCalledTimes(5);
    const calls = onPiece.mock.calls;
    expect(calls[0][0]).toBe('opening');
    expect(calls[1][0]).toBe('scripture');
    expect(calls[2][0]).toBe('reflection');
    expect(calls[3][0]).toBe('prompt');
    expect(calls[4][0]).toBe('note_citations');

    // onStage composing was fired BEFORE the first onPiece (contract: stage fires before any field)
    expect(onStage).toHaveBeenCalledWith('composing');
    expect(onStage.mock.invocationCallOrder[0]).toBeLessThan(onPiece.mock.invocationCallOrder[0]);

    // onRefining was NOT fired on a clean first-attempt
    expect(onRefining).not.toHaveBeenCalled();

    // artifact was persisted
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: 'user-1',
      type: 'daily_devotion',
      period_key: '2026-05-27',
    });
  });

  it('threads the abort signal from runner args into generateStream input', async () => {
    const { supabase } = makeSupabaseMock();
    let capturedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return { parsed: streamArtifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
      },
      async generateStream<U>(
        input: GenerateStreamInput,
        handlers: StreamHandlers,
      ): Promise<GenerateOutput<U>> {
        capturedSignal = input.signal;
        handlers.onField?.('opening', streamArtifact.opening);
        handlers.onField?.('scripture', streamArtifact.scripture);
        handlers.onField?.('reflection', streamArtifact.reflection);
        handlers.onField?.('prompt', streamArtifact.prompt);
        handlers.onField?.('note_citations', streamArtifact.note_citations);
        return { parsed: streamArtifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
      },
    };

    await runDailyDevotionStreaming(
      { llm, supabase, ctx: makeCtx(), userId: 'user-1', localDate: '2026-05-27', signal: controller.signal },
      { onStage: vi.fn(), onPiece: vi.fn(), onRefining: vi.fn() },
    );

    expect(capturedSignal).toBe(controller.signal);
  });

  it('idempotency: returns cached artifact when one already exists, no stream call', async () => {
    const { supabase, inserts } = makeSupabaseMock({ existing: cleanArtifact });
    let streamCalls = 0;
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'm', promptTokens: 0, completionTokens: 0 };
      },
      async generateStream<U>(): Promise<GenerateOutput<U>> {
        streamCalls++;
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'm', promptTokens: 0, completionTokens: 0 };
      },
    };
    const result = await runDailyDevotionStreaming(
      { llm, supabase, ctx: makeCtx(), userId: 'user-1', localDate: '2026-05-27' },
      { onStage: vi.fn(), onPiece: vi.fn(), onRefining: vi.fn() },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cached).toBe(true);
      expect(result.artifact_id).toBe('cached-id');
    }
    expect(streamCalls).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('no_notes: ctx null → ok:false reason:no_notes, no stream call', async () => {
    const { supabase } = makeSupabaseMock();
    let streamCalls = 0;
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'm', promptTokens: 0, completionTokens: 0 };
      },
      async generateStream<U>(): Promise<GenerateOutput<U>> {
        streamCalls++;
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'm', promptTokens: 0, completionTokens: 0 };
      },
    };
    const result = await runDailyDevotionStreaming(
      { llm, supabase, ctx: null, userId: 'user-1', localDate: '2026-05-27' },
      { onStage: vi.fn(), onPiece: vi.fn(), onRefining: vi.fn() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no_notes');
      expect(result.attempts).toBe(0);
    }
    expect(streamCalls).toBe(0);
  });

  it('length-gate: opening too short → perFieldValidate suppresses, refining fires, retry succeeds', async () => {
    // Short opening that fails the 80-char minimum
    const shortOpening = 'Too short.';
    const shortArtifact: DailyDevotion = { ...cleanArtifact, opening: shortOpening };

    const { supabase, inserts } = makeSupabaseMock();
    const onRefining = vi.fn();
    const onPiece = vi.fn();

    // Stream adapter: emit the non-gated fields first (they fire onPiece),
    // then emit the short opening last (gate suppresses it, triggering retry).
    // This confirms suppression-not-silence: onPiece IS called for other fields,
    // but NOT for 'opening' which the length gate rejects.
    const llm: LLMAdapter = {
      async generate<U>(): Promise<GenerateOutput<U>> {
        return { parsed: cleanArtifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 5, completionTokens: 10 };
      },
      async generateStream<U>(
        _: GenerateStreamInput,
        handlers: StreamHandlers,
      ): Promise<GenerateOutput<U>> {
        // Emit the fields that pass the gate first — these will fire onPiece
        handlers.onField?.('scripture', shortArtifact.scripture);
        handlers.onField?.('reflection', shortArtifact.reflection);
        handlers.onField?.('prompt', shortArtifact.prompt);
        handlers.onField?.('note_citations', shortArtifact.note_citations);
        // Emit the short opening last — gate suppresses it (no onPiece for 'opening')
        handlers.onField?.('opening', shortArtifact.opening);
        return { parsed: shortArtifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 5, completionTokens: 10 };
      },
    };

    const result = await runDailyDevotionStreaming(
      { llm, supabase, ctx: makeCtx(), userId: 'user-1', localDate: '2026-05-27' },
      { onStage: vi.fn(), onPiece, onRefining },
    );

    // Suppression-not-silence: onPiece was called for the non-opening fields (not vacuously empty),
    // confirming the gate suppressed 'opening' specifically rather than silencing all output.
    const piecedFields = onPiece.mock.calls.map((c: [string, unknown]) => c[0]);
    expect(piecedFields).toContain('scripture');
    expect(piecedFields).toContain('reflection');
    expect(piecedFields).toContain('prompt');
    expect(piecedFields).toContain('note_citations');
    // And 'opening' was never emitted (suppressed by the length gate)
    expect(piecedFields).not.toContain('opening');

    // onRefining fires because perFieldFailed was set
    expect(onRefining).toHaveBeenCalledTimes(1);

    // Retry with buffered generate(cleanArtifact) passes — result is ok
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
      // The persisted artifact came from the clean retry, not the short one
      expect(result.artifact.opening).toBe(cleanArtifact.opening);
    }
    expect(inserts).toHaveLength(1);
  });
});
