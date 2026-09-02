// @vitest-environment jsdom
// src/notepad/bible/useBiblePassages.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';

// Chainable supabase query builder mock. select/like/order/eq return `this`;
// the builder resolves (await) to { data, error }.
// Use vi.hoisted so these refs are available when vi.mock() factory is hoisted.
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

import { useBiblePassages } from './useBiblePassages';
import { clearBibleTextCache } from './bible-text-client';

beforeEach(() => {
  from.mockClear(); select.mockClear(); like.mockClear(); order.mockClear(); eq.mockClear();
  invoke.mockReset();
  clearBibleTextCache();
  // re-wire implementations after mockClear (mockClear only clears call history)
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  like.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setOrderResult({ data: [], error: null });
});
afterEach(cleanup);

describe('useBiblePassages', () => {
  it('queries verse rows for a chapter and maps them to {verse,text}', async () => {
    setOrderResult({
      data: [
        { id: 'jhn.10.1', verse_start: 1, text: 'Truly, truly...' },
        { id: 'jhn.10.2', verse_start: 2, text: 'But he who enters...' },
      ],
      error: null,
    });
    const { result } = renderHook(() => useBiblePassages('jhn', 10, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).toHaveBeenCalledWith('bible_passages');
    expect(like).toHaveBeenCalledWith('id', 'jhn.10.%');
    expect(order).toHaveBeenCalledWith('verse_start', { ascending: true });
    expect(result.current.verses).toEqual([
      { verse: 1, text: 'Truly, truly...' },
      { verse: 2, text: 'But he who enters...' },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a query error and empties verses', async () => {
    setOrderResult({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useBiblePassages('jhn', 10, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.verses).toEqual([]);
    expect(result.current.error).toBe('boom');
  });

  it('filters bible_passages by the given translation', async () => {
    setOrderResult({
      data: [{ id: 'jhn.1.1', verse_start: 1, text: 'In the beginning was the Word...' }],
      error: null,
    });
    const { result } = renderHook(() => useBiblePassages('jhn', 1, 'KJV'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(eq).toHaveBeenCalledWith('translation', 'KJV');
  });
});

describe('useBiblePassages for an api-sourced translation', () => {
  it('invokes bible-text instead of querying bible_passages, and maps the verses', async () => {
    invoke.mockResolvedValue({ data: { ok: true, verses: [{ verse: 1, text: 'The Lord is my shepherd;' }] }, error: null });
    const { result } = renderHook(() => useBiblePassages('psa', 23, 'NLT'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(invoke).toHaveBeenCalledWith('bible-text', { body: { book: 'psa', chapter: 23, translation: 'NLT' } });
    expect(from).not.toHaveBeenCalled();
    expect(result.current.verses).toEqual([{ verse: 1, text: 'The Lord is my shepherd;' }]);
    expect(result.current.error).toBeNull();
  });

  it('turns a soft failure into a worded error and retry() refetches', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: false, reason: 'missing_key' }, error: null });
    const { result } = renderHook(() => useBiblePassages('psa', 23, 'ESV'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.verses).toEqual([]);
    expect(result.current.error).toMatch(/English Standard Version isn't connected/);

    invoke.mockResolvedValueOnce({ data: { ok: true, verses: [{ verse: 1, text: 'ok now' }] }, error: null });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.verses).toEqual([{ verse: 1, text: 'ok now' }]));
    expect(result.current.error).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('names a 401 as a sign-in problem', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'non-2xx', context: { status: 401 } } });
    const { result } = renderHook(() => useBiblePassages('psa', 23, 'NLT'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Sign in to read the NLT.');
  });

  it('still never touches bible_passages for a local translation via invoke', async () => {
    setOrderResult({ data: [{ id: 'psa.23.1', verse_start: 1, text: 'x' }], error: null });
    const { result } = renderHook(() => useBiblePassages('psa', 23, 'WEB'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(invoke).not.toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('translation', 'WEB');
  });
});
