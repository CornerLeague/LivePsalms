import { describe, it, expect, vi } from 'vitest';
import { PASSAGE_DOOR_SPEC } from './prompts/passage-insight.ts';
import { DEEPER_DOOR_SPEC } from './prompts/deeper-insight.ts';
import { streamPassageInsight, parsePassageInsightBody, type PassageInsightStreamDeps } from './passage-insight-stream.ts';
import { PASSAGE_INSIGHT_SECTIONS } from './prompts/passage-insight.ts';
import type { BibleChatContext } from '../lamplight-chat/bible-chat-pipeline.ts';
import type { LLMAdapter, GenerateOutput, StreamHandlers } from '../_shared/openai.ts';
import type { QuotaConfig, QuotaDeps } from '../_shared/quota.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SseEvent } from '../_shared/sse.ts';

const KEYS = PASSAGE_INSIGHT_SECTIONS.map((s) => s.key);

const EMIT = {
  overview: 'David opens by naming the LORD his light and his salvation.',
  in_chapter: 'The confidence of the opening gives way to petition.',
  chapter_shape: 'The psalm turns at verse 7 from declaration to plea.',
  reflection: 'The one thing asked for is presence, not rescue.',
  citations: [{ type: 'verse', ref: 'psa 27:1' }],
};

const ctx: BibleChatContext = {
  passageRef: 'psa 27',
  passageText: '1 The LORD is my light and my salvation.',
  crossRefs: [],
  notes: [],
  history: [],
  userMessage: '',
  allowedNoteIds: new Set<string>(),
  allowedVerseRefs: new Set(['psa 27:1']),
  libraryExcerpts: [
    { chunkId: 'lc1', sourceId: 'treasury-of-david', sourceLabel: 'The Treasury of David', heading: 'Psalm 27:1', content: 'Light and salvation.', score: 0.9 },
  ],
};

// ── Fakes ────────────────────────────────────────────────────────────────────

function makeSupabase(opts: { cached?: unknown[] } = {}) {
  const upserts: Array<Array<Record<string, unknown>>> = [];
  // Filters are RECORDED, not ignored: "the cache read is scoped to this door"
  // is the assertion that keeps two doors from serving each other's rows, and a
  // fake that swallowed .eq() would make it unassertable.
  const eqs: Array<[string, unknown]> = [];
  const from = () => {
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: opts.cached ?? [], error: null }).then(res, rej),
      upsert: (rows: Array<Record<string, unknown>>) => {
        upserts.push(rows);
        return { then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res) };
      },
    };
    for (const m of ['select', 'order']) chain[m] = () => chain;
    chain.eq = (col: string, val: unknown) => { eqs.push([col, val]); return chain; };
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient, upserts, eqs };
}

/**
 * Streams each section field in schema order, then resolves with the whole emit.
 *
 * Keys come from the EMIT rather than from Door 1's list — a fake that streamed
 * Door 1's four fields no matter which door it was serving would report a
 * passing stream for a door that emitted nothing.
 */
function makeStreamAdapter(emit: Record<string, unknown> = EMIT): LLMAdapter {
  const emitKeys = Object.keys(emit).filter((k) => k !== 'citations');
  return {
    generate: vi.fn(async () => ({ parsed: emit, modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400 } as unknown as GenerateOutput<unknown>)),
    generateStream: vi.fn(async (_input: unknown, handlers: StreamHandlers) => {
      for (const k of emitKeys) {
        const v = emit[k];
        if (typeof v === 'string' && v.length > 0) handlers.onText?.(k, v);
        handlers.onField?.(k, v);
      }
      return { parsed: emit, modelUsed: 'gpt-5.6-terra', promptTokens: 900, completionTokens: 1400 } as unknown as GenerateOutput<unknown>;
    }),
  } as unknown as LLMAdapter;
}

/** An adapter whose stream dies partway, as a dropped connection does. */
function makeAbortingAdapter(): LLMAdapter {
  return {
    generate: vi.fn(),
    generateStream: vi.fn(async (_input: unknown, handlers: StreamHandlers) => {
      handlers.onText?.('overview', 'David opens by naming');
      throw new DOMException('The operation was aborted.', 'AbortError');
    }),
  } as unknown as LLMAdapter;
}

const QUOTA_CONFIG: QuotaConfig = {
  generation: { kinds: ['daily_devotion'], perUser: { none: 10, lite: 50, plus: 200 } },
  transcription: { kinds: ['note_transcription'], perUser: { none: 5, lite: 20, plus: 50 } },
  study: { kinds: ['bible_study'], perUser: { none: 3, lite: 10, plus: 30 } },
  passageInsight: { kinds: ['passage_insight'], perUser: null },
  global: 1000,
};

function makeQuotaDeps(over: Partial<QuotaDeps> = {}): QuotaDeps {
  return {
    getTier: async () => 'plus',
    countUserUsage: async () => 0,
    countGlobalUsage: async () => 0,
    ...over,
  };
}

function makeDeps(over: Partial<PassageInsightStreamDeps> = {}): {
  deps: PassageInsightStreamDeps;
  upserts: Array<Array<Record<string, unknown>>>;
  usage: Array<Record<string, unknown>>;
  eqs: Array<[string, unknown]>;
} {
  const { client, upserts, eqs } = makeSupabase();
  const usage: Array<Record<string, unknown>> = [];
  return {
    upserts,
    usage,
    eqs,
    deps: {
      cors: {},
      supabase: client,
      llm: makeStreamAdapter(),
      quotaDeps: makeQuotaDeps(),
      quotaConfig: QUOTA_CONFIG,
      getEntitlement: async () => ({ tier: 'plus', promoActive: false }),
      recordUsage: (row) => { usage.push(row as unknown as Record<string, unknown>); },
      buildContext: async () => ctx,
      ...over,
    },
  };
}

async function readBeats(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  return text.split('\n\n').filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)) as SseEvent);
}

const ARGS = { userId: 'u1', scope: 'chapter' as const, refId: 'psa.27', door: PASSAGE_DOOR_SPEC };

// ── The request contract, and with it the cache key ──────────────────────────

describe('parsePassageInsightBody', () => {
  it('composes a chapter ref when no verse is given', () => {
    expect(parsePassageInsightBody({ book: 'psa', chapter: 27 }))
      .toMatchObject({ ok: true, book: 'psa', chapter: 27, scope: 'chapter', refId: 'psa.27' });
  });

  it('composes a verse ref when one is', () => {
    expect(parsePassageInsightBody({ book: 'psa', chapter: 27, verse: 4 }))
      .toMatchObject({ ok: true, book: 'psa', chapter: 27, verse: 4, scope: 'verse', refId: 'psa.27.4' });
  });

  it('LOAD-BEARING: normalises the book, so one door never caches under two keys', () => {
    // ref_id is the primary key of a globally shared table. 'Psa' and 'psa'
    // arriving as different doors would silently double the corpus and halve
    // the hit rate.
    expect(parsePassageInsightBody({ book: '  PSA ', chapter: 27 }))
      .toMatchObject({ refId: 'psa.27' });
  });

  it('rejects a body that would write a meaningless ref', () => {
    for (const bad of [
      {},
      { book: 'psa' },
      { chapter: 27 },
      { book: '', chapter: 27 },
      { book: 'psa', chapter: 0 },
      { book: 'psa', chapter: 1.5 },
      { book: 'psa', chapter: 27, verse: 0 },
      { book: 'psa', chapter: 27, verse: 'four' },
    ]) {
      expect(parsePassageInsightBody(bad as never).ok).toBe(false);
    }
  });

  it('defaults to Door 1 when the body names no door', () => {
    // B2's client sends no `door` at all. It must keep working unchanged.
    const out = parsePassageInsightBody({ book: 'psa', chapter: 27 });
    expect(out.ok && out.door.spec).toBe(PASSAGE_DOOR_SPEC);
  });

  it('resolves a named door through the registry', () => {
    const out = parsePassageInsightBody({ book: 'psa', chapter: 27, door: 'deeper' });
    expect(out.ok && out.door.spec).toBe(DEEPER_DOOR_SPEC);
  });

  it('REJECTS an unregistered door rather than falling back to Door 1', () => {
    // A fallback would let a caller write Door 1's prose under whatever `door`
    // value it invented — the corruption migration 061's key and the cache's
    // required-door signature exist to prevent.
    for (const bad of ['', 'passages', 'DEEPER', 'reference', 'drop table']) {
      expect(parsePassageInsightBody({ book: 'psa', chapter: 27, door: bad }).ok).toBe(false);
    }
    expect(parsePassageInsightBody({ book: 'psa', chapter: 27, door: 7 } as never).ok).toBe(false);
  });

  it('treats a null verse as chapter scope, not as a broken verse', () => {
    expect(parsePassageInsightBody({ book: 'psa', chapter: 27, verse: null }))
      .toMatchObject({ ok: true, scope: 'chapter', refId: 'psa.27' });
  });
});

// ── Cache hit ────────────────────────────────────────────────────────────────

describe('streamPassageInsight — a cache hit', () => {
  const cachedRows = KEYS.map((k) => ({
    section: k, body: `cached ${k}`, sources: [],
    model_used: 'gpt-5.6-terra', prompt_version: 'passage-insight-2026-08-06-v1',
    created_at: '2026-08-06T10:00:00Z',
  }));

  it('returns the door immediately as JSON, with no stream', async () => {
    const { client } = makeSupabase({ cached: cachedRows });
    const { deps } = makeDeps({ supabase: client });
    const res = await streamPassageInsight(deps, ARGS);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.sections.overview).toBe('cached overview');
  });

  it('makes NO entitlement check and NO model call — a cached door is free and public', async () => {
    const { client } = makeSupabase({ cached: cachedRows });
    const getEntitlement = vi.fn(async () => ({ tier: 'none' as const, promoActive: false }));
    const llm = makeStreamAdapter();
    const { deps } = makeDeps({ supabase: client, getEntitlement, llm });

    const res = await streamPassageInsight(deps, ARGS);

    expect(res.status).toBe(200);
    expect(getEntitlement).not.toHaveBeenCalled();
    expect(llm.generateStream).not.toHaveBeenCalled();
  });

  it('spends no quota and records no usage', async () => {
    const { client } = makeSupabase({ cached: cachedRows });
    const countGlobalUsage = vi.fn(async () => 0);
    const { deps, usage } = makeDeps({ supabase: client, quotaDeps: makeQuotaDeps({ countGlobalUsage }) });

    await streamPassageInsight(deps, ARGS);

    expect(countGlobalUsage).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });
});

// ── Gates ────────────────────────────────────────────────────────────────────

describe('streamPassageInsight — the gates on a cache miss', () => {
  it('returns the gate reason and generates nothing without Plus or promo', async () => {
    const llm = makeStreamAdapter();
    const { deps, upserts } = makeDeps({ llm, getEntitlement: async () => ({ tier: 'none', promoActive: false }) });

    const res = await streamPassageInsight(deps, ARGS);

    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe('entitlement');
    expect(llm.generateStream).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });

  it('lets an active promo generate, exactly as etymology-insight does', async () => {
    const { deps } = makeDeps({ getEntitlement: async () => ({ tier: 'none', promoActive: true }) });
    const res = await streamPassageInsight(deps, ARGS);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('D1: the GLOBAL ceiling still blocks generation', async () => {
    const llm = makeStreamAdapter();
    const { deps } = makeDeps({ llm, quotaDeps: makeQuotaDeps({ countGlobalUsage: async () => 1000 }) });

    const res = await streamPassageInsight(deps, ARGS);

    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe('global_quota');
    expect(llm.generateStream).not.toHaveBeenCalled();
  });

  it('D1: the per-user allowance does NOT block — warming the cache is not charged to the reader', async () => {
    // A reader far beyond every per-user bucket still generates: the output is
    // a public asset, and charging one reader to warm it for everyone else is
    // the wrong incentive. The `passageInsight` scope's perUser is null.
    const countUserUsage = vi.fn(async () => 100_000);
    const { deps } = makeDeps({ quotaDeps: makeQuotaDeps({ countUserUsage, getTier: async () => 'none' }) });

    const res = await streamPassageInsight(deps, ARGS);

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Not merely "did not block" — the per-user count is never even queried.
    expect(countUserUsage).not.toHaveBeenCalled();
  });
});

// ── Streaming + cache write ──────────────────────────────────────────────────

describe('streamPassageInsight — generating', () => {
  it('streams the sections in reading order, then a done beat', async () => {
    const { deps } = makeDeps();
    const beats = await readBeats(await streamPassageInsight(deps, ARGS));

    expect(beats[0]).toEqual({ t: 'stage', stage: 'composing' });
    const textFields = beats.filter((b) => b.t === 'text').map((b) => (b as { field: string }).field);
    expect(textFields).toEqual(KEYS);
    expect(beats.at(-1)!.t).toBe('done');
  });

  it('writes the whole door on the terminal done beat', async () => {
    const { deps, upserts } = makeDeps();
    await readBeats(await streamPassageInsight(deps, ARGS));

    expect(upserts).toHaveLength(1);
    expect(upserts[0].map((r) => r.section)).toEqual(KEYS);
    expect(upserts[0][0].ref_id).toBe('psa.27');
    expect(upserts[0][0].scope).toBe('chapter');
    expect(upserts[0][0].created_by).toBe('u1');
  });

  it('stores the library provenance that informed the door', async () => {
    const { deps, upserts } = makeDeps();
    await readBeats(await streamPassageInsight(deps, ARGS));

    expect(upserts[0][0].sources).toEqual([
      { chunk_id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 27:1' },
    ]);
  });

  it('records usage even though the reader is not charged quota — cost stays visible', async () => {
    const { deps, usage } = makeDeps();
    await readBeats(await streamPassageInsight(deps, ARGS));

    expect(usage).toHaveLength(1);
    expect(usage[0].artifact_kind).toBe('passage_insight');
    expect(usage[0].user_id).toBe('u1');
    expect(usage[0].status).toBe('ok');
  });

  it('tells the client the door is cached on the done beat', async () => {
    const { deps } = makeDeps();
    const beats = await readBeats(await streamPassageInsight(deps, ARGS));
    const done = beats.at(-1) as { t: 'done'; payload: { cached: boolean; sections: Record<string, string> } };

    expect(done.payload.cached).toBe(true);
    expect(done.payload.sections.overview).toBe(EMIT.overview);
  });
});

// ── The failure paths ────────────────────────────────────────────────────────

describe('streamPassageInsight — nothing half-lands', () => {
  it('an interrupted stream writes nothing and leaves the door uncached', async () => {
    // Mirrors how study chat declines to commit an interrupted reply.
    const { deps, upserts } = makeDeps({ llm: makeAbortingAdapter() });
    const beats = await readBeats(await streamPassageInsight(deps, ARGS));

    expect(upserts).toEqual([]);
    // The ABORT is what surfaced — not a validator failure that happened to
    // also produce an error beat. The reader saw partial text and then nothing
    // was committed, which is the whole contract.
    expect(beats.some((b) => b.t === 'text')).toBe(true);
    expect(beats.at(-1)).toEqual({ t: 'error', reason: 'The operation was aborted.' });
  });

  it('a validators_failed generation writes nothing and surfaces the reason', async () => {
    const { deps, upserts } = makeDeps({
      llm: makeStreamAdapter({ ...EMIT, citations: [{ type: 'verse', ref: 'gen 1:1' }] }),
    });
    const beats = await readBeats(await streamPassageInsight(deps, ARGS));

    expect(upserts).toEqual([]);
    expect(beats.at(-1)).toEqual({ t: 'error', reason: 'validators_failed' });
  });

  it('an all-empty door is NOT cached, and says so rather than claiming success', async () => {
    // writePassageDoor refuses it; the done beat must not tell the client the
    // door is warm when no row landed.
    const empty = { ...Object.fromEntries(KEYS.map((k) => [k, ''])), citations: [] };
    const { deps, upserts } = makeDeps({ llm: makeStreamAdapter(empty) });
    const beats = await readBeats(await streamPassageInsight(deps, ARGS));

    expect(upserts).toEqual([]);
    const done = beats.at(-1) as { t: 'done'; payload: { cached: boolean } };
    expect(done.t).toBe('done');
    expect(done.payload.cached).toBe(false);
  });
});

// ── Two doors, one function (B3) ─────────────────────────────────────────────

describe('streamPassageInsight — per door', () => {
  const DEEPER_KEYS = DEEPER_DOOR_SPEC.sections.map((s) => s.key);
  const DEEPER_EMIT = {
    hermeneutics: 'The chapter argues rather than narrates.',
    historical_setting: 'Written to a mixed congregation in Rome.',
    theology: 'Calvin reads the potter image as a limit on the question.',
    read_with_care: 'It is often quoted a verse at a time, apart from its argument.',
    citations: [],
  };

  it('scopes the cache read to the requested door', async () => {
    const { deps, eqs } = makeDeps({ llm: makeStreamAdapter(DEEPER_EMIT) });
    await readBeats(await streamPassageInsight(deps, { ...ARGS, door: DEEPER_DOOR_SPEC }));

    expect(eqs).toContainEqual(['door', 'deeper']);
    expect(eqs).not.toContainEqual(['door', 'passage']);
  });

  it('writes the requested door’s id and section keys, not Door 1’s', async () => {
    const { deps, upserts } = makeDeps({ llm: makeStreamAdapter(DEEPER_EMIT) });
    await readBeats(await streamPassageInsight(deps, { ...ARGS, door: DEEPER_DOOR_SPEC }));

    expect(upserts).toHaveLength(1);
    expect(upserts[0].map((r) => r.section)).toEqual(DEEPER_KEYS);
    for (const r of upserts[0]) expect(r.door).toBe('deeper');
    expect(upserts[0][0].prompt_version).toBe(DEEPER_DOOR_SPEC.prompt.promptVersion);
  });

  it('streams the requested door’s sections', async () => {
    const { deps } = makeDeps({ llm: makeStreamAdapter(DEEPER_EMIT) });
    const beats = await readBeats(await streamPassageInsight(deps, { ...ARGS, door: DEEPER_DOOR_SPEC }));

    const fields = beats.filter((b) => b.t === 'text').map((b) => (b as { field: string }).field);
    expect(fields).toEqual(DEEPER_KEYS);
  });

  it('still does Door 1 exactly as before', async () => {
    const { deps, upserts, eqs } = makeDeps();
    await readBeats(await streamPassageInsight(deps, ARGS));

    expect(eqs).toContainEqual(['door', 'passage']);
    expect(upserts[0].map((r) => r.section)).toEqual(KEYS);
    for (const r of upserts[0]) expect(r.door).toBe('passage');
  });
});
