import { describe, it, expect } from 'vitest';
import {
  retrieveNoteContext,
  type NoteContextDeps,
  type NoteContextNote,
  type RawNoteRow,
  type RetrievedBibleRow,
} from './note-context';
import type { BiblePassageRow } from './bible-passage';

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
    expect(fake.searchArg).toEqual({ query: 'THEME_QUERY', k: 3, queryEmbedding: [0.1, 0.2, 0.3] });
  });

  it('defaults k to 3 and fetches passages for the retrieved source ids', async () => {
    const fake = makeDeps({ notes: [note()] });
    await retrieveNoteContext(fake.deps, {
      userId: 'u1',
      noteLimit: 5,
      rerankEnabled: false,
      buildThemeQuery: longestStrategy,
    });
    expect(fake.searchArg!.k).toBe(3);
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
    expect(fake.searchArg!.k).toBe(7);
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
