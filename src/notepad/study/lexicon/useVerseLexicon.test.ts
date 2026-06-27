// @vitest-environment jsdom
// src/notepad/study/lexicon/useVerseLexicon.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { order, select, eq, from, getBuilder, setOrderResult } = vi.hoisted(() => {
  const order = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let orderResult: { data: unknown; error: unknown } = { data: [], error: null };
  const builder = {
    select, eq, order,
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(resolve(orderResult)),
  };
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  return { order, select, eq, from, getBuilder: () => builder, setOrderResult: (v: { data: unknown; error: unknown }) => { orderResult = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useVerseLexicon } from './useVerseLexicon';

beforeEach(() => {
  from.mockClear(); select.mockClear(); eq.mockClear(); order.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setOrderResult({ data: [], error: null });
});
afterEach(cleanup);

describe('useVerseLexicon', () => {
  it('queries bible_interlinear and maps rows to words + language', async () => {
    setOrderResult({
      data: [
        { position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning', language: 'hebrew' },
        { position: 2, original: 'בָּרָא', transliteration: 'bara', strongs: 'H1254', morph: 'HVqp3ms', gloss: 'created', language: 'hebrew' },
      ],
      error: null,
    });
    const { result } = renderHook(() => useVerseLexicon('gen.1.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).toHaveBeenCalledWith('bible_interlinear');
    expect(eq).toHaveBeenCalledWith('verse_id', 'gen.1.1');
    expect(order).toHaveBeenCalledWith('position', { ascending: true });
    expect(result.current.language).toBe('hebrew');
    expect(result.current.words).toEqual([
      { position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning' },
      { position: 2, original: 'בָּרָא', transliteration: 'bara', strongs: 'H1254', morph: 'HVqp3ms', gloss: 'created' },
    ]);
  });

  it('does not query and returns empty when verseId is null', async () => {
    const { result } = renderHook(() => useVerseLexicon(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.words).toEqual([]);
    expect(result.current.language).toBeNull();
  });

  it('surfaces a query error and empties words', async () => {
    setOrderResult({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useVerseLexicon('gen.1.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.words).toEqual([]);
    expect(result.current.error).toBe('boom');
  });
});
