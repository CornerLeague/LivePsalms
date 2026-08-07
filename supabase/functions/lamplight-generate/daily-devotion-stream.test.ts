import { describe, it, expect, vi } from 'vitest';
import { streamDailyDevotion, type DailyDevotionStreamDeps } from './daily-devotion-stream';
import { type DailyDevotionContext } from './daily-devotion-pipeline';
import type { LLMAdapter, GenerateOutput, GenerateStreamInput, StreamHandlers } from '../_shared/openai';
import type { DailyDevotion } from '../_shared/artifacts';

// ── Fixtures (mirrors daily-devotion-pipeline.test.ts) ───────────────────────

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

const cleanArtifact: DailyDevotion = {
  opening: 'A quiet greeting, and an arresting thread from your notes: the lamp is lit and the day is yours.',
  scripture: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley of the shadow of death…' },
  reflection: 'This passage may speak to weariness. The shepherd does not pull the weary forward but walks beside them through the valley. Scripture suggests that fear, in this verse, is not banished but accompanied. For someone walking through what you have described, this verse often becomes less a promise to be fearless than an invitation to be unalone. The rod and the staff are not weapons against your weariness — they are signs that you have not been left.',
  prompt: 'What part of being accompanied through the valley reaches you today?',
  note_citations: [{ note_id: 'note-1', reason: 'recurring weariness across recent notes' }],
};

// Supabase fake answering the daily-devotion-pipeline's idempotency/insert
// queries (mirrors makeSupabaseMock from daily-devotion-pipeline.test.ts).
function makeSupabaseMock(opts: { existing?: DailyDevotion | null; insertedId?: string } = {}) {
  const existing = opts.existing ?? null;
  const insertedId = opts.insertedId ?? 'artifact-1';
  const inserts: Array<Record<string, unknown>> = [];
  const supabase = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                async maybeSingle() {
                  if (existing) {
                    return { data: { id: 'cached-id', body: existing, model_used: 'gpt-5.6-terra', prompt_version: 'v1' }, error: null };
                  }
                  return { data: null, error: null };
                },
                async single() {
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
                return { data: { id: insertedId }, error: null };
              },
            }),
          };
        },
      };
    },
  };
  return { supabase: supabase as unknown as DailyDevotionStreamDeps['supabase'], inserts };
}

// Streaming LLM adapter that fires onField for each field in schema order.
function makeStreamAdapter(artifact: DailyDevotion): LLMAdapter {
  return {
    async generate<U>(): Promise<GenerateOutput<U>> {
      return { parsed: artifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
    },
    async generateStream<U>(_: GenerateStreamInput, handlers: StreamHandlers): Promise<GenerateOutput<U>> {
      handlers.onField?.('opening', artifact.opening);
      handlers.onField?.('scripture', artifact.scripture);
      handlers.onField?.('reflection', artifact.reflection);
      handlers.onField?.('prompt', artifact.prompt);
      handlers.onField?.('note_citations', artifact.note_citations);
      return { parsed: artifact as unknown as U, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
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

function makeDeps(overrides: Partial<DailyDevotionStreamDeps> = {}): DailyDevotionStreamDeps {
  const { supabase } = makeSupabaseMock();
  return {
    cors: CORS,
    supabase,
    isOptedIn: async () => true,
    checkQuota: async () => ({ ok: true }),
    recordUsage: vi.fn(),
    llm: makeStreamAdapter(cleanArtifact),
    buildContext: async () => makeCtx(),
    ...overrides,
  };
}

describe('streamDailyDevotion', () => {
  it('happy path: returns text/event-stream and emits stage → piece → done in order', async () => {
    const { supabase, inserts } = makeSupabaseMock();
    const recordUsage = vi.fn();
    const res = await streamDailyDevotion(
      makeDeps({ supabase, recordUsage, llm: makeStreamAdapter(cleanArtifact), buildContext: async () => makeCtx() }),
      { userId: 'user-1', localDate: '2026-05-27' },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const body = await drainSse(res);
    const stageAt = body.indexOf('"t":"stage"');
    const pieceAt = body.indexOf('"t":"piece"');
    const doneAt = body.indexOf('"t":"done"');
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(pieceAt).toBeGreaterThan(stageAt);
    expect(doneAt).toBeGreaterThan(pieceAt);

    expect(inserts).toHaveLength(1);
    await Promise.resolve();
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it('not opted in: returns JSON 403, no stream', async () => {
    const res = await streamDailyDevotion(
      makeDeps({ isOptedIn: async () => false }),
      { userId: 'user-1', localDate: '2026-05-27' },
    );

    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).not.toBe('text/event-stream');
    expect(res.headers.get('content-type')).toContain('application/json');
    const json = await res.json();
    expect(json).toEqual({ error: 'not opted in' });
  });

  it('quota exceeded: returns JSON 429, no stream', async () => {
    const res = await streamDailyDevotion(
      makeDeps({ checkQuota: async () => ({ ok: false, reason: 'tier_cap' }) }),
      { userId: 'user-1', localDate: '2026-05-27' },
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).not.toBe('text/event-stream');
    const json = await res.json();
    expect(json).toEqual({ error: 'quota_exceeded', reason: 'tier_cap' });
  });
});

// ── Slice 1c: the streaming path shares devotionPostGeneration, so provenance
// must land identically here. Asserted rather than assumed — the Phase-0 tier
// drift (streaming silently a tier below design) is the cautionary tale.

describe('streamDailyDevotion — source_library_chunks provenance', () => {
  it('persists the same snapshot shape as the buffered path', async () => {
    const { supabase, inserts } = makeSupabaseMock();
    const res = await streamDailyDevotion(
      makeDeps({
        supabase,
        buildContext: async () => makeCtx({
          libraryExcerpts: [{
            chunkId: 'lc1', sourceId: 'treasury-of-david',
            sourceLabel: 'The Treasury of David · Charles H. Spurgeon, 1869–1885',
            heading: 'Psalm 23:4', content: 'The valley is a place of passage.', score: 0.9,
          }],
        }),
      }),
      { userId: 'user-1', localDate: '2026-05-27' },
    );
    await drainSse(res);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].source_library_chunks).toEqual([
      { chunk_id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 23:4' },
    ]);
    expect(inserts[0].prompt_version).toBe('daily-devotion-2026-08-06-v4');
  });

  it('persists null when the streaming turn had no library excerpts', async () => {
    const { supabase, inserts } = makeSupabaseMock();
    const res = await streamDailyDevotion(makeDeps({ supabase }), { userId: 'user-1', localDate: '2026-05-27' });
    await drainSse(res);
    expect(inserts[0].source_library_chunks).toBeNull();
  });
});

// ── Scripture verification reaches the pipeline (regression) ─────────────────
//
// It did not, from the day this module was written until 2026-08-07. The shell
// built `makeScriptureDeps(...)` and passed it in; `DailyDevotionStreamDeps` did
// not declare the field, so JavaScript dropped it silently at the boundary and
// the streamed devotion never verified a quote — while the BUFFERED path, a few
// lines further down the same shell, always did.
//
// Nothing caught it: the Deno shells were outside every typechecker until that
// date, the eval harness drives the buffered path, and this suite never asked.
// So this is the test that would have.
describe('streamDailyDevotion — Scripture verification', () => {
  it('hands the injected verifyScripture to the pipeline', async () => {
    const verifyRefs = vi.fn(async (refs: string[]) =>
      refs.map((ref) => ({ ref, status: 'found' as const, canonicalText: 'Even though I walk through the valley of the shadow of death…' })),
    );

    const res = await streamDailyDevotion(
      makeDeps({ verifyScripture: { translation: 'BSB', verifyRefs } }),
      { userId: 'user-1', localDate: '2026-05-27' },
    );
    await res.text();

    // The pipeline only calls verifyRefs when it was actually given the deps —
    // asserting the CALL rather than the plumbing is what makes this a
    // behavioural guard rather than a restatement of the interface.
    expect(verifyRefs).toHaveBeenCalled();
  });

  it('still streams when no verifyScripture is supplied', async () => {
    // Optional, and must stay optional: every existing caller and test omits it.
    const res = await streamDailyDevotion(makeDeps(), { userId: 'user-1', localDate: '2026-05-27' });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toContain('"t":"done"');
  });
});
