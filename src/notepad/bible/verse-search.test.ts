import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeQuery, detectGrain, normalizeFtsRow, osisForRef, osisBookToCanonical, normalizeSemanticRow, referenceCandidate, mergeCandidates, completeReference, createVerseSearch } from './verse-search';
import type { RawFtsRow, RawSemanticRow, PericopeRange, VerseCandidate, VerseSearchDeps } from './verse-search-types';

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

describe('referenceCandidate', () => {
  it('builds a pinned reference candidate (score 1.0) from a parsed ref', () => {
    const c = referenceCandidate({ book: 'John', chapter: 3, verseStart: 16, verseEnd: null }, 'For God...');
    expect(c.source).toBe('reference');
    expect(c.score).toBe(1);
    expect(c.osis).toBe('jhn.3.16');
    expect(c.text).toBe('For God...');
  });
});

describe('mergeCandidates', () => {
  it('dedupes by osis, boosting corroborated verses and keeping non-empty text', () => {
    const fts = normalizeFtsRow({ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts text' });
    const sem: VerseCandidate = {
      osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      text: '', translation: 'BSB', source: 'semantic', score: 0.6,
    };
    const merged = mergeCandidates(null, [fts], [sem]);
    expect(merged).toHaveLength(1);
    // max(0.55, 0.6) + 0.15 = 0.75
    expect(merged[0].score).toBeCloseTo(0.75);
    // semantic > fts for source label
    expect(merged[0].source).toBe('semantic');
    // non-empty text preserved from fts
    expect(merged[0].text).toBe('fts text');
  });

  it('pins the reference candidate first regardless of score', () => {
    const ref = referenceCandidate({ book: 'Psalms', chapter: 23, verseStart: 1, verseEnd: null }, 'The LORD is my shepherd');
    const sem: VerseCandidate = {
      osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      text: 't', translation: 'BSB', source: 'semantic', score: 0.99,
    };
    const merged = mergeCandidates(ref, [], [sem]);
    expect(merged[0].osis).toBe('psa.23.1');
    expect(merged[1].osis).toBe('jhn.3.16');
  });

  it('orders non-reference candidates by score desc (stable)', () => {
    const a: VerseCandidate = { osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, text: 'a', translation: 'BSB', source: 'semantic', score: 0.9 };
    const b: VerseCandidate = { osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'b', translation: 'BSB', source: 'semantic', score: 0.4 };
    const merged = mergeCandidates(null, [], [b, a]);
    expect(merged.map((c) => c.osis)).toEqual(['rom.8.28', 'jhn.3.16']);
  });

  it('does not boost a corroborated reference candidate above 1', () => {
    const ref = referenceCandidate({ book: 'John', chapter: 3, verseStart: 16, verseEnd: null }, 'text');
    const fts = normalizeFtsRow({ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts text' });
    const merged = mergeCandidates(ref, [fts], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(1);
    expect(merged[0].source).toBe('reference');
  });
});

function makeDeps(over: Partial<VerseSearchDeps> = {}): VerseSearchDeps {
  return {
    ftsSearch: vi.fn(async () => []),
    semanticSearch: vi.fn(async () => []),
    resolvePericope: vi.fn(async () => null),
    fetchVerseText: vi.fn(async () => ({ text: 'verse text', translation: 'BSB', reference: 'John 3:16' })),
    ...over,
  };
}

describe('completeReference', () => {
  it('returns a single reference candidate once the ref resolves', async () => {
    const deps = makeDeps();
    const c = await completeReference('John 3:16', deps, {});
    expect(c).not.toBeNull();
    expect(c!.source).toBe('reference');
    expect(c!.osis).toBe('jhn.3.16');
    expect(c!.text).toBe('verse text');
    expect(deps.fetchVerseText).toHaveBeenCalledOnce();
  });

  it('returns null for an incomplete reference', async () => {
    const deps = makeDeps();
    expect(await completeReference('John', deps, {})).toBeNull();
  });

  it('still returns a candidate (empty text) when fetch fails/offline', async () => {
    const deps = makeDeps({ fetchVerseText: vi.fn(async () => null) });
    const c = await completeReference('John 3:16', deps, {});
    expect(c).not.toBeNull();
    expect(c!.text).toBe('');
  });
});

describe('createVerseSearch debounce + abort', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs FTS immediately and semantic only after the trailing debounce (>=3 chars)', async () => {
    const ftsSearch = vi.fn(async () => [
      { id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts' },
    ]);
    const semanticSearch = vi.fn(async () => []);
    const deps = makeDeps({ ftsSearch, semanticSearch });
    const search = createVerseSearch(deps, { debounceMs: 250 });
    const emit = vi.fn();

    search.query('love', emit);
    await vi.advanceTimersByTimeAsync(0);
    expect(ftsSearch).toHaveBeenCalledOnce();         // instant
    expect(semanticSearch).not.toHaveBeenCalled();    // not yet
    expect(emit).toHaveBeenCalledWith(expect.any(Array), 'instant');

    await vi.advanceTimersByTimeAsync(250);
    expect(semanticSearch).toHaveBeenCalledOnce();     // trailing
    expect(emit).toHaveBeenCalledWith(expect.any(Array), 'complete');
  });

  it('does not run semantic for queries shorter than 3 chars', async () => {
    const semanticSearch = vi.fn(async () => []);
    const deps = makeDeps({ semanticSearch });
    const search = createVerseSearch(deps, { debounceMs: 250 });
    search.query('lo', vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    expect(semanticSearch).not.toHaveBeenCalled();
  });

  it('aborts the previous in-flight query when a new one starts', async () => {
    const deps = makeDeps();
    const search = createVerseSearch(deps, { debounceMs: 250 });
    search.query('first', vi.fn());
    const cancel = search.query('second', vi.fn());
    // The signal passed to the first ftsSearch call should be aborted.
    const firstSignal = (deps.ftsSearch as ReturnType<typeof vi.fn>).mock.calls[0][1].signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    cancel();
  });

  it('does not emit results from an aborted query', async () => {
    const ftsSearch = vi.fn(() => new Promise<RawFtsRow[]>((resolve) => setTimeout(() => resolve([]), 100)));
    const deps = makeDeps({ ftsSearch });
    const search = createVerseSearch(deps, { debounceMs: 250 });
    const emit1 = vi.fn();
    const emit2 = vi.fn();

    search.query('first', emit1);
    await vi.advanceTimersByTimeAsync(50); // first FTS in flight
    search.query('second', emit2);         // cancels first
    await vi.advanceTimersByTimeAsync(500);

    expect(emit1).not.toHaveBeenCalled();  // stale emit suppressed after abort
    expect(emit2).toHaveBeenCalled();
  });
});
