// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';

// Chainable supabase builder mock (mirrors useBiblePassages.test.ts): select/eq/
// like/order return `this`; awaiting the builder resolves to { data, error }.
const { order, like, select, eq, from, invoke, getBuilder, setOrderResult } = vi.hoisted(() => {
  const order = vi.fn();
  const like = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  const invoke = vi.fn();
  let orderResult: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: {
    select: typeof select; like: typeof like; order: typeof order; eq: typeof eq;
    then: (r: (v: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
  } = {
    select, like, order, eq,
    then: (resolve) => Promise.resolve(resolve(orderResult)),
  };
  select.mockImplementation(() => builder);
  like.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  return {
    order, like, select, eq, from, invoke,
    getBuilder: () => builder,
    setOrderResult: (v: { data: unknown; error: unknown }) => { orderResult = v; },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from, functions: { invoke } } }));

import { assembleFocusItemTexts, useFocusListVerseText } from './useFocusListVerseText';
import { clearBibleTextCache } from '../bible-text-client';
import type { FocusListItem } from './focus-list-types';
import type { FocusItemText, FocusVerseLine } from './useFocusListVerseText';

const item = (over: Partial<FocusListItem>): FocusListItem => ({
  id: 'i', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16,
  label: 'John 3:16', position: 0, ...over,
});

beforeEach(() => {
  from.mockClear(); select.mockClear(); like.mockClear(); order.mockClear(); eq.mockClear();
  invoke.mockReset();
  clearBibleTextCache();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  like.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setOrderResult({ data: [], error: null });
});
afterEach(cleanup);

describe('assembleFocusItemTexts (pure)', () => {
  it('keeps only the single verse for a single-verse item', () => {
    const items = [item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16 })];
    const rows: FocusVerseLine[] = [
      { verse: 15, text: 'that whoever believes' },
      { verse: 16, text: 'For God so loved the world' },
      { verse: 17, text: 'For God did not send his Son' },
    ];
    const out = assembleFocusItemTexts(items, new Map([['jhn.3', rows]]));
    expect(out).toHaveLength(1);
    expect(out[0].missing).toBe(false);
    expect(out[0].lines.map((l) => l.verse)).toEqual([16]);
    expect(out[0].lines[0].text).toBe('For God so loved the world');
  });

  it('keeps every verse within an inclusive range', () => {
    const items = [item({ id: 'b', book: 'psa', chapter: 23, verseStart: 1, verseEnd: 3, label: 'Psalm 23:1-3' })];
    const rows: FocusVerseLine[] = [
      { verse: 1, text: 'The LORD is my shepherd' },
      { verse: 2, text: 'He makes me lie down' },
      { verse: 3, text: 'He restores my soul' },
      { verse: 4, text: 'Even though I walk' },
    ];
    const out = assembleFocusItemTexts(items, new Map([['psa.23', rows]]));
    expect(out[0].missing).toBe(false);
    expect(out[0].lines.map((l) => l.verse)).toEqual([1, 2, 3]);
  });

  it('flags an item missing when its chapter has no rows (missing in translation)', () => {
    const items = [item({ id: 'c', book: 'eph', chapter: 2, verseStart: 8, verseEnd: 9, label: 'Ephesians 2:8-9' })];
    const out = assembleFocusItemTexts(items, new Map()); // no rows fetched for eph.2
    expect(out[0].missing).toBe(true);
    expect(out[0].lines).toEqual([]);
  });

  it('preserves item order in the output', () => {
    const items = [
      item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' }),
      item({ id: 'b', book: 'psa', chapter: 23, verseStart: 1, verseEnd: 1, label: 'Psalm 23:1' }),
    ];
    const out = assembleFocusItemTexts(items, new Map([
      ['jhn.3', [{ verse: 16, text: 'x' }]],
      ['psa.23', [{ verse: 1, text: 'y' }]],
    ]));
    expect(out.map((o) => o.item.id)).toEqual(['a', 'b']);
  });
});

describe('useFocusListVerseText (hook)', () => {
  it('fetches the item chapter and assembles the verse line', async () => {
    setOrderResult({
      data: [
        { id: 'eph.2.8', verse_start: 8, text: 'For it is by grace you have been saved' },
        { id: 'eph.2.9', verse_start: 9, text: 'not by works, so that no one can boast' },
      ],
      error: null,
    });
    const items = [item({ id: 'x', book: 'eph', chapter: 2, verseStart: 8, verseEnd: 8, label: 'Ephesians 2:8' })];
    const { result } = renderHook(() => useFocusListVerseText(items, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).toHaveBeenCalledWith('bible_passages');
    expect(eq).toHaveBeenCalledWith('translation', 'BSB');
    expect(like).toHaveBeenCalledWith('id', 'eph.2.%');
    expect(order).toHaveBeenCalledWith('verse_start', { ascending: true });
    expect(result.current.itemTexts).toHaveLength(1);
    expect(result.current.itemTexts[0].missing).toBe(false);
    expect(result.current.itemTexts[0].lines.map((l) => l.verse)).toEqual([8]);
  });

  it('returns no item texts and loads nothing for an empty list', async () => {
    const out: FocusItemText[] = [];
    const { result } = renderHook(() => useFocusListVerseText(out as never, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.itemTexts).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('useFocusListVerseText (hook) for an api-sourced translation', () => {
  it('fetches each chapter through bible-text and never queries bible_passages', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { book: string; chapter: number } }) => ({
      data: { ok: true, verses: [{ verse: 16, text: `${opts.body.book}.${opts.body.chapter}:16` }] },
      error: null,
    }));
    const items = [
      item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' }),
      item({ id: 'b', book: 'rom', chapter: 8, verseStart: 16, verseEnd: 16, label: 'Romans 8:16' }),
    ];
    const { result } = renderHook(() => useFocusListVerseText(items, 'ESV'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith('bible-text', { body: { book: 'jhn', chapter: 3, translation: 'ESV' } });
    expect(result.current.itemTexts.map((t) => t.lines[0]?.text)).toEqual(['jhn.3:16', 'rom.8:16']);
  });

  it('reports a provider failure as a worded error, not just a missing item', async () => {
    invoke.mockResolvedValue({ data: { ok: false, reason: 'rate_limited' }, error: null });
    const items = [item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16 })];
    const { result } = renderHook(() => useFocusListVerseText(items, 'NLT'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.itemTexts[0].missing).toBe(true);
    expect(result.current.error).toBe('The NLT service is busy right now. Try again in a minute.');
  });

  it('retry() refetches and clears the error once the provider answers', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'non-2xx', context: { status: 401 } } });
    const items = [item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16 })];
    const { result } = renderHook(() => useFocusListVerseText(items, 'ESV'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Sign in to read the ESV.');

    invoke.mockResolvedValueOnce({ data: { ok: true, verses: [{ verse: 16, text: 'back' }] }, error: null });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.itemTexts[0].missing).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.itemTexts[0].lines[0].text).toBe('back');
  });

  it('has no error when every chapter fetched, even if an item is genuinely absent', async () => {
    invoke.mockResolvedValue({ data: { ok: true, verses: [{ verse: 1, text: 'only verse one' }] }, error: null });
    const items = [item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16 })];
    const { result } = renderHook(() => useFocusListVerseText(items, 'NLT'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.itemTexts[0].missing).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
