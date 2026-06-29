import { describe, it, expect } from 'vitest';
import { selectOfferedNotes, selectRelatedPassages, retrieveRelatedPassages, type RelevantNote } from './study-context.ts';

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
