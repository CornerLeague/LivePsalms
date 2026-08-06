// @vitest-environment jsdom
// src/notepad/study/insights/useCrossRefDetail.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { CrossRefTarget } from './useCrossRefDetail';

interface Query { table: string; filters: Record<string, unknown>; ranges: Record<string, unknown> }

const { from, queries, setTableData } = vi.hoisted(() => {
  const queries: Query[] = [];
  const data = new Map<string, unknown>();
  const from = vi.fn((table: string) => {
    const q: Query = { table, filters: {}, ranges: {} };
    queries.push(q);
    const builder: Record<string, unknown> = {};
    const settle = () => Promise.resolve({ data: data.get(table) ?? null, error: null });
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { q.filters[col] = val; return builder; };
    builder.gte = (col: string, val: unknown) => { q.ranges[`${col}>=`] = val; return builder; };
    builder.lte = (col: string, val: unknown) => { q.ranges[`${col}<=`] = val; return builder; };
    builder.order = () => builder;
    builder.limit = settle;
    builder.maybeSingle = settle;
    return builder;
  });
  return { from, queries, setTableData: (t: string, v: unknown) => data.set(t, v) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useCrossRefDetail } from './useCrossRefDetail';

const TARGET: CrossRefTarget = { book: 'heb', chapter: 11, verseStart: 6, verseEnd: 6 };

beforeEach(() => {
  from.mockClear();
  queries.length = 0;
  setTableData('bible_passages', [
    { verse_start: 5, text: 'By faith Enoch was taken up.' },
    { verse_start: 6, text: 'And without faith it is impossible to please God.' },
    { verse_start: 7, text: 'By faith Noah built an ark.' },
  ]);
  setTableData('bible_books', {
    full_name: 'Hebrews', author: 'Unknown', author_note: 'authorship disputed since antiquity',
    date_label: '~65 AD', genre: 'Epistle',
  });
  setTableData('library_chunks', []);
});
afterEach(cleanup);

describe('useCrossRefDetail', () => {
  it('does no work at all until a target is supplied', async () => {
    const { result } = renderHook(() => useCrossRefDetail(null, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).not.toHaveBeenCalled();
    expect(result.current.detail).toBeNull();
  });

  it('returns the target verse with one verse of context either side', async () => {
    const { result } = renderHook(() => useCrossRefDetail(TARGET, 'BSB'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    expect(result.current.detail!.verses.map((v) => v.verse)).toEqual([5, 6, 7]);
    expect(result.current.detail!.verses.find((v) => v.isTarget)?.verse).toBe(6);
  });

  it('reads the passage window in the active translation', async () => {
    const { result } = renderHook(() => useCrossRefDetail(TARGET, 'KJV'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    const passages = queries.find((q) => q.table === 'bible_passages')!;
    expect(passages.filters).toMatchObject({ translation: 'KJV', book: 'heb', chapter: 11 });
    expect(passages.ranges).toMatchObject({ 'verse_start>=': 5, 'verse_start<=': 7 });
  });

  it('clamps the context window at the start of a chapter', async () => {
    renderHook(() => useCrossRefDetail({ book: 'heb', chapter: 11, verseStart: 1, verseEnd: 1 }, 'BSB'));
    await waitFor(() => expect(queries.some((q) => q.table === 'bible_passages')).toBe(true));

    expect(queries.find((q) => q.table === 'bible_passages')!.ranges['verse_start>=']).toBe(1);
  });

  it('marks every verse of a multi-verse target', async () => {
    const { result } = renderHook(() => useCrossRefDetail({ book: 'heb', chapter: 11, verseStart: 5, verseEnd: 6 }, 'BSB'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    expect(result.current.detail!.verses.filter((v) => v.isTarget).map((v) => v.verse)).toEqual([5, 6]);
  });

  it('carries the target book’s own context so a jump lands with its footing', async () => {
    const { result } = renderHook(() => useCrossRefDetail(TARGET, 'BSB'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    expect(result.current.detail!.book).toMatchObject({
      full_name: 'Hebrews', date_label: '~65 AD', genre: 'Epistle',
    });
  });

  it('keeps the target book’s authorship hedge', async () => {
    const { result } = renderHook(() => useCrossRefDetail(TARGET, 'BSB'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    expect(result.current.detail!.book!.author_note).toBe('authorship disputed since antiquity');
  });

  it('asks the library for voices on the target ref, not the ref we came from', async () => {
    const { result } = renderHook(() => useCrossRefDetail(TARGET, 'BSB'));
    await waitFor(() => expect(result.current.detail).not.toBeNull());

    const lib = queries.find((q) => q.table === 'library_chunks')!;
    expect(lib.filters).toMatchObject({ book: 'heb', chapter: 11 });
  });

  it('still resolves when the passage window comes back empty', async () => {
    setTableData('bible_passages', []);
    const { result } = renderHook(() => useCrossRefDetail(TARGET, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.detail!.verses).toEqual([]);
  });
});
