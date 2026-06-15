import { describe, it, expect } from 'vitest';
import { routeQuery, detectGrain, normalizeFtsRow, osisForRef, osisBookToCanonical } from './verse-search';
import type { RawFtsRow } from './verse-search-types';

describe('routeQuery', () => {
  it('routes a parseable reference to kind=reference with parsed fields', () => {
    const r = routeQuery('John 3:16');
    expect(r.kind).toBe('reference');
    if (r.kind === 'reference') {
      expect(r.parsed.book).toBe('John');
      expect(r.parsed.chapter).toBe(3);
      expect(r.parsed.verseStart).toBe(16);
    }
  });

  it('routes free text to kind=keyword', () => {
    expect(routeQuery('love your enemies').kind).toBe('keyword');
  });
});

describe('detectGrain', () => {
  it('treats a 3-segment source id as a verse', () => {
    expect(detectGrain('jhn.3.16')).toBe('verse');
  });
  it('treats a 2-segment source id as a pericope', () => {
    expect(detectGrain('jhn.3')).toBe('pericope');
  });
});

describe('osisForRef', () => {
  it('builds the bible_passages key from a parsed ref', () => {
    expect(osisForRef('John', 3, 16)).toBe('jhn.3.16');
  });
});

describe('osisBookToCanonical', () => {
  it('maps a known OSIS abbreviation to its canonical book name', () => {
    expect(osisBookToCanonical('jhn')).toBe('John');
  });
  it('returns null for an unknown OSIS abbreviation', () => {
    expect(osisBookToCanonical('xyz')).toBeNull();
  });
});

describe('normalizeFtsRow', () => {
  it('maps a raw FTS row to a candidate with flat fts score', () => {
    const row: RawFtsRow = {
      id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      text: 'For God so loved the world...',
    };
    const c = normalizeFtsRow(row);
    expect(c.source).toBe('fts');
    expect(c.score).toBeCloseTo(0.55);
    expect(c.osis).toBe('jhn.3.16');
    expect(c.translation).toBe('BSB');
  });
});
