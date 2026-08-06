// @vitest-environment jsdom
// src/notepad/study/insights/useLibraryVoices.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { RefAnchor } from './library-voices-query';

interface Query { table: string; filters: Record<string, unknown> }
type Result = { data: unknown; error: unknown };

const { from, queries, setResult } = vi.hoisted(() => {
  const queries: Query[] = [];
  let result: Result = { data: [], error: null };
  const from = vi.fn((table: string) => {
    const q: Query = { table, filters: {} };
    queries.push(q);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { q.filters[col] = val; return builder; };
    builder.order = () => builder;
    builder.limit = () => Promise.resolve(result);
    return builder;
  });
  return { from, queries, setResult: (r: Result) => { result = r; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useLibraryVoices } from './useLibraryVoices';

const SPURGEON = { title: 'The Treasury of David', author: 'Charles H. Spurgeon', era: '1869–1885', tradition: 'Baptist (Reformed)' };
const HENRY = { title: 'Matthew Henry’s Concise Commentary', author: 'Matthew Henry', era: '1706–1710', tradition: 'Nonconformist' };

// verse 4 of psalm 27, the anchor every test below uses unless it says otherwise
const ANCHOR: RefAnchor = { book: 'psa', chapter: 27, verseStart: 4, verseEnd: 4 };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'c1', source_id: 'treasury-of-david', heading: 'Psalm 27:4',
    content: 'One thing have I desired.', book: 'psa', chapter: 27,
    verse_start: 4, verse_end: 4, library_sources: SPURGEON,
    ...over,
  };
}

beforeEach(() => {
  from.mockClear();
  queries.length = 0;
  setResult({ data: [], error: null });
});
afterEach(cleanup);

describe('useLibraryVoices', () => {
  it('queries library_chunks narrowed to the anchor chapter', async () => {
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('library_chunks');
    expect(queries[0].filters).toMatchObject({ book: 'psa', chapter: 27 });
  });

  it('keeps only chunks overlapping the anchor verse', async () => {
    setResult({
      data: [
        row({ id: 'hit', verse_start: 1, verse_end: 14 }),
        row({ id: 'miss', verse_start: 20, verse_end: 22 }),
        row({ id: 'whole-chapter', verse_start: null, verse_end: null }),
      ],
      error: null,
    });
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices.map((v) => v.chunkId)).toEqual(['whole-chapter', 'hit']);
  });

  it('labels each voice through composeSourceLabel and strips the ingest prefix', async () => {
    setResult({
      data: [row({ content: 'Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:\nOne thing have I desired.' })],
      error: null,
    });
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices[0].sourceLabel).toBe('The Treasury of David · Charles H. Spurgeon, 1869–1885');
    expect(result.current.voices[0].content).toBe('One thing have I desired.');
    expect(result.current.voices[0].tradition).toBe('Baptist (Reformed)');
  });

  it('orders deterministically — source, then chapter-level before verse-level, then heading', async () => {
    setResult({
      data: [
        row({ id: 'h-v4', source_id: 'matthew-henry-concise', heading: 'b', verse_start: 4, library_sources: HENRY }),
        row({ id: 's-v4', source_id: 'treasury-of-david', heading: 'z', verse_start: 4 }),
        row({ id: 'h-ch', source_id: 'matthew-henry-concise', heading: 'a', verse_start: null, verse_end: null, library_sources: HENRY }),
        row({ id: 's-ch', source_id: 'treasury-of-david', heading: 'a', verse_start: null, verse_end: null }),
      ],
      error: null,
    });
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices.map((v) => v.chunkId)).toEqual(['h-ch', 'h-v4', 's-ch', 's-v4']);
  });

  it('treats a whole-chapter anchor as matching every chunk in the chapter', async () => {
    setResult({
      data: [row({ id: 'v1', verse_start: 1, verse_end: 1 }), row({ id: 'v9', verse_start: 9, verse_end: 9 })],
      error: null,
    });
    const { result } = renderHook(() => useLibraryVoices({ book: 'psa', chapter: 27 }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices).toHaveLength(2);
  });

  it('degrades to no voices on a query error, surfacing nothing to the reader', async () => {
    setResult({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices).toEqual([]);
    expect(result.current).not.toHaveProperty('error');
  });

  it('returns no voices for a chapter with no library coverage', async () => {
    setResult({ data: [], error: null });
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices).toEqual([]);
  });

  it('drops a chunk whose source row is missing rather than labelling it blank', async () => {
    setResult({ data: [row({ id: 'orphan', library_sources: null })], error: null });
    const { result } = renderHook(() => useLibraryVoices(ANCHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.voices).toEqual([]);
  });

  it('does not query at all without an anchor', async () => {
    const { result } = renderHook(() => useLibraryVoices(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).not.toHaveBeenCalled();
    expect(result.current.voices).toEqual([]);
  });

  it('re-queries when the anchor moves to another verse', async () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: RefAnchor }) => useLibraryVoices(a),
      { initialProps: { a: ANCHOR } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(queries).toHaveLength(1);

    rerender({ a: { book: 'psa', chapter: 27, verseStart: 8, verseEnd: 8 } });
    await waitFor(() => expect(queries).toHaveLength(2));
  });

  it('does not re-query when an equivalent anchor object is passed again', async () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: RefAnchor }) => useLibraryVoices(a),
      { initialProps: { a: { ...ANCHOR } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ a: { ...ANCHOR } });   // fresh identity, same ref — must not refetch
    await new Promise((r) => setTimeout(r, 0));
    expect(queries).toHaveLength(1);
  });
});
