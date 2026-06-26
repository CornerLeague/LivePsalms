// @vitest-environment jsdom
// src/notepad/study/lexicon/useStrongsEntry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { maybeSingle, select, eq, from, getBuilder, setResult } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const builder = { select, eq, maybeSingle };
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  maybeSingle.mockImplementation(() => Promise.resolve(result));
  from.mockImplementation(() => builder);
  return { maybeSingle, select, eq, from, getBuilder: () => builder, setResult: (v: { data: unknown; error: unknown }) => { result = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useStrongsEntry } from './useStrongsEntry';

beforeEach(() => {
  from.mockClear(); select.mockClear(); eq.mockClear(); maybeSingle.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setResult({ data: null, error: null });
  maybeSingle.mockImplementation(() => Promise.resolve({ data: null, error: null }));
});
afterEach(cleanup);

describe('useStrongsEntry', () => {
  it('fetches one row and maps snake_case columns to the entry', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({
      data: { strongs: 'H7225', lemma: 'רֵאשִׁית', transliteration: 'reshith', pronunciation: 'ray-sheeth', short_def: 'first', full_def: 'first, in place, time, order', language: 'hebrew' },
      error: null,
    }));
    const { result } = renderHook(() => useStrongsEntry('H7225'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).toHaveBeenCalledWith('bible_strongs');
    expect(eq).toHaveBeenCalledWith('strongs', 'H7225');
    expect(result.current.entry).toEqual({
      strongs: 'H7225', lemma: 'רֵאשִׁית', transliteration: 'reshith', pronunciation: 'ray-sheeth',
      shortDef: 'first', fullDef: 'first, in place, time, order', language: 'hebrew',
    });
  });

  it('returns null entry without querying when strongs is null', async () => {
    const { result } = renderHook(() => useStrongsEntry(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.entry).toBeNull();
  });

  it('serves a repeated lookup from cache (no second query)', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({
      data: { strongs: 'G2316', lemma: 'θεός', transliteration: 'theos', pronunciation: 'theh-os', short_def: 'God', full_def: 'a deity; God', language: 'greek' },
      error: null,
    }));
    const first = renderHook(() => useStrongsEntry('G2316'));
    await waitFor(() => expect(first.result.current.entry?.strongs).toBe('G2316'));
    const callsAfterFirst = from.mock.calls.length;
    const second = renderHook(() => useStrongsEntry('G2316'));
    await waitFor(() => expect(second.result.current.entry?.strongs).toBe('G2316'));
    expect(from.mock.calls.length).toBe(callsAfterFirst);
  });

  it('queries bible_strongs by the normalized key for a raw STEP value', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({
      data: { strongs: 'G25', lemma: 'ἀγαπάω', transliteration: 'agapao', pronunciation: 'ag-ap-ah-o', short_def: 'to love', full_def: 'to love (in a social or moral sense)', language: 'greek' },
      error: null,
    }));
    const { result } = renderHook(() => useStrongsEntry('G0025')); // John 3:16 "loved"
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(eq).toHaveBeenCalledWith('strongs', 'G25');
    expect(result.current.entry?.strongs).toBe('G25');
  });

  it('shares one cache entry across raw and canonical forms of the same number', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({
      data: { strongs: 'H430', lemma: 'אֱלֹהִים', transliteration: 'elohim', pronunciation: 'el-o-heem', short_def: 'God', full_def: 'gods, God', language: 'hebrew' },
      error: null,
    }));
    const first = renderHook(() => useStrongsEntry('H0430')); // padded
    await waitFor(() => expect(first.result.current.entry?.strongs).toBe('H430'));
    const callsAfterFirst = from.mock.calls.length;
    const second = renderHook(() => useStrongsEntry('H430')); // already canonical
    await waitFor(() => expect(second.result.current.entry?.strongs).toBe('H430'));
    expect(from.mock.calls.length).toBe(callsAfterFirst);
  });
});
