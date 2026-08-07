import { describe, it, expect, vi } from 'vitest';
import {
  overlapsRef,
  fuseRRF,
  searchLibrary,
  chapterOrFilter,
  composeSourceLabel,
  stripEmbeddingPrefix,
  fetchLexiconEntries,
  makeLibraryDeps,
  type LexiconDeps,
  type StrongsRow,
  type LibraryChunkRow,
  type LibraryRetrievalDeps,
  type RefAnchor,
} from './library-retrieval.ts';

function chunk(over: Partial<LibraryChunkRow> = {}): LibraryChunkRow {
  return {
    id: 'c1',
    source_id: 'treasury-of-david',
    heading: 'Psalm 27:4',
    content: 'body',
    book: 'psa',
    chapter: 27,
    verse_start: 1,
    verse_end: 14,
    ...over,
  };
}

function anchor(over: Partial<RefAnchor> = {}): RefAnchor {
  return { book: 'psa', chapter: 27, verseStart: 4, verseEnd: 4, ...over };
}

describe('overlapsRef', () => {
  it('overlaps when the chunk range contains the anchor verse', () => {
    expect(overlapsRef(chunk({ verse_start: 1, verse_end: 14 }), anchor({ verseStart: 4, verseEnd: 4 }))).toBe(true);
  });

  it('treats a chapter-level chunk (null verse_start) as overlapping any verse in that chapter', () => {
    expect(
      overlapsRef(chunk({ verse_start: null, verse_end: null }), anchor({ verseStart: 9, verseEnd: 9 })),
    ).toBe(true);
  });

  it('does not overlap when the ranges are disjoint', () => {
    expect(overlapsRef(chunk({ verse_start: 1, verse_end: 3 }), anchor({ verseStart: 9, verseEnd: 9 }))).toBe(false);
  });

  it('never overlaps across books', () => {
    expect(overlapsRef(chunk({ book: 'jhn' }), anchor({ book: 'psa' }))).toBe(false);
  });

  it('never overlaps across chapters', () => {
    expect(overlapsRef(chunk({ chapter: 26 }), anchor({ chapter: 27 }))).toBe(false);
  });

  it('matches every chunk in the chapter when the anchor carries no verse', () => {
    const chapterAnchor = anchor({ verseStart: undefined, verseEnd: undefined });
    expect(overlapsRef(chunk({ verse_start: 1, verse_end: 3 }), chapterAnchor)).toBe(true);
    expect(overlapsRef(chunk({ verse_start: 12, verse_end: 14 }), chapterAnchor)).toBe(true);
    expect(overlapsRef(chunk({ verse_start: null, verse_end: null }), chapterAnchor)).toBe(true);
  });

  it('never overlaps for an unanchored chunk (confessional/topical/lexical)', () => {
    expect(overlapsRef(chunk({ book: null, chapter: null, verse_start: null, verse_end: null }), anchor())).toBe(false);
  });

  it('treats a null verse_end as a single-verse chunk', () => {
    expect(overlapsRef(chunk({ verse_start: 4, verse_end: null }), anchor({ verseStart: 4, verseEnd: 4 }))).toBe(true);
    expect(overlapsRef(chunk({ verse_start: 4, verse_end: null }), anchor({ verseStart: 5, verseEnd: 9 }))).toBe(false);
  });

  it('overlaps on a partial range intersection at either edge', () => {
    expect(overlapsRef(chunk({ verse_start: 1, verse_end: 5 }), anchor({ verseStart: 5, verseEnd: 9 }))).toBe(true);
    expect(overlapsRef(chunk({ verse_start: 9, verse_end: 14 }), anchor({ verseStart: 5, verseEnd: 9 }))).toBe(true);
  });
});

describe('fuseRRF', () => {
  const a = chunk({ id: 'a' });
  const b = chunk({ id: 'b' });
  const c = chunk({ id: 'c' });

  it('ranks an item that placed #1 in both lists above one that placed #1 in only one', () => {
    // a: #1 in both. b: #1 in list two only. c: #2 in list one only.
    const fused = fuseRRF([[a, c], [a, b]]);
    expect(fused.map((f) => f.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('sums reciprocal ranks with k=60 and dedupes by chunk id', () => {
    const fused = fuseRRF([[a, b], [b, a]]);
    expect(fused).toHaveLength(2);
    // Both appear at ranks 1 and 2 → identical summed score.
    const expected = 1 / 61 + 1 / 62;
    expect(fused[0].score).toBeCloseTo(expected, 12);
    expect(fused[1].score).toBeCloseTo(expected, 12);
  });

  it('breaks score ties deterministically by chunk id', () => {
    // Same fixture, lists swapped: order must not depend on input order.
    expect(fuseRRF([[a, b], [b, a]]).map((f) => f.item.id)).toEqual(['a', 'b']);
    expect(fuseRRF([[b, a], [a, b]]).map((f) => f.item.id)).toEqual(['a', 'b']);
  });

  it('counts only an item\'s best rank within a single list', () => {
    const fused = fuseRRF([[a, a, b]]);
    expect(fused).toHaveLength(2);
    expect(fused[0]).toEqual({ item: a, score: 1 / 61 });
    // b is rank 3 — the duplicate `a` still consumes its slot.
    expect(fused[1].score).toBeCloseTo(1 / 63, 12);
  });

  it('honours a custom k', () => {
    const fused = fuseRRF([[a]], { k: 10 });
    expect(fused[0].score).toBeCloseTo(1 / 11, 12);
  });

  it('returns [] for no lists and skips empty lists', () => {
    expect(fuseRRF([])).toEqual([]);
    expect(fuseRRF([[], []])).toEqual([]);
    expect(fuseRRF([[], [a]]).map((f) => f.item.id)).toEqual(['a']);
  });
});

// ── Task 2: searchLibrary ────────────────────────────────────────────────────

const SOURCES = new Map([
  ['treasury-of-david', { label: 'The Treasury of David · Charles H. Spurgeon, 1869–1885', register: 'devotional' }],
  ['jfb', { label: 'Jamieson-Fausset-Brown · Robert Jamieson, 1871', register: 'exegetical' }],
]);

interface Recorded {
  deps: LibraryRetrievalDeps;
  chapterPairs: Array<{ book: string; chapter: number }> | null;
  semanticArgs: { embedding: number[]; limit: number; registers?: string[] } | null;
  rerankArgs: { query: string; documents: string[]; topK: number } | null;
  rerankCalls: number;
}

function makeDeps(opts: {
  anchorRows?: LibraryChunkRow[];
  semanticRows?: LibraryChunkRow[];
  sources?: Map<string, { label: string; register: string }>;
  rerankResult?: Array<{ index: number; score: number }>;
  throwOn?: 'anchor' | 'semantic' | 'rerank' | 'sources';
} = {}): Recorded {
  const state: Recorded = {
    deps: null as unknown as LibraryRetrievalDeps,
    chapterPairs: null,
    semanticArgs: null,
    rerankArgs: null,
    rerankCalls: 0,
  };
  state.deps = {
    async fetchByChapters(pairs) {
      state.chapterPairs = pairs;
      if (opts.throwOn === 'anchor') throw new Error('anchor query down');
      return opts.anchorRows ?? [];
    },
    async matchSemantic(args) {
      state.semanticArgs = args;
      if (opts.throwOn === 'semantic') throw new Error('rpc down');
      return opts.semanticRows ?? [];
    },
    async rerank(query, documents, topK) {
      state.rerankCalls++;
      state.rerankArgs = { query, documents, topK };
      if (opts.throwOn === 'rerank') throw new Error('voyage down');
      return opts.rerankResult ?? documents.map((_, i) => ({ index: i, score: 1 - i / 100 }));
    },
    async loadSources() {
      if (opts.throwOn === 'sources') throw new Error('sources query down');
      return opts.sources ?? SOURCES;
    },
  };
  return state;
}

const ARGS = {
  refs: [{ book: 'psa', chapter: 27, verseStart: 4, verseEnd: 4 }] as RefAnchor[],
  queryEmbedding: [0.1, 0.2],
  query: 'what does it mean to dwell in the house of the LORD',
  k: 4,
  rerankEnabled: false,
};

describe('chapterOrFilter', () => {
  it('composes a PostgREST or() over (book, chapter) pairs', () => {
    expect(chapterOrFilter([{ book: 'psa', chapter: 27 }, { book: 'jhn', chapter: 10 }]))
      .toBe('and(book.eq.psa,chapter.eq.27),and(book.eq.jhn,chapter.eq.10)');
  });

  it('returns an empty string for no pairs', () => {
    expect(chapterOrFilter([])).toBe('');
  });
});

describe('composeSourceLabel', () => {
  it('renders title · author, era so prompts never string-build it', () => {
    expect(composeSourceLabel({ title: 'The Treasury of David', author: 'Charles H. Spurgeon', era: '1869–1885' }))
      .toBe('The Treasury of David · Charles H. Spurgeon, 1869–1885');
  });
});

describe('stripEmbeddingPrefix', () => {
  it('drops the ingest-time authorship prefix', () => {
    expect(stripEmbeddingPrefix('Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\nBody of the note.'))
      .toBe('Body of the note.');
  });

  it('leaves content without the prefix untouched', () => {
    expect(stripEmbeddingPrefix('A plain paragraph of prose.\nSecond line.'))
      .toBe('A plain paragraph of prose.\nSecond line.');
  });
});

describe('searchLibrary', () => {
  it('queries the distinct (book, chapter) pairs from the supplied refs, then filters by overlap in JS', async () => {
    const inChapter = chunk({ id: 'hit', verse_start: 1, verse_end: 14 });
    const wrongVerses = chunk({ id: 'miss', verse_start: 20, verse_end: 22 });
    const fake = makeDeps({ anchorRows: [inChapter, wrongVerses] });
    const out = await searchLibrary(fake.deps, {
      ...ARGS,
      refs: [
        { book: 'psa', chapter: 27, verseStart: 4, verseEnd: 4 },
        { book: 'psa', chapter: 27, verseStart: 8, verseEnd: 8 },  // same chapter → one pair
        { book: 'jhn', chapter: 10, verseStart: 11, verseEnd: 11 },
      ],
    });
    expect(fake.chapterPairs).toEqual([{ book: 'psa', chapter: 27 }, { book: 'jhn', chapter: 10 }]);
    expect(out.map((e) => e.chunkId)).toEqual(['hit']);
  });

  it('calls match_library_chunks with the supplied embedding, the pool limit, and the registers', async () => {
    const fake = makeDeps();
    await searchLibrary(fake.deps, { ...ARGS, registers: ['devotional'] });
    expect(fake.semanticArgs).toEqual({ embedding: [0.1, 0.2], limit: 50, registers: ['devotional'] });
  });

  it('omits registers from the semantic call when none are requested', async () => {
    const fake = makeDeps();
    await searchLibrary(fake.deps, ARGS);
    expect(fake.semanticArgs!.registers).toBeUndefined();
  });

  it('fuses both channels and cuts to k', async () => {
    const anchorRows = [chunk({ id: 'a' }), chunk({ id: 'b' })];
    const semanticRows = [chunk({ id: 'b' }), chunk({ id: 'c' }), chunk({ id: 'd' })];
    const fake = makeDeps({ anchorRows, semanticRows });
    const out = await searchLibrary(fake.deps, { ...ARGS, k: 2 });
    // b places in both channels → outranks the single-channel hits.
    expect(out.map((e) => e.chunkId)).toEqual(['b', 'a']);
    expect(out).toHaveLength(2);
  });

  it('post-filters the anchor channel by register too (the anchor query cannot express it)', async () => {
    const devotional = chunk({ id: 'spurgeon', source_id: 'treasury-of-david' });
    const exegetical = chunk({ id: 'jfb', source_id: 'jfb' });
    const fake = makeDeps({ anchorRows: [devotional, exegetical] });
    const out = await searchLibrary(fake.deps, { ...ARGS, registers: ['devotional'] });
    expect(out.map((e) => e.chunkId)).toEqual(['spurgeon']);
  });

  it('resolves sourceLabel from library_sources and strips the embedding prefix from content', async () => {
    const row = chunk({
      id: 'x',
      source_id: 'treasury-of-david',
      heading: 'Psalm 27:4 [2]',
      content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\nOne thing have I desired.',
    });
    const fake = makeDeps({ anchorRows: [row] });
    const [excerpt] = await searchLibrary(fake.deps, ARGS);
    expect(excerpt.sourceLabel).toBe('The Treasury of David · Charles H. Spurgeon, 1869–1885');
    expect(excerpt.heading).toBe('Psalm 27:4 [2]');       // structural suffix preserved
    expect(excerpt.content).toBe('One thing have I desired.');
    expect(excerpt.sourceId).toBe('treasury-of-david');
    expect(excerpt.score).toBeGreaterThan(0);
  });

  it('reranks only when rerankEnabled, over the chunk contents, reordering by returned indices', async () => {
    const rows = [chunk({ id: 'a', content: 'alpha' }), chunk({ id: 'b', content: 'beta' })];
    const off = makeDeps({ anchorRows: rows });
    await searchLibrary(off.deps, { ...ARGS, rerankEnabled: false });
    expect(off.rerankCalls).toBe(0);

    const on = makeDeps({ anchorRows: rows, rerankResult: [{ index: 1, score: 0.9 }, { index: 0, score: 0.4 }] });
    const out = await searchLibrary(on.deps, { ...ARGS, rerankEnabled: true });
    expect(on.rerankCalls).toBe(1);
    expect(on.rerankArgs!.query).toBe(ARGS.query);
    expect(on.rerankArgs!.documents).toEqual(['alpha', 'beta']);
    expect(out.map((e) => e.chunkId)).toEqual(['b', 'a']);
    expect(out[0].score).toBe(0.9);
  });

  it('returns [] without calling rerank when both channels are empty', async () => {
    const fake = makeDeps({ anchorRows: [], semanticRows: [] });
    const out = await searchLibrary(fake.deps, { ...ARGS, rerankEnabled: true });
    expect(out).toEqual([]);
    expect(fake.rerankCalls).toBe(0);
  });

  it('skips the anchor query entirely when no refs are supplied', async () => {
    const fake = makeDeps({ semanticRows: [chunk({ id: 's' })] });
    const out = await searchLibrary(fake.deps, { ...ARGS, refs: [] });
    expect(fake.chapterPairs).toBeNull();
    expect(out.map((e) => e.chunkId)).toEqual(['s']);
  });

  describe('graceful degradation', () => {
    it('survives a throwing anchor query on the semantic channel alone', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fake = makeDeps({ throwOn: 'anchor', semanticRows: [chunk({ id: 's' })] });
      const out = await searchLibrary(fake.deps, ARGS);
      expect(out.map((e) => e.chunkId)).toEqual(['s']);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('survives a throwing RPC on the anchor channel alone', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fake = makeDeps({ throwOn: 'semantic', anchorRows: [chunk({ id: 'a' })] });
      const out = await searchLibrary(fake.deps, ARGS);
      expect(out.map((e) => e.chunkId)).toEqual(['a']);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('yields [] when both channels throw', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const both: LibraryRetrievalDeps = {
        fetchByChapters: () => Promise.reject(new Error('down')),
        matchSemantic: () => Promise.reject(new Error('down')),
        rerank: () => Promise.resolve([]),
        loadSources: () => Promise.resolve(SOURCES),
      };
      await expect(searchLibrary(both, ARGS)).resolves.toEqual([]);
      err.mockRestore();
    });

    it('keeps the pre-rerank order when rerank throws', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fake = makeDeps({ throwOn: 'rerank', anchorRows: [chunk({ id: 'a' }), chunk({ id: 'b' })] });
      const out = await searchLibrary(fake.deps, { ...ARGS, rerankEnabled: true, k: 1 });
      expect(out.map((e) => e.chunkId)).toEqual(['a']);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('fails closed to [] when library_sources cannot be read (register filters must not silently lapse)', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fake = makeDeps({ throwOn: 'sources', anchorRows: [chunk({ id: 'a' })] });
      await expect(searchLibrary(fake.deps, ARGS)).resolves.toEqual([]);
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('tolerates an empty confessional/topical register (those adapters are unwritten)', async () => {
      const fake = makeDeps({ anchorRows: [chunk({ id: 'a' })], semanticRows: [] });
      await expect(searchLibrary(fake.deps, { ...ARGS, registers: ['confessional', 'topical'] })).resolves.toEqual([]);
    });

    it('drops a chunk whose source row is missing rather than leaking a raw source id into the prompt', async () => {
      const fake = makeDeps({ anchorRows: [chunk({ id: 'orphan', source_id: 'not-registered' })] });
      await expect(searchLibrary(fake.deps, ARGS)).resolves.toEqual([]);
    });
  });

  it('ranks semantically-corroborated anchor rows ahead of specificity order', async () => {
    // Chapter-wide anchor: every row overlaps, so specificity alone would put
    // the verse-1 comment first regardless of the question.
    const verseOne = chunk({ id: 'v1', verse_start: 1, verse_end: 1 });
    const verseFour = chunk({ id: 'v4', verse_start: 4, verse_end: 4 });
    const fake = makeDeps({ anchorRows: [verseOne, verseFour], semanticRows: [verseFour] });
    const out = await searchLibrary(fake.deps, {
      ...ARGS,
      refs: [{ book: 'psa', chapter: 27 }],
    });
    expect(out.map((e) => e.chunkId)).toEqual(['v4', 'v1']);
  });

  it('ranks the anchor channel most-specific-first', async () => {
    const wholeChapter = chunk({ id: 'chapter', verse_start: null, verse_end: null });
    const wideRange = chunk({ id: 'wide', verse_start: 1, verse_end: 14 });
    const exactVerse = chunk({ id: 'exact', verse_start: 4, verse_end: 4 });
    const fake = makeDeps({ anchorRows: [wholeChapter, wideRange, exactVerse] });
    const out = await searchLibrary(fake.deps, ARGS);
    expect(out.map((e) => e.chunkId)).toEqual(['exact', 'wide', 'chapter']);
  });
});

// ── Task 3: lexicon block ────────────────────────────────────────────────────

const STRONGS_ROWS: StrongsRow[] = [
  { strongs: 'H3068', lemma: 'יְהֹוָה', transliteration: 'Yhvh', short_def: 'the proper name of the God of Israel', language: 'hebrew' },
  { strongs: 'H216', lemma: 'אוֹר', transliteration: 'or', short_def: 'illumination, luminary', language: 'hebrew' },
  { strongs: 'H3444', lemma: 'יְשׁוּעָה', transliteration: 'yshuah', short_def: 'salvation, deliverance', language: 'hebrew' },
];

function makeLexiconDeps(opts: {
  interlinear?: Array<{ strongs: string | null }>;
  strongs?: StrongsRow[];
  throwOn?: 'interlinear' | 'strongs';
} = {}) {
  const state = {
    deps: null as unknown as LexiconDeps,
    interlinearArgs: null as { book: string; chapter: number } | null,
    strongsArg: null as string[] | null,
    strongsCalls: 0,
  };
  state.deps = {
    async fetchInterlinear(args) {
      state.interlinearArgs = args;
      if (opts.throwOn === 'interlinear') throw new Error('interlinear down');
      return opts.interlinear ?? [];
    },
    async fetchStrongs(codes) {
      state.strongsCalls++;
      state.strongsArg = codes;
      if (opts.throwOn === 'strongs') throw new Error('strongs down');
      return opts.strongs ?? STRONGS_ROWS;
    },
  };
  return state;
}

function words(...codes: Array<string | null>): Array<{ strongs: string | null }> {
  return codes.map((strongs) => ({ strongs }));
}

describe('fetchLexiconEntries', () => {
  it('takes the distinct non-null Strongs of the chapter, ordered by frequency', async () => {
    const fake = makeLexiconDeps({
      // H216 ×3, H3068 ×2, H3444 ×1 — deliberately NOT the order they first appear.
      interlinear: words('H3068', 'H216', 'H3444', 'H216', 'H3068', 'H216'),
    });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(fake.interlinearArgs).toEqual({ book: 'psa', chapter: 27 });
    expect(fake.strongsArg).toEqual(['H216', 'H3068', 'H3444']);
    expect(out.map((e) => e.strongs)).toEqual(['H216', 'H3068', 'H3444']);
    expect(out[0]).toEqual({
      strongs: 'H216',
      lemma: 'אוֹר',
      transliteration: 'or',
      gloss: 'illumination, luminary',
      language: 'hebrew',
      occurrences: 3,
    });
  });

  it('skips null-strongs particles', async () => {
    const fake = makeLexiconDeps({ interlinear: words(null, 'H216', null, null) });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(fake.strongsArg).toEqual(['H216']);
    expect(out.map((e) => e.strongs)).toEqual(['H216']);
  });

  it('caps at 12 by default, keeping the most frequent', async () => {
    // 14 distinct codes; the first is the rarest, the last the most frequent.
    const codes = Array.from({ length: 14 }, (_, i) => `H${100 + i}`);
    const interlinear = codes.flatMap((c, i) => words(...Array(i + 1).fill(c)));
    const strongsRows = codes.map((c) => ({
      strongs: c, lemma: 'l', transliteration: 't', short_def: 'd', language: 'hebrew',
    }));
    const fake = makeLexiconDeps({ interlinear, strongs: strongsRows });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(out).toHaveLength(12);
    expect(out[0].strongs).toBe('H113');   // 14 occurrences
    expect(out.map((e) => e.strongs)).not.toContain('H100'); // 1 occurrence, cut
  });

  it('honours a cap override', async () => {
    const fake = makeLexiconDeps({ interlinear: words('H3068', 'H216', 'H3444') });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27, cap: 2 });
    expect(out).toHaveLength(2);
  });

  it('breaks frequency ties by Strongs code so the block is deterministic', async () => {
    const fake = makeLexiconDeps({ interlinear: words('H3444', 'H3068', 'H216') });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(out.map((e) => e.strongs)).toEqual(['H216', 'H3068', 'H3444']);
  });

  it('returns [] without touching bible_strongs when the chapter has no interlinear coverage', async () => {
    const fake = makeLexiconDeps({ interlinear: [] });
    await expect(fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 })).resolves.toEqual([]);
    expect(fake.strongsCalls).toBe(0);
  });

  it('returns [] when every word is a null-strongs particle', async () => {
    const fake = makeLexiconDeps({ interlinear: words(null, null) });
    await expect(fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 })).resolves.toEqual([]);
    expect(fake.strongsCalls).toBe(0);
  });

  it('drops codes with no bible_strongs row rather than rendering a blank gloss', async () => {
    const fake = makeLexiconDeps({ interlinear: words('H216', 'H99999'), strongs: [STRONGS_ROWS[1]] });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(out.map((e) => e.strongs)).toEqual(['H216']);
  });

  it('normalizes raw STEPBible dStrong values before joining bible_strongs', async () => {
    // THE LIVE BUG (2026-08-06 fusion smoke, psa 27 → 0 entries):
    // bible_interlinear stores zero-padded / suffixed / prefix-chained dStrong
    // values; bible_strongs stores bare OpenScriptures keys. Joined raw, nothing
    // ever matches and the lexicon block is silently always empty.
    const fake = makeLexiconDeps({
      interlinear: words('H0216', 'H9003/{H0216}', '{H3068G}', 'H3444A'),
      strongs: STRONGS_ROWS,
    });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(fake.strongsArg).toEqual(['H216', 'H3068', 'H3444']);
    expect(out.map((e) => e.strongs)).toEqual(['H216', 'H3068', 'H3444']);
    // The two spellings of H216 are ONE word occurring twice, not two words.
    expect(out[0].occurrences).toBe(2);
  });

  it('skips raw values that carry no lexical Strongs number', async () => {
    const fake = makeLexiconDeps({ interlinear: words('H216', 'x', '', '///'), strongs: STRONGS_ROWS });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27 });
    expect(fake.strongsArg).toEqual(['H216']);
    expect(out.map((e) => e.strongs)).toEqual(['H216']);
  });

  it('does not let unmapped codes consume cap slots', async () => {
    // STEP prefix codes (H9xxx: article, conjunction, preposition) are frequent
    // and have no OpenScriptures entry. Looking up only the top `cap` codes
    // would spend every slot on them and return an empty block.
    const interlinear = words(
      ...Array(20).fill('H9003'), ...Array(15).fill('H9005'),
      ...Array(3).fill('H216'), ...Array(2).fill('H3068'),
    );
    const fake = makeLexiconDeps({ interlinear, strongs: STRONGS_ROWS });
    const out = await fetchLexiconEntries(fake.deps, { book: 'psa', chapter: 27, cap: 2 });
    expect(out.map((e) => e.strongs)).toEqual(['H216', 'H3068']);
  });

  it('degrades to [] when either query throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = makeLexiconDeps({ throwOn: 'interlinear' });
    await expect(fetchLexiconEntries(a.deps, { book: 'psa', chapter: 27 })).resolves.toEqual([]);
    const b = makeLexiconDeps({ interlinear: words('H216'), throwOn: 'strongs' });
    await expect(fetchLexiconEntries(b.deps, { book: 'psa', chapter: 27 })).resolves.toEqual([]);
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

// ── makeLibraryDeps.fetchByChapters — the anchor channel's actual query ──────
// Previously untested "glue", which is how it came to cap at 500 rows with no
// ORDER BY: the ranking in searchLibrary only ever sees whatever rows the
// planner happened to return first.

interface FetchCall { source: string | null; or: string | null; order: string[]; limit: number | null }

function makeFetchSupabase(rowsBySource: Record<string, number>) {
  const calls: FetchCall[] = [];
  const from = (table: string) => {
    const call: FetchCall = { source: null, or: null, order: [], limit: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: string) => { if (col === 'source_id') call.source = val; return chain; },
      or: (v: string) => { call.or = v; return chain; },
      order: (col: string) => { call.order.push(col); return chain; },
      limit: (n: number) => {
        call.limit = n;
        calls.push(call);
        // Emit `n` rows for the requested source (or across all, if unfiltered).
        const emit = (src: string, count: number) =>
          Array.from({ length: count }, (_, i) => ({
            id: `${src}-${i}`, source_id: src, heading: `h${i}`, content: `c${i}`,
            book: 'psa', chapter: 119, verse_start: null, verse_end: null,
          }));
        let rows: unknown[] = [];
        if (call.source) rows = emit(call.source, Math.min(rowsBySource[call.source] ?? 0, n));
        else for (const [s, c] of Object.entries(rowsBySource)) rows.push(...emit(s, c));
        return Promise.resolve({ data: rows.slice(0, n), error: null });
      },
    };
    void table;
    return chain;
  };
  return { client: { from } as never, calls };
}

const SOURCE_ROWS_FOR_DEPS = [
  { id: 'treasury-of-david', title: 'T', author: 'S', era: '1869', register: 'devotional' },
  { id: 'matthew-henry-concise', title: 'M', author: 'H', era: '1706', register: 'devotional' },
  { id: 'jfb', title: 'J', author: 'F', era: '1871', register: 'exegetical' },
];

function makeDepsSupabase(rowsBySource: Record<string, number>) {
  const inner = makeFetchSupabase(rowsBySource);
  const from = (table: string) => {
    if (table === 'library_sources') {
      const chain: Record<string, unknown> = {
        select: () => Promise.resolve({ data: SOURCE_ROWS_FOR_DEPS, error: null }),
      };
      return chain;
    }
    return (inner.client as unknown as { from: (t: string) => unknown }).from(table);
  };
  return { client: { from } as never, calls: inner.calls };
}

describe('makeLibraryDeps — fetchByChapters breadth', () => {
  const voyage = { apiKey: 'k', fetch: (() => { throw new Error('no network'); }) as never };

  it('LOAD-BEARING: one flooding source cannot crowd the others out', async () => {
    // Psalm 119 really is like this: 627 Treasury chunks against 22 Matthew
    // Henry and 70 JFB, and every Treasury chunk has verse_start null so it
    // overlaps ANY anchor. A single global cap makes breadth a matter of
    // physical row order.
    const { client, calls } = makeDepsSupabase({
      'treasury-of-david': 627, 'matthew-henry-concise': 22, 'jfb': 70,
    });
    const deps = makeLibraryDeps(client, voyage as never);
    const rows = await deps.fetchByChapters([{ book: 'psa', chapter: 119 }]);

    const bySource = new Set(rows.map((r) => r.source_id));
    expect([...bySource].sort()).toEqual(['jfb', 'matthew-henry-concise', 'treasury-of-david']);
    // The thin sources arrive WHOLE, not as whatever survived the flood.
    expect(rows.filter((r) => r.source_id === 'matthew-henry-concise')).toHaveLength(22);
    expect(rows.filter((r) => r.source_id === 'jfb')).toHaveLength(70);
    void calls;
  });

  it('queries per source rather than once globally', async () => {
    const { client, calls } = makeDepsSupabase({ 'treasury-of-david': 5, 'matthew-henry-concise': 5, 'jfb': 5 });
    const deps = makeLibraryDeps(client, voyage as never);
    await deps.fetchByChapters([{ book: 'psa', chapter: 27 }]);

    expect(calls.map((c) => c.source).sort())
      .toEqual(['jfb', 'matthew-henry-concise', 'treasury-of-david']);
    // Every call still carries the chapter filter.
    expect(calls.every((c) => c.or === 'and(book.eq.psa,chapter.eq.27)')).toBe(true);
  });

  it('orders every query, so truncation is deterministic rather than planner-dependent', async () => {
    const { client, calls } = makeDepsSupabase({ 'treasury-of-david': 900, 'matthew-henry-concise': 1, 'jfb': 1 });
    const deps = makeLibraryDeps(client, voyage as never);
    await deps.fetchByChapters([{ book: 'psa', chapter: 119 }]);

    expect(calls.every((c) => c.order.length > 0)).toBe(true);
    expect(calls.every((c) => (c.limit ?? 0) > 0)).toBe(true);
  });

  it('is stable across runs — same corpus, same rows', async () => {
    const build = async () => {
      const { client } = makeDepsSupabase({ 'treasury-of-david': 627, 'matthew-henry-concise': 22, 'jfb': 70 });
      const deps = makeLibraryDeps(client, voyage as never);
      return (await deps.fetchByChapters([{ book: 'psa', chapter: 119 }])).map((r) => r.id);
    };
    expect(await build()).toEqual(await build());
  });

  it('a chapter well under the cap returns everything, as it does today', async () => {
    const { client } = makeDepsSupabase({ 'treasury-of-david': 108, 'matthew-henry-concise': 2, 'jfb': 13 });
    const deps = makeLibraryDeps(client, voyage as never);
    const rows = await deps.fetchByChapters([{ book: 'psa', chapter: 27 }]);
    expect(rows).toHaveLength(108 + 2 + 13);
  });
});
