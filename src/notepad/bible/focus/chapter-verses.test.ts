import { describe, it, expect, vi, beforeEach } from 'vitest';

const { order, like, select, eq, from, invoke, setOrderResult } = vi.hoisted(() => {
  const order = vi.fn();
  const like = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  const invoke = vi.fn();
  let orderResult: { data: unknown; error: unknown } = { data: [], error: null };
  const builder = {
    select, like, order, eq,
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(resolve(orderResult)),
  };
  for (const fn of [select, like, order, eq, from]) fn.mockImplementation(() => builder);
  return {
    order, like, select, eq, from, invoke,
    setOrderResult: (v: { data: unknown; error: unknown }) => { orderResult = v; },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from, functions: { invoke } } }));

import { loadChapterVerses } from './chapter-verses';
import { clearBibleTextCache } from '../bible-text-client';

beforeEach(() => {
  from.mockClear(); select.mockClear(); like.mockClear(); order.mockClear(); eq.mockClear();
  invoke.mockReset();
  clearBibleTextCache();
  setOrderResult({ data: [], error: null });
});

describe('loadChapterVerses', () => {
  it('reads verse numbers from bible_passages for a local translation', async () => {
    setOrderResult({ data: [{ verse_start: 1 }, { verse_start: 2 }, { verse_start: 3 }], error: null });
    const verses = await loadChapterVerses('psa', 23, 'KJV');
    expect(from).toHaveBeenCalledWith('bible_passages');
    expect(eq).toHaveBeenCalledWith('translation', 'KJV');
    expect(like).toHaveBeenCalledWith('id', 'psa.23.%');
    expect(order).toHaveBeenCalledWith('verse_start', { ascending: true });
    expect(invoke).not.toHaveBeenCalled();
    expect(verses).toEqual([1, 2, 3]);
  });

  it('reads verse numbers through bible-text for an api-sourced translation', async () => {
    invoke.mockResolvedValue({ data: { ok: true, verses: [{ verse: 1, text: 'a' }, { verse: 2, text: 'b' }] }, error: null });
    const verses = await loadChapterVerses('psa', 23, 'NLT');
    expect(invoke).toHaveBeenCalledWith('bible-text', { body: { book: 'psa', chapter: 23, translation: 'NLT' } });
    expect(from).not.toHaveBeenCalled();
    expect(verses).toEqual([1, 2]);
  });

  it('returns [] when the provider fails', async () => {
    invoke.mockResolvedValue({ data: { ok: false, reason: 'missing_key' }, error: null });
    expect(await loadChapterVerses('psa', 23, 'ESV')).toEqual([]);
  });
});
