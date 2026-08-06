import { describe, it, expect, vi } from 'vitest';
import {
  retrieveNoteContext,
  type NoteContextDeps,
  type NoteContextNote,
  type RawNoteRow,
  type RetrievedBibleRow,
  isContestedRef,
} from './note-context';
import type { BiblePassageRow } from './bible-passage';
import type { LibraryChunkRow, LibraryRetrievalDeps } from './library-retrieval';

// One retrieved Bible row + its matching passage row → buildPassages yields a
// single passage with ref 'John 3:16'.
const RETRIEVED: RetrievedBibleRow[] = [
  { id: 'e1', source_id: 'p1', chunk_index: 0, chunk_text: 'x', similarity: 0.91, metadata: {} },
];
const PASSAGE_ROWS: BiblePassageRow[] = [
  { id: 'p1', book: 'John', chapter: 3, verse_start: 16, verse_end: 16, text: 'For God so loved...' },
];

interface FakeState {
  deps: NoteContextDeps;
  calls: { fetchRecentNotes: number; embedQuery: number; searchBible: number; fetchPassages: number };
  embedArg: string | null;
  searchArg: { query: string; k: number; queryEmbedding: number[] } | null;
  fetchPassagesArg: string[] | null;
}

/**
 * Plain fakes for the four NoteContextDeps — no Supabase query-builder stub.
 * Records call counts and the arguments each leaf was handed.
 */
function makeDeps(opts: {
  notes: RawNoteRow[];
  retrieved?: RetrievedBibleRow[];
  passageRows?: BiblePassageRow[];
}): FakeState {
  const state: FakeState = {
    deps: null as unknown as NoteContextDeps,
    calls: { fetchRecentNotes: 0, embedQuery: 0, searchBible: 0, fetchPassages: 0 },
    embedArg: null,
    searchArg: null,
    fetchPassagesArg: null,
  };
  state.deps = {
    async fetchRecentNotes() {
      state.calls.fetchRecentNotes++;
      return opts.notes;
    },
    async embedQuery(text) {
      state.calls.embedQuery++;
      state.embedArg = text;
      return [0.1, 0.2, 0.3];
    },
    async searchBible(args) {
      state.calls.searchBible++;
      state.searchArg = args;
      return opts.retrieved ?? RETRIEVED;
    },
    async fetchPassages(sourceIds) {
      state.calls.fetchPassages++;
      state.fetchPassagesArg = sourceIds;
      return opts.passageRows ?? PASSAGE_ROWS;
    },
  };
  return state;
}

const longestStrategy = (notes: NoteContextNote[]) =>
  [...notes].sort((a, b) => b.plaintext.length - a.plaintext.length)[0].plaintext;

function note(over: Partial<RawNoteRow> = {}): RawNoteRow {
  return { id: 'n1', title: 'Title', content: JSON.stringify(textDoc('hello world')), ...over };
}

// Minimal TipTap doc whose plain-text extraction is exactly `text`.
function textDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

describe('retrieveNoteContext', () => {
  it('returns null without embedding/searching when no notes are returned', async () => {
    const fake = makeDeps({ notes: [] });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
    });
    expect(result).toBeNull();
    expect(fake.calls.embedQuery).toBe(0);
    expect(fake.calls.searchBible).toBe(0);
    expect(fake.calls.fetchPassages).toBe(0);
  });

  it('returns null without embedding/searching when every note is blank', async () => {
    const fake = makeDeps({
      notes: [
        note({ id: 'a', content: '' }),
        note({ id: 'b', content: '   ' }),
        note({ id: 'c', content: JSON.stringify(textDoc('   ')) }),
      ],
    });
    let themeBuilt = false;
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: true,
      buildThemeQuery: (notes) => {
        themeBuilt = true;
        return longestStrategy(notes);
      },
    });
    expect(result).toBeNull();
    expect(themeBuilt).toBe(false);
    expect(fake.calls.embedQuery).toBe(0);
    expect(fake.calls.searchBible).toBe(0);
    expect(fake.calls.fetchPassages).toBe(0);
  });

  it('slices plaintext to 800 chars, filters blank notes, and falls back whitespace-only titles to (untitled)', async () => {
    const longText = 'a'.repeat(2000);
    const fake = makeDeps({
      notes: [
        note({ id: 'keep', title: '   ', content: JSON.stringify(textDoc(longText)) }),
        note({ id: 'blank', title: 'Blank', content: JSON.stringify(textDoc('   ')) }),
      ],
    });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
    });
    expect(result).not.toBeNull();
    expect(result!.notes).toHaveLength(1);
    expect(result!.notes[0].id).toBe('keep');
    expect(result!.notes[0].plaintext).toHaveLength(800);
    expect(result!.notes[0].title).toBe('(untitled)');
  });

  it('invokes buildThemeQuery with exactly the surviving notes and embeds/searches that query', async () => {
    const fake = makeDeps({
      notes: [
        note({ id: 'survivor', title: 'Kept', content: JSON.stringify(textDoc('present text')) }),
        note({ id: 'dropped', title: 'Gone', content: '' }),
      ],
    });
    let received: NoteContextNote[] | null = null;
    await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 3,
      rerankEnabled: false,
      buildThemeQuery: (notes) => {
        received = notes;
        return 'THEME_QUERY';
      },
    });
    expect(received).not.toBeNull();
    expect(received!).toEqual([{ id: 'survivor', title: 'Kept', plaintext: 'present text' }]);
    expect(fake.embedArg).toBe('THEME_QUERY');
    expect(fake.searchArg).toEqual({ query: 'THEME_QUERY', k: 5, queryEmbedding: [0.1, 0.2, 0.3] });
  });

  it('defaults k to 3 and fetches passages for the retrieved source ids', async () => {
    const fake = makeDeps({ notes: [note()] });
    await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
    });
    expect(fake.searchArg!.k).toBe(5);   // 3 + contested-filter headroom
    expect(fake.fetchPassagesArg).toEqual(['p1']);
  });

  it('honours a k override', async () => {
    const fake = makeDeps({ notes: [note()] });
    await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
      k: 7,
    });
    expect(fake.searchArg!.k).toBe(9);   // 7 + contested-filter headroom
  });

  it('derives allowedNoteIds from survivors and allowedVerseRefs from built passages', async () => {
    const fake = makeDeps({
      notes: [
        note({ id: 'n-a', content: JSON.stringify(textDoc('alpha')) }),
        note({ id: 'n-b', content: JSON.stringify(textDoc('beta')) }),
      ],
    });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
    });
    expect(result!.allowedNoteIds).toEqual(new Set(['n-a', 'n-b']));
    expect(result!.allowedVerseRefs).toEqual(new Set(['John 3:16']));
    expect(result!.passages.map((p) => p.ref)).toEqual(['John 3:16']);
  });

  it('rerankUsed is true when rerankEnabled and passages are non-empty', async () => {
    const fake = makeDeps({ notes: [note()] });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: true,
      buildThemeQuery: longestStrategy,
    });
    expect(result!.rerankUsed).toBe(true);
  });

  it('rerankUsed is false when rerankEnabled but no passages were built', async () => {
    const fake = makeDeps({ notes: [note()], passageRows: [] });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: true,
      buildThemeQuery: longestStrategy,
    });
    expect(result!.passages).toHaveLength(0);
    expect(result!.rerankUsed).toBe(false);
  });

  it('rerankUsed is false when rerankEnabled is false even with passages', async () => {
    const fake = makeDeps({ notes: [note()] });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
    });
    expect(result!.passages.length).toBeGreaterThan(0);
    expect(result!.rerankUsed).toBe(false);
  });
});

// ── Slice 1c: optional library retrieval in the shared seam ──────────────────
// The dep is OPTIONAL so every existing caller (and the smoke-test builder)
// keeps today's behaviour by construction, and so the library can never be the
// reason a devotion fails.

const LIBRARY_ROWS: LibraryChunkRow[] = [
  {
    id: 'lc1', source_id: 'treasury-of-david', heading: 'Psalm 23:4',
    content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 23:4:\nThe valley is a place of passage, not of dwelling.',
    book: 'John', chapter: 3, verse_start: 16, verse_end: 16,
  },
];

const LIBRARY_SOURCES = new Map([
  ['treasury-of-david', { label: 'The Treasury of David · Charles H. Spurgeon, 1869–1885', register: 'devotional' }],
]);

function makeLibrary(opts: { rows?: LibraryChunkRow[] } = {}) {
  const state = {
    calls: 0,
    anchorPairs: null as Array<{ book: string; chapter: number }> | null,
    semanticArgs: null as { embedding: number[]; limit: number; registers?: string[] } | null,
    deps: null as unknown as LibraryRetrievalDeps,
  };
  state.deps = {
    async fetchByChapters(pairs) {
      state.calls++;
      state.anchorPairs = pairs;
      return opts.rows ?? LIBRARY_ROWS;
    },
    async matchSemantic(args) {
      state.calls++;
      state.semanticArgs = args;
      return [];
    },
    async rerank(_q, documents) {
      return documents.map((_, i) => ({ index: i, score: 1 - i / 100 }));
    },
    async loadSources() {
      return LIBRARY_SOURCES;
    },
  };
  return state;
}

describe('retrieveNoteContext — library (slice 1c)', () => {
  it('behaves identically to today when the library dep is absent', async () => {
    const fake = makeDeps({ notes: [note()] });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy,
    });
    expect(result!.libraryExcerpts).toBeUndefined();
    expect(result!.passages.map((p) => p.ref)).toEqual(['John 3:16']);
    expect(result!.allowedVerseRefs).toEqual(new Set(['John 3:16']));
  });

  it('retrieves devotional-register excerpts anchored on the retrieved passages', async () => {
    const library = makeLibrary();
    const fake = makeDeps({ notes: [note()] });
    const result = await retrieveNoteContext(
      { ...fake.deps, library: library.deps },
      { userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: () => 'THEME' },
    );
    // Anchored on the passage the devotion will actually quote.
    expect(library.anchorPairs).toEqual([{ book: 'John', chapter: 3 }]);
    expect(library.semanticArgs).toEqual({ embedding: [0.1, 0.2, 0.3], limit: 50, registers: ['devotional'] });
    expect(result!.libraryExcerpts!.map((e) => e.chunkId)).toEqual(['lc1']);
    expect(result!.libraryExcerpts![0].content).toBe('The valley is a place of passage, not of dwelling.');
  });

  it('caps the devotion at k=2 excerpts', async () => {
    const rows: LibraryChunkRow[] = ['a', 'b', 'c'].map((id, i) => ({
      ...LIBRARY_ROWS[0], id, verse_start: 16, verse_end: 16 + i,
    }));
    const library = makeLibrary({ rows });
    const fake = makeDeps({ notes: [note()] });
    const result = await retrieveNoteContext(
      { ...fake.deps, library: library.deps },
      { userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy },
    );
    expect(result!.libraryExcerpts).toHaveLength(2);
  });

  it('never widens allowedVerseRefs', async () => {
    const library = makeLibrary();
    const fake = makeDeps({ notes: [note()] });
    const withLibrary = await retrieveNoteContext(
      { ...fake.deps, library: library.deps },
      { userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy },
    );
    const without = await retrieveNoteContext(makeDeps({ notes: [note()] }).deps, {
      userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy,
    });
    expect(withLibrary!.libraryExcerpts!.length).toBeGreaterThan(0);
    expect(withLibrary!.allowedVerseRefs).toEqual(without!.allowedVerseRefs);
  });

  it('does not query the library when the blank-notes short-circuit fires', async () => {
    const library = makeLibrary();
    const fake = makeDeps({ notes: [note({ content: '' })] });
    const result = await retrieveNoteContext(
      { ...fake.deps, library: library.deps },
      { userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy },
    );
    expect(result).toBeNull();
    expect(library.calls).toBe(0);
  });

  it('degrades to [] when the library throws, leaving the devotion context intact', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: LibraryRetrievalDeps = {
      fetchByChapters: () => Promise.reject(new Error('down')),
      matchSemantic: () => Promise.reject(new Error('down')),
      rerank: () => Promise.reject(new Error('down')),
      loadSources: () => Promise.resolve(LIBRARY_SOURCES),
    };
    const fake = makeDeps({ notes: [note()] });
    const result = await retrieveNoteContext(
      { ...fake.deps, library: broken },
      { userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy },
    );
    expect(result!.libraryExcerpts).toEqual([]);
    expect(result!.passages.map((p) => p.ref)).toEqual(['John 3:16']);
    err.mockRestore();
  });
});

// ── Contested passages are never offered as devotion candidates ──────────────
// Found by the eval: retrieval served Romans 9:16 as a candidate, the model
// anchored on it and cited the ref as instructed, and the content rule rejected
// the artifact — twice — so the reader got an error. The stricter-retry line
// even says "name them gently and defer", which the validator forbids. The two
// layers disagreed; retrieval is the place to settle it.

describe('isContestedRef', () => {
  it('matches a verse-level contested ref', () => {
    expect(isContestedRef('Romans 9:16')).toBe(true);
  });

  it('matches every verse of a chapter-level entry', () => {
    expect(isContestedRef('Revelation 13:5')).toBe(true);
    expect(isContestedRef('Matthew 24:14')).toBe(true);
  });

  it('leaves neighbouring verses outside the listed range alone', () => {
    expect(isContestedRef('Romans 9:1')).toBe(false);
    expect(isContestedRef('Romans 8:28')).toBe(false);
  });

  it('matches a range that spans a contested verse', () => {
    expect(isContestedRef('Romans 9:15-17')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isContestedRef('romans 9:16')).toBe(true);
  });

  it('passes ordinary refs', () => {
    expect(isContestedRef('Psalms 23:4')).toBe(false);
    expect(isContestedRef('John 3:16')).toBe(false);
  });

  // The filter must agree with applyContentRules exactly, or a surviving
  // candidate could still trip the gate. Both now call the same matcher, so
  // this holds by construction rather than by two substring tests lining up.
  it('no longer over-matches a verse that merely starts like a contested one', () => {
    expect(isContestedRef('1 Corinthians 11:20')).toBe(false);  // 11:2 is a prefix, not a match
    expect(isContestedRef('1 Corinthians 11:2')).toBe(true);
  });

  it('catches the OSIS spelling the gate now catches', () => {
    expect(isContestedRef('rom 9:16')).toBe(true);
    expect(isContestedRef('rev 13:1')).toBe(true);
  });
});

describe('retrieveNoteContext — contested candidates', () => {
  const contestedRow: BiblePassageRow = {
    id: 'rom.9.16', book: 'Romans', chapter: 9, verse_start: 16, verse_end: 16,
    text: 'So then it depends not on human will or effort…',
  };
  const cleanRow: BiblePassageRow = {
    id: 'psa.23.4', book: 'Psalms', chapter: 23, verse_start: 4, verse_end: 4,
    text: 'Even though I walk…',
  };
  const retrieved = (ids: string[]): RetrievedBibleRow[] =>
    ids.map((id, i) => ({ id: `e${i}`, source_id: id, chunk_index: 0, chunk_text: 'x', similarity: 0.9 - i / 100, metadata: {} }));

  it('drops a contested passage from the candidates and the allowlist', async () => {
    const fake = makeDeps({
      notes: [note()],
      retrieved: retrieved(['rom.9.16', 'psa.23.4']),
      passageRows: [contestedRow, cleanRow],
    });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy,
    });
    expect(result!.passages.map((p) => p.ref)).toEqual(['Psalms 23:4']);
    expect(result!.allowedVerseRefs.has('Romans 9:16')).toBe(false);
  });

  it('retrieves with headroom so filtering does not leave the devotion empty-handed', async () => {
    const fake = makeDeps({ notes: [note()] });
    await retrieveNoteContext(fake.deps, {
      userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy,
    });
    expect(fake.searchArg!.k).toBeGreaterThan(3);
  });

  it('still offers no more than k candidates after filtering', async () => {
    const rows: BiblePassageRow[] = ['psa.23.4', 'psa.16.6', 'isa.43.2', 'php.4.6'].map((id, i) => ({
      id, book: 'Psalms', chapter: 20 + i, verse_start: 1, verse_end: 1, text: 't',
    }));
    const fake = makeDeps({
      notes: [note()],
      retrieved: retrieved(rows.map((r) => r.id)),
      passageRows: rows,
    });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy, k: 3,
    });
    expect(result!.passages).toHaveLength(3);
  });

  it('returns a context with no passages when every candidate is contested, rather than throwing', async () => {
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = makeDeps({
      notes: [note()],
      retrieved: retrieved(['rom.9.16']),
      passageRows: [contestedRow],
    });
    const result = await retrieveNoteContext(fake.deps, {
      userId: 'u1', noteLimit: 5, rerankEnabled: false, buildThemeQuery: longestStrategy,
    });
    expect(result!.passages).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
