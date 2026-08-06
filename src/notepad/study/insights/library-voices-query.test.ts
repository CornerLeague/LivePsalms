// src/notepad/study/insights/library-voices-query.test.ts
//
// PARITY SUITE. These cases mirror the server twin's tests in
// supabase/functions/_shared/library-retrieval.test.ts one-for-one. When that
// file's expectations change, this one changes with it — a silent divergence
// means the Insights panel shows a different set of voices than the one the
// study chat was grounded in for the same passage.
import { describe, it, expect } from 'vitest';
import {
  overlapsVerseRange,
  composeSourceLabel,
  stripEmbeddingPrefix,
  type LibraryChunkRow,
  type RefAnchor,
} from './library-voices-query';

const chunk = (over: Partial<LibraryChunkRow> = {}): LibraryChunkRow => ({
  id: 'c1', source_id: 'treasury-of-david', heading: 'Psalm 27:4',
  content: 'Body.', book: 'psa', chapter: 27, verse_start: 4, verse_end: 4,
  ...over,
});

const anchor = (over: Partial<RefAnchor> = {}): RefAnchor => ({
  book: 'psa', chapter: 27, verseStart: 4, verseEnd: 4, ...over,
});

describe('overlapsVerseRange', () => {
  it('overlaps when the chunk range contains the anchor verse', () => {
    expect(overlapsVerseRange(chunk({ verse_start: 1, verse_end: 14 }), anchor({ verseStart: 4, verseEnd: 4 }))).toBe(true);
  });

  it('treats a chapter-level chunk (null verse_start) as overlapping any verse in that chapter', () => {
    expect(overlapsVerseRange(chunk({ verse_start: null, verse_end: null }), anchor({ verseStart: 9, verseEnd: 9 }))).toBe(true);
  });

  it('does not overlap when the ranges are disjoint', () => {
    expect(overlapsVerseRange(chunk({ verse_start: 1, verse_end: 3 }), anchor({ verseStart: 9, verseEnd: 9 }))).toBe(false);
  });

  it('never overlaps across books', () => {
    expect(overlapsVerseRange(chunk({ book: 'jhn' }), anchor({ book: 'psa' }))).toBe(false);
  });

  it('compares books case-insensitively', () => {
    expect(overlapsVerseRange(chunk({ book: 'PSA' }), anchor({ book: 'psa' }))).toBe(true);
  });

  it('never overlaps across chapters', () => {
    expect(overlapsVerseRange(chunk({ chapter: 26 }), anchor({ chapter: 27 }))).toBe(false);
  });

  it('matches every chunk in the chapter when the anchor carries no verse', () => {
    const chapterAnchor = anchor({ verseStart: undefined, verseEnd: undefined });
    expect(overlapsVerseRange(chunk({ verse_start: 1, verse_end: 3 }), chapterAnchor)).toBe(true);
    expect(overlapsVerseRange(chunk({ verse_start: 12, verse_end: 14 }), chapterAnchor)).toBe(true);
    expect(overlapsVerseRange(chunk({ verse_start: null, verse_end: null }), chapterAnchor)).toBe(true);
  });

  it('never overlaps for an unanchored chunk (confessional/topical/lexical)', () => {
    expect(overlapsVerseRange(chunk({ book: null, chapter: null, verse_start: null, verse_end: null }), anchor())).toBe(false);
  });

  it('treats a null verse_end as a single-verse chunk', () => {
    expect(overlapsVerseRange(chunk({ verse_start: 4, verse_end: null }), anchor({ verseStart: 4, verseEnd: 4 }))).toBe(true);
    expect(overlapsVerseRange(chunk({ verse_start: 4, verse_end: null }), anchor({ verseStart: 5, verseEnd: 9 }))).toBe(false);
  });

  it('overlaps on a partial range intersection at either edge', () => {
    expect(overlapsVerseRange(chunk({ verse_start: 1, verse_end: 5 }), anchor({ verseStart: 5, verseEnd: 9 }))).toBe(true);
    expect(overlapsVerseRange(chunk({ verse_start: 9, verse_end: 14 }), anchor({ verseStart: 5, verseEnd: 9 }))).toBe(true);
  });
});

describe('composeSourceLabel', () => {
  it('renders title · author, era — byte-identical to the server twin', () => {
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
