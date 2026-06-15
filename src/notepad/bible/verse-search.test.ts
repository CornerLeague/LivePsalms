import { describe, it, expect } from 'vitest';
import { routeQuery, detectGrain, normalizeFtsRow, osisForRef, osisBookToCanonical, normalizeSemanticRow } from './verse-search';
import type { RawFtsRow, RawSemanticRow, PericopeRange } from './verse-search-types';

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

describe('normalizeSemanticRow', () => {
  const noResolve = async () => null;

  it('maps a verse-grain row to a single-verse candidate (score = similarity)', async () => {
    const row: RawSemanticRow = { sourceId: 'jhn.3.16', text: 'For God so loved...', similarity: 0.82 };
    const c = await normalizeSemanticRow(row, { resolvePericope: noResolve, signal: undefined });
    expect(c).not.toBeNull();
    expect(c!.source).toBe('semantic');
    expect(c!.osis).toBe('jhn.3.16');
    expect(c!.book).toBe('John');
    expect(c!.chapter).toBe(3);
    expect(c!.verseStart).toBe(16);
    expect(c!.verseEnd).toBeNull();
    expect(c!.score).toBeCloseTo(0.82);
  });

  it('resolves a pericope-grain row to a ranged candidate with a distinct label', async () => {
    const range: PericopeRange = { book: 'John', chapter: 3, verseStart: 1, verseEnd: 21, text: 'pericope text' };
    const resolvePericope = async (id: string) => (id === 'jhn.3' ? range : null);
    const row: RawSemanticRow = { sourceId: 'jhn.3', text: 'ignored — replaced by pericope text', similarity: 0.7 };
    const c = await normalizeSemanticRow(row, { resolvePericope, signal: undefined });
    expect(c).not.toBeNull();
    expect(c!.osis).toBe('jhn.3.1');
    expect(c!.verseStart).toBe(1);
    expect(c!.verseEnd).toBe(21);
    expect(c!.text).toBe('pericope text');
    expect(c!.label).toBe('John 3:1–21 · passage');
    expect(c!.score).toBeCloseTo(0.7);
  });

  it('drops a pericope row that cannot be resolved', async () => {
    const row: RawSemanticRow = { sourceId: 'jhn.3', text: 'x', similarity: 0.7 };
    const c = await normalizeSemanticRow(row, { resolvePericope: noResolve, signal: undefined });
    expect(c).toBeNull();
  });
});
