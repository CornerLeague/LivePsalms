import { describe, it, expect, vi } from 'vitest';
import { selectOfferedNotes, selectRelatedPassages, retrieveRelatedPassages, buildStudyContext, type RelevantNote } from './study-context.ts';
import { renderStudyGrounding } from './prompts/study-chat.ts';
import type { VoyageDeps } from '../_shared/voyage.ts';

const notes: RelevantNote[] = [
  { id: 'n1', title: 'Shepherd', plaintext: 'rest as trust in God here', similarity: 0.9 },
  { id: 'n2', title: 'Psalm 23', plaintext: 'green pastures and still waters', similarity: 0.7 },
];

describe('selectOfferedNotes', () => {
  it('offers all relevant notes and includes none when includeNotes is false', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: false });
    expect(included).toEqual([]);
    expect(offered).toEqual([
      { id: 'n1', title: 'Shepherd', snippet: 'rest as trust in God here' },
      { id: 'n2', title: 'Psalm 23', snippet: 'green pastures and still waters' },
    ]);
  });
  it('includes only the requested ids and offers the rest', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: true, noteIds: ['n1'] });
    expect(included).toEqual([{ id: 'n1', title: 'Shepherd', plaintext: 'rest as trust in God here' }]);
    expect(offered).toEqual([{ id: 'n2', title: 'Psalm 23', snippet: 'green pastures and still waters' }]);
  });
  it('includes all relevant notes when includeNotes is true with no explicit ids', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: true });
    expect(included.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(offered).toEqual([]);
  });
});

describe('selectRelatedPassages', () => {
  const chapterVerseRefs = new Set(['john 10:11', 'john 10:14']);
  const crossRefSet = new Set(['ezekiel 34:11']);

  it('drops refs already in the open chapter or the cross-ref set (case-insensitive)', () => {
    const out = selectRelatedPassages(
      [
        { ref: 'John 10:11', text: 'I am the good shepherd' }, // in chapter → drop
        { ref: 'Ezekiel 34:11', text: 'I myself will search' }, // in crossRefs → drop
        { ref: 'Psalm 23:1', text: 'The LORD is my shepherd' }, // keep
      ],
      { chapterVerseRefs, crossRefSet },
    );
    expect(out.map((p) => p.ref)).toEqual(['Psalm 23:1']);
  });

  it('dedupes repeated refs within the retrieved set', () => {
    const out = selectRelatedPassages(
      [
        { ref: 'Psalm 23:1', text: 'a' },
        { ref: 'psalm 23:1', text: 'b' },
      ],
      { chapterVerseRefs: new Set(), crossRefSet: new Set() },
    );
    expect(out).toEqual([{ ref: 'Psalm 23:1', text: 'a' }]);
  });

  it('returns [] for empty input', () => {
    expect(selectRelatedPassages([], { chapterVerseRefs, crossRefSet })).toEqual([]);
  });
});

const fakeVoyage = { apiKey: 'k', fetch: (() => { throw new Error('no network'); }) as unknown as typeof fetch };

describe('retrieveRelatedPassages', () => {
  it('returns [] when search yields no rows', async () => {
    const supabase = { rpc: async () => ({ data: [], error: null }) } as never;
    const out = await retrieveRelatedPassages(
      { supabase, voyage: fakeVoyage, rerankEnabled: false },
      { query: 'q', k: 6, translation: 'BSB', queryEmbedding: [0.1], chapterVerseRefs: new Set(), crossRefSet: new Set() },
    );
    expect(out).toEqual([]);
  });

  it('degrades to [] when the search throws (retrieval must not fail the turn)', async () => {
    const supabase = { rpc: async () => { throw new Error('rpc down'); } } as never;
    const out = await retrieveRelatedPassages(
      { supabase, voyage: fakeVoyage, rerankEnabled: false },
      { query: 'q', k: 6, translation: 'BSB', queryEmbedding: [0.1], chapterVerseRefs: new Set(), crossRefSet: new Set() },
    );
    expect(out).toEqual([]);
  });
});

// ── Slice 1c: library + lexicon wiring ───────────────────────────────────────
// buildStudyContext is Supabase glue, so it gets a chainable fake rather than a
// real client. Each table handler receives the recorded ops, which is how the
// tests assert the composed .or() filter and the per-xref id lookups.

interface QueryOp { method: string; args: unknown[] }

type TableHandler = (name: string, ops: QueryOp[]) => unknown;

function opArg(ops: QueryOp[], method: string, index = 0): unknown {
  return ops.find((o) => o.method === method)?.args[index];
}

function makeSupabase(handlers: {
  table: TableHandler;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
  onQuery?: (name: string, ops: QueryOp[]) => void;
}) {
  const from = (name: string) => {
    const ops: QueryOp[] = [];
    const settle = (extra?: QueryOp) => {
      const all = extra ? [...ops, extra] : ops;
      handlers.onQuery?.(name, all);
      return { data: handlers.table(name, all) ?? null, error: null };
    };
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(res, rej),
      maybeSingle: () => Promise.resolve(settle({ method: 'maybeSingle', args: [] })),
      single: () => Promise.resolve(settle({ method: 'single', args: [] })),
    };
    for (const m of ['select', 'eq', 'like', 'or', 'in', 'order', 'limit', 'not', 'gte']) {
      chain[m] = (...args: unknown[]) => { ops.push({ method: m, args }); return chain; };
    }
    return chain;
  };
  return {
    from,
    rpc: (name: string, args: Record<string, unknown>) =>
      Promise.resolve({ data: handlers.rpc?.(name, args) ?? [], error: null }),
  } as never;
}

// Voyage fake: counts embed calls so "do not embed twice" is a real assertion.
function makeVoyage() {
  const state = { embedCalls: 0, rerankCalls: 0 };
  const fetchImpl = (async (url: string) => {
    if (String(url).includes('rerank')) {
      state.rerankCalls++;
      return { ok: true, json: async () => ({ data: [] }) };
    }
    state.embedCalls++;
    return {
      ok: true,
      json: async () => ({ data: [{ data: [{ embedding: [0.5, 0.5], index: 0 }], index: 0 }], usage: {} }),
    };
  }) as unknown as typeof fetch;
  return { state, deps: { apiKey: 'k', fetch: fetchImpl } };
}

const CHAPTER_ROWS = [
  { book: 'psa', chapter: 27, verse_start: 1, verse_end: 1, text: 'The LORD is my light and my salvation.' },
  { book: 'psa', chapter: 27, verse_start: 4, verse_end: 4, text: 'One thing I have asked of the LORD.' },
];

const LIBRARY_ROWS = [
  {
    id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 27:4 [2]',
    content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\nOne thing — the unity of desire.',
    book: 'psa', chapter: 27, verse_start: 4, verse_end: 4,
  },
  {
    id: 'lc2', source_id: 'jfb', heading: 'Isaiah 40:31',
    content: 'Robert Jamieson, 1871 — on Isaiah 40:31:\nThey that wait upon the LORD shall renew their strength.',
    book: 'isa', chapter: 40, verse_start: 31, verse_end: 31,
  },
];

const SOURCE_ROWS = [
  { id: 'treasury-of-david', title: 'The Treasury of David', author: 'Charles H. Spurgeon', era: '1869–1885', register: 'devotional' },
  { id: 'jfb', title: 'Jamieson-Fausset-Brown', author: 'Robert Jamieson', era: '1871', register: 'exegetical' },
];

// Default happy-path table handler; individual tests override per table.
function defaultTables(over: Partial<Record<string, unknown>> = {}): TableHandler {
  return (name, ops) => {
    if (name in over) {
      const v = over[name];
      return typeof v === 'function' ? (v as TableHandler)(name, ops) : v;
    }
    switch (name) {
      case 'bible_passages': {
        // Chapter query uses .like; the per-xref lookup uses .eq('id', …).
        if (ops.some((o) => o.method === 'like')) return CHAPTER_ROWS;
        const id = opArg(ops, 'eq', 1);
        return id === 'isa.40.31'
          ? { book: 'isa', chapter: 40, verse_start: 31, verse_end: 31, text: 'They that wait upon the LORD.' }
          : null;
      }
      case 'bible_books':
        return { full_name: 'Psalms', author: 'David', author_note: 'traditional', date_label: 'c. 1000 BC', region: 'Judah', cultural_context: 'Israelite worship', genre: 'Poetry', summary: 'The songbook of Israel.' };
      case 'bible_cross_references':
        return [{ to_book: 'isa', to_chapter: 40, to_verse_start: 31, to_verse_end: 31 }];
      case 'notes':
        return [];
      case 'library_chunks':
        return LIBRARY_ROWS;
      case 'library_sources':
        return SOURCE_ROWS;
      case 'bible_interlinear':
        // RAW STEPBible dStrong values, as actually stored — zero-padded, prefix
        // chained, suffixed. The canonical keys below only match after
        // normalizeStrongs; a fixture of pre-normalized values would hide that.
        return [{ strongs: 'H0216' }, { strongs: 'H9003/{H0216}' }, { strongs: null }, { strongs: 'H3068G' }];
      case 'bible_strongs':
        return [
          { strongs: 'H216', lemma: 'אוֹר', transliteration: 'or', short_def: 'illumination', language: 'hebrew' },
          { strongs: 'H3068', lemma: 'יְהֹוָה', transliteration: 'Yhvh', short_def: 'the LORD', language: 'hebrew' },
        ];
      default:
        return [];
    }
  };
}

function studyArgs(voyageDeps: VoyageDeps, over: Record<string, unknown> = {}) {
  return {
    userId: 'u1', book: 'psa', chapter: 27, passageRef: 'psa.27',
    message: 'What does it mean to dwell in the house of the LORD?',
    retrievalQuery: 'dwelling in the house of the LORD',
    history: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
    includeNotes: false, noteIds: [] as string[],
    voyageDeps, rerankEnabled: false,
    crossRefK: 5, noteK: 4, translation: 'BSB',
    libraryK: 4,
    ...over,
  };
}

describe('buildStudyContext — library + lexicon', () => {
  it('populates libraryExcerpts and lexiconEntries, reusing the single note embedding', async () => {
    const voyage = makeVoyage();
    const supabase = makeSupabase({ table: defaultTables() });
    const { ctx } = await buildStudyContext(supabase, studyArgs(voyage.deps));

    expect(voyage.state.embedCalls).toBe(1);            // one embedding serves notes + Bible + library
    expect(ctx.libraryExcerpts!.map((e) => e.chunkId)).toContain('lc1');
    expect(ctx.libraryExcerpts![0].sourceLabel).toBe('The Treasury of David · Charles H. Spurgeon, 1869–1885');
    expect(ctx.libraryExcerpts![0].heading).toBe('Psalm 27:4 [2]');
    expect(ctx.libraryExcerpts![0].content).toBe('One thing — the unity of desire.');
    expect(ctx.lexiconEntries!.map((l) => l.strongs)).toEqual(['H216', 'H3068']);
  });

  it('anchors on the open chapter AND the resolved cross-ref targets', async () => {
    const voyage = makeVoyage();
    const seen: Record<string, QueryOp[]> = {};
    const supabase = makeSupabase({
      table: defaultTables(),
      onQuery: (name, ops) => { if (name === 'library_chunks') seen[name] = ops; },
    });
    const { ctx } = await buildStudyContext(supabase, studyArgs(voyage.deps));

    expect(opArg(seen.library_chunks, 'or')).toBe('and(book.eq.psa,chapter.eq.27),and(book.eq.isa,chapter.eq.40)');
    // The Isaiah 40:31 commentary reached the prompt via the cross-ref anchor.
    expect(ctx.libraryExcerpts!.map((e) => e.chunkId)).toContain('lc2');
  });

  it('LOAD-BEARING: library excerpts never widen allowedVerseRefs', async () => {
    const voyage = makeVoyage();
    const withLibrary = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(voyage.deps),
    );
    const withoutLibrary = await buildStudyContext(
      makeSupabase({ table: defaultTables({ library_chunks: [], library_sources: SOURCE_ROWS }) }),
      studyArgs(makeVoyage().deps),
    );

    expect(withLibrary.ctx.libraryExcerpts!.length).toBeGreaterThan(0);
    expect(withoutLibrary.ctx.libraryExcerpts).toEqual([]);
    expect([...withLibrary.ctx.allowedVerseRefs].sort())
      .toEqual([...withoutLibrary.ctx.allowedVerseRefs].sort());
    // Specifically: JFB on Isaiah 40:31 is in the prompt, but its ref is only
    // citable because it is a resolved CROSS-REFERENCE, never because a voice
    // mentioned it. A library-only ref must not appear.
    expect(withLibrary.ctx.allowedVerseRefs.has('psa 27:1')).toBe(true);
    expect([...withLibrary.ctx.allowedVerseRefs].every((r) => withoutLibrary.ctx.allowedVerseRefs.has(r))).toBe(true);
  });

  it('a library-only verse never becomes citable', async () => {
    const voyage = makeVoyage();
    // A commentary chunk anchored on the OPEN chapter whose body names Romans 8:28.
    const rows = [{
      id: 'lc9', source_id: 'treasury-of-david', heading: 'Psalm 27:1',
      content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 27:1:\nCompare Romans 8:28, all things work together.',
      book: 'psa', chapter: 27, verse_start: 1, verse_end: 1,
    }];
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables({ library_chunks: rows }) }),
      studyArgs(voyage.deps),
    );
    expect(ctx.libraryExcerpts![0].content).toContain('Romans 8:28');
    expect(ctx.allowedVerseRefs.has('rom 8:28')).toBe(false);
    expect(ctx.allowedVerseRefs.has('Romans 8:28')).toBe(false);
  });

  it('degrades to empty library/lexicon with the rest of the context intact', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const voyage = makeVoyage();
    const boom: TableHandler = () => { throw new Error('library table missing'); };
    const supabase = makeSupabase({
      table: defaultTables({ library_chunks: boom, library_sources: boom, bible_interlinear: boom }),
    });
    const { ctx } = await buildStudyContext(supabase, studyArgs(voyage.deps));

    expect(ctx.libraryExcerpts).toEqual([]);
    expect(ctx.lexiconEntries).toEqual([]);
    expect(ctx.passageText).toContain('The LORD is my light');
    expect(ctx.crossRefs).toHaveLength(1);
    expect(ctx.allowedVerseRefs.has('psa 27:1')).toBe(true);
    err.mockRestore();
  });

  it('honours libraryK', async () => {
    const voyage = makeVoyage();
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(voyage.deps, { libraryK: 1 }),
    );
    expect(ctx.libraryExcerpts).toHaveLength(1);
  });

  it('skips the library entirely when libraryK is 0 (kill switch)', async () => {
    const voyage = makeVoyage();
    let libraryQueried = false;
    const supabase = makeSupabase({
      table: defaultTables(),
      onQuery: (name) => { if (name === 'library_chunks' || name === 'bible_interlinear') libraryQueried = true; },
    });
    const { ctx } = await buildStudyContext(supabase, studyArgs(voyage.deps, { libraryK: 0 }));
    expect(libraryQueried).toBe(false);
    expect(ctx.libraryExcerpts).toEqual([]);
    expect(ctx.lexiconEntries).toEqual([]);
  });
});

describe('buildStudyContext — skipSemanticRetrieval (the eval harness seam)', () => {
  // A deps object that throws if touched: if the flag ever fails to skip, the
  // test fails loudly instead of quietly making a call with an empty key.
  const forbiddenVoyage = {
    apiKey: '',
    fetch: (() => { throw new Error('voyage must not be called when skipSemanticRetrieval is set'); }) as never,
  } as unknown as VoyageDeps;

  it('never embeds, and never calls a semantic RPC', async () => {
    const rpcCalls: string[] = [];
    const supabase = makeSupabase({
      table: defaultTables(),
      rpc: (name) => { rpcCalls.push(name); return []; },
    });

    await buildStudyContext(
      supabase,
      studyArgs(forbiddenVoyage, { skipSemanticRetrieval: true }),
    );

    // match_user_note_embeddings, match_bible_embeddings and match_library_chunks
    // are all revoked from public — the harness runs on the anon key and would
    // get an error, not an empty list, if any of them were reached.
    expect(rpcCalls).toEqual([]);
  });

  it('still builds the deterministic grounding: chapter, book, cross-refs, library anchors, lexicon', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(forbiddenVoyage, { skipSemanticRetrieval: true }),
    );

    expect(ctx.passageText.length).toBeGreaterThan(0);
    expect(ctx.bookContext).not.toBeNull();
    expect(ctx.crossRefs.length).toBeGreaterThan(0);
    // The verse-anchor channel is the half that survives, including the
    // cross-ref-anchored excerpt — which is exactly what was dark while
    // bible_cross_references sat empty.
    expect(ctx.libraryExcerpts!.map((e) => e.chunkId)).toContain('lc2');
    expect(ctx.lexiconEntries!.length).toBeGreaterThan(0);
  });

  it('empties only the semantic channels', async () => {
    const { ctx, offered } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(forbiddenVoyage, { skipSemanticRetrieval: true }),
    );

    expect(ctx.relatedPassages).toEqual([]);
    expect(ctx.notes).toEqual([]);
    expect(offered).toEqual([]);
  });

  it('keeps the citation allowlist honest — no related passages means no extra refs', async () => {
    const voyage = makeVoyage();
    const full = await buildStudyContext(makeSupabase({ table: defaultTables() }), studyArgs(voyage.deps));
    const skipped = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(forbiddenVoyage, { skipSemanticRetrieval: true }),
    );

    // Every ref the skipped run allows is one the full run allows too: the flag
    // can only ever narrow the allowlist, never widen it.
    for (const ref of skipped.ctx.allowedVerseRefs) {
      expect(full.ctx.allowedVerseRefs.has(ref)).toBe(true);
    }
  });

  it('is off by default — production still embeds and still calls the semantic RPCs', async () => {
    const voyage = makeVoyage();
    const rpcCalls: string[] = [];
    const supabase = makeSupabase({
      table: defaultTables(),
      rpc: (name) => { rpcCalls.push(name); return []; },
    });

    await buildStudyContext(supabase, studyArgs(voyage.deps));

    expect(voyage.state.embedCalls).toBe(1);
    expect(rpcCalls).toContain('match_user_note_embeddings');
    expect(rpcCalls).toContain('match_bible_embeddings');
    expect(rpcCalls).toContain('match_library_chunks');
  });
});

// ── Verse scope (Insights Door 1) ────────────────────────────────────────────

// A chapter wide enough to have real neighbours on both sides of a selection,
// including one row that SPANS two verses — bible_passages genuinely stores
// those, and neighbours computed by arithmetic rather than over rows would get
// them wrong.
const WIDE_CHAPTER_ROWS = [
  { book: 'psa', chapter: 27, verse_start: 1, verse_end: 1, text: 'The LORD is my light and my salvation.' },
  { book: 'psa', chapter: 27, verse_start: 2, verse_end: 2, text: 'When the wicked came against me.' },
  { book: 'psa', chapter: 27, verse_start: 3, verse_end: 3, text: 'Though an army encamps against me.' },
  { book: 'psa', chapter: 27, verse_start: 4, verse_end: 4, text: 'One thing I have asked of the LORD.' },
  { book: 'psa', chapter: 27, verse_start: 5, verse_end: 6, text: 'For in the day of trouble He will hide me, and now my head will be exalted.' },
  { book: 'psa', chapter: 27, verse_start: 7, verse_end: 7, text: 'Hear my voice when I call, O LORD.' },
  { book: 'psa', chapter: 27, verse_start: 8, verse_end: 8, text: 'My heart says of You, Seek His face.' },
];

// Commentary on three different anchors, so "narrowed to the verse" is
// observable: the verse's own chunk survives, the sibling verse's does not, and
// the cross-referenced one rides in on its own anchor either way.
const VERSE_LIBRARY_ROWS = [
  {
    id: 'lc-v1', source_id: 'treasury-of-david', heading: 'Psalm 27:1',
    content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 27:1:\nLight and salvation, the two great needs.',
    book: 'psa', chapter: 27, verse_start: 1, verse_end: 1,
  },
  {
    id: 'lc-v4', source_id: 'treasury-of-david', heading: 'Psalm 27:4',
    content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\nOne thing — the unity of desire.',
    book: 'psa', chapter: 27, verse_start: 4, verse_end: 4,
  },
  {
    id: 'lc-xref', source_id: 'jfb', heading: 'Isaiah 40:31',
    content: 'Robert Jamieson, 1871 — on Isaiah 40:31:\nThey that wait upon the LORD shall renew their strength.',
    book: 'isa', chapter: 40, verse_start: 31, verse_end: 31,
  },
];

// defaultTables' bible_passages handler serves two different queries; a wider
// chapter has to keep serving both.
function wideChapterTables(over: Partial<Record<string, unknown>> = {}): TableHandler {
  return defaultTables({
    bible_passages: (_name: string, ops: QueryOp[]) => {
      if (ops.some((o) => o.method === 'like')) return WIDE_CHAPTER_ROWS;
      return opArg(ops, 'eq', 1) === 'isa.40.31'
        ? { book: 'isa', chapter: 40, verse_start: 31, verse_end: 31, text: 'They that wait upon the LORD.' }
        : null;
    },
    library_chunks: VERSE_LIBRARY_ROWS,
    ...over,
  });
}

describe('buildStudyContext — verse scope', () => {
  it('narrows the library anchor to the selected verse, keeping the cross-ref anchors', async () => {
    const chapter = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps),
    );
    const verse = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 1 }),
    );

    // Chapter scope anchors the whole chapter, so every chunk in it overlaps.
    expect(chapter.ctx.libraryExcerpts!.map((e) => e.chunkId).sort())
      .toEqual(['lc-v1', 'lc-v4', 'lc-xref']);
    // Verse scope keeps the selected verse's commentary and drops the sibling
    // verse's — but the cross-referenced voice still arrives on its own anchor.
    expect(verse.ctx.libraryExcerpts!.map((e) => e.chunkId).sort())
      .toEqual(['lc-v1', 'lc-xref']);
  });

  it('supplies the selected verse with its neighbours, marking which one is selected', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 4 }),
    );

    expect(ctx.focusVerses!.map((v) => v.ref))
      .toEqual(['psa 27:2', 'psa 27:3', 'psa 27:4', 'psa 27:5-6', 'psa 27:7']);
    expect(ctx.focusVerses!.filter((v) => v.isFocus).map((v) => v.ref)).toEqual(['psa 27:4']);
    expect(ctx.focusVerses!.find((v) => v.isFocus)!.text).toBe('One thing I have asked of the LORD.');
  });

  it('clamps at the start of the chapter', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 1 }),
    );
    expect(ctx.focusVerses!.map((v) => v.ref)).toEqual(['psa 27:1', 'psa 27:2', 'psa 27:3']);
    expect(ctx.focusVerses![0].isFocus).toBe(true);
  });

  it('clamps at the end of the chapter', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 8 }),
    );
    expect(ctx.focusVerses!.map((v) => v.ref)).toEqual(['psa 27:5-6', 'psa 27:7', 'psa 27:8']);
    expect(ctx.focusVerses!.at(-1)!.isFocus).toBe(true);
  });

  it('resolves a verse inside a multi-verse row to that row', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 6 }),
    );
    expect(ctx.focusVerses!.find((v) => v.isFocus)!.ref).toBe('psa 27:5-6');
  });

  it('degrades to chapter grounding when the verse is not in the chapter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 99 }),
    );
    // No focus block, and the anchor stays chapter-wide rather than narrowing
    // onto a verse that does not exist — which would blank the library.
    expect(ctx.focusVerses).toBeUndefined();
    expect(ctx.libraryExcerpts!.map((e) => e.chunkId).sort()).toEqual(['lc-v1', 'lc-v4', 'lc-xref']);
    warn.mockRestore();
  });

  it('LOAD-BEARING: narrowing the anchor never narrows the citation allowlist', async () => {
    // The whole chapter text is still supplied, so the whole chapter stays
    // citable. Narrowing here would make a section describing the chapter's
    // movement uncitable — and citations are what the validator checks.
    const chapter = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps),
    );
    const verse = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 4 }),
    );
    expect([...verse.ctx.allowedVerseRefs].sort()).toEqual([...chapter.ctx.allowedVerseRefs].sort());
    expect(verse.ctx.allowedVerseRefs.has('psa 27:1')).toBe(true);
  });
});

describe('buildStudyContext — displayRefs', () => {
  // Caught by the first B2 live sweep: Door 1's prose read "(psa 27:2)" and
  // "(2ti 2:19)" — the internal OSIS key echoed at the reader, because the model
  // returns whatever ref form it was handed.
  it('renders reader-facing book names in every supplied ref', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { displayRefs: true, verse: 4 }),
    );

    expect(ctx.crossRefs.map((c) => c.ref)).toEqual(['Isaiah 40:31']);
    expect(ctx.focusVerses!.map((v) => v.ref)).toContain('Psalms 27:4');
    expect(ctx.focusVerses!.every((v) => !v.ref.startsWith('psa'))).toBe(true);
  });

  it('LOAD-BEARING: moves the PASSAGE HEADER too — the model generalises from it', async () => {
    // The second live sweep's failure, pinned. Cross-refs and focus verses were
    // in reader form but the header still read "nam 1", so the model cited
    // "nam 1:1"…"nam 1:15" for the passage's own verses — none of which the
    // (now display-form) allowlist accepted. The whole door failed validation.
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { displayRefs: true }),
    );
    expect(ctx.passageRef).toBe('Psalms 27');
  });

  it('leaves the header in key form when displayRefs is off', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps),
    );
    expect(ctx.passageRef).toBe('psa 27');
  });

  it('LOAD-BEARING: moves the ALLOWLIST to the same form, or every citation fails', async () => {
    // The allowlist is compared against what the model cites, and the model
    // cites what it was shown. Changing one without the other would reject
    // every correct citation.
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { displayRefs: true }),
    );

    expect(ctx.allowedVerseRefs.has('psalms 27:1')).toBe(true);
    expect(ctx.allowedVerseRefs.has('isaiah 40:31')).toBe(true);
    expect(ctx.allowedVerseRefs.has('psa 27:1')).toBe(false);
  });

  it('is OFF by default — study chat keeps the exact refs it ships with today', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps),
    );

    expect(ctx.crossRefs.map((c) => c.ref)).toEqual(['isa 40:31']);
    expect(ctx.allowedVerseRefs.has('psa 27:1')).toBe(true);
  });

  it('keeps the allowlist and the rendered grounding in the SAME form', async () => {
    // The invariant behind both branches: whatever the reader-facing form is,
    // a ref shown in the prompt must be a ref the allowlist accepts.
    for (const displayRefs of [true, false]) {
      const { ctx } = await buildStudyContext(
        makeSupabase({ table: wideChapterTables() }),
        studyArgs(makeVoyage().deps, { displayRefs }),
      );
      for (const c of ctx.crossRefs) {
        expect(ctx.allowedVerseRefs.has(c.ref.toLowerCase())).toBe(true);
      }
    }
  });
});

describe('buildStudyContext — chapter scope is untouched by the verse-scope path', () => {
  it('sets no focusVerses at all, so the prompt renders exactly as before', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps),
    );
    // Absent, not empty: renderStudyGrounding drops the block either way, but
    // `undefined` is what every pre-B2 caller produced.
    expect(ctx.focusVerses).toBeUndefined();
    expect('focusVerses' in ctx).toBe(false);
  });

  it('keeps the whole-chapter library anchor', async () => {
    const seen: Record<string, QueryOp[]> = {};
    const supabase = makeSupabase({
      table: defaultTables(),
      onQuery: (name, ops) => { if (name === 'library_chunks') seen[name] = ops; },
    });
    const { ctx } = await buildStudyContext(supabase, studyArgs(makeVoyage().deps));

    expect(opArg(seen.library_chunks, 'or')).toBe('and(book.eq.psa,chapter.eq.27),and(book.eq.isa,chapter.eq.40)');
    // Psalm 27:4 commentary reaches a reader who opened the chapter — the
    // behaviour verse scope narrows, and chapter scope must keep.
    expect(ctx.libraryExcerpts!.map((e) => e.chunkId)).toContain('lc1');
  });

  it('renders a grounding turn with no focus block — the bytes study chat sends are unchanged', async () => {
    // The end of the loop the other two tests only reach halfway: a chapter-scope
    // context through the REAL renderer, which is what study chat actually puts
    // on the wire. `lamplight-study/index.ts` never passes `verse`, so this is
    // the prompt every study turn still gets.
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps),
    );
    const grounding = renderStudyGrounding(ctx);
    expect(grounding).not.toMatch(/selected/i);
    expect(grounding.startsWith('Passage: psa 27\n\n1 The LORD is my light')).toBe(true);
  });

  it('differs from verse scope in the two fields verse scope is allowed to change, and nothing else', async () => {
    const chapter = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps),
    );
    const verse = await buildStudyContext(
      makeSupabase({ table: wideChapterTables() }),
      studyArgs(makeVoyage().deps, { verse: 4 }),
    );

    const rest = (c: typeof chapter.ctx) => ({ ...c, focusVerses: null, libraryExcerpts: null });
    expect(rest(verse.ctx)).toEqual(rest(chapter.ctx));
  });
});

// ── Register steering ────────────────────────────────────────────────────────
// Designed in the parent design §7 and accepted by retrieveStudyLibrary since
// slice 1c, but buildStudyContext never passed it through — so no study surface
// could steer, and Door 1 could not bias devotional as the design says it does.

describe('buildStudyContext — registers', () => {
  // LIBRARY_ROWS has a devotional chunk (lc1, treasury) and an exegetical one
  // (lc2, jfb); SOURCE_ROWS carries their registers.
  it('restricts excerpts to the requested register', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps, { registers: ['devotional'] }),
    );
    expect(ctx.libraryExcerpts!.map((e) => e.sourceId)).toEqual(['treasury-of-david']);
  });

  it('restricts to a different register just as hard', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps, { registers: ['exegetical'] }),
    );
    expect(ctx.libraryExcerpts!.map((e) => e.sourceId)).toEqual(['jfb']);
  });

  it('accepts several registers at once', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps, { registers: ['devotional', 'exegetical'] }),
    );
    expect(ctx.libraryExcerpts!.map((e) => e.sourceId).sort()).toEqual(['jfb', 'treasury-of-david']);
  });

  it('is a HARD filter — an empty result is a real answer, not a fallback to everything', async () => {
    // The failure mode worth pinning: a register nothing matches must yield no
    // excerpts, not silently widen back to the whole corpus.
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps, { registers: ['confessional'] }),
    );
    expect(ctx.libraryExcerpts).toEqual([]);
  });

  it('is absent by default — study chat keeps the whole corpus', async () => {
    const { ctx } = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps),
    );
    expect(ctx.libraryExcerpts!.map((e) => e.sourceId).sort()).toEqual(['jfb', 'treasury-of-david']);
  });

  it('never widens the citation allowlist, whatever the register', async () => {
    // The load-bearing rule survives steering: library excerpts are grounding,
    // not citations, so changing which voices arrive must not change what may
    // be cited.
    const all = await buildStudyContext(makeSupabase({ table: defaultTables() }), studyArgs(makeVoyage().deps));
    const devo = await buildStudyContext(
      makeSupabase({ table: defaultTables() }),
      studyArgs(makeVoyage().deps, { registers: ['devotional'] }),
    );
    expect([...devo.ctx.allowedVerseRefs].sort()).toEqual([...all.ctx.allowedVerseRefs].sort());
  });
});
