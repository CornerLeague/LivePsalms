// @vitest-environment jsdom
// src/notepad/study/lexicon/useEtymologyVerseInsight.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const { from, select, eq, maybeSingle, getBuilder, setResult } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingle = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const builder = { select, eq, maybeSingle };
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  maybeSingle.mockImplementation(() => Promise.resolve(result));
  from.mockImplementation(() => builder);
  return { from, select, eq, maybeSingle, getBuilder: () => builder, setResult: (v: { data: unknown; error: unknown }) => { result = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useEtymologyVerseInsight } from './useEtymologyVerseInsight';

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

describe('useEtymologyVerseInsight', () => {
  it('renders an existing insight row for free (read hit), never calling generate', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({ data: { body: 'A shared insight.' }, error: null }));
    const adapter = { generateEtymologyInsight: vi.fn() };
    const { result } = renderHook(() => useEtymologyVerseInsight('H7462', 'psa.23.1', adapter));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.insight).toEqual({ body: 'A shared insight.' });
    expect(adapter.generateEtymologyInsight).not.toHaveBeenCalled();
  });

  it('on read miss, generate() calls the adapter and shows the returned body inline', async () => {
    const adapter = {
      generateEtymologyInsight: vi.fn().mockResolvedValue({ ok: true, body: 'Freshly generated.', cached: false }),
    };
    const { result } = renderHook(() => useEtymologyVerseInsight('H7462', 'psa.23.1', adapter));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.insight).toBeNull();
    await act(async () => { await result.current.generate(); });
    expect(adapter.generateEtymologyInsight).toHaveBeenCalledWith('H7462', 'psa.23.1');
    expect(result.current.insight).toEqual({ body: 'Freshly generated.' });
  });

  it('surfaces a soft error and no insight when generation fails', async () => {
    const adapter = {
      generateEtymologyInsight: vi.fn().mockResolvedValue({ ok: false, reason: 'network' }),
    };
    const { result } = renderHook(() => useEtymologyVerseInsight('H7462', 'psa.23.1', adapter));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });
    expect(result.current.insight).toBeNull();
    expect(result.current.error).toBe('network');
  });

  it('clears a stale insight when re-rendered with invalid (null) args', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({ data: { body: 'A shared insight.' }, error: null }));
    const adapter = { generateEtymologyInsight: vi.fn() };
    const { result, rerender } = renderHook(
      ({ s, v }: { s: string | null; v: string | null }) => useEtymologyVerseInsight(s, v, adapter),
      { initialProps: { s: 'H7462' as string | null, v: 'psa.23.1' as string | null } },
    );
    await waitFor(() => expect(result.current.insight).toEqual({ body: 'A shared insight.' }));
    await act(async () => { rerender({ s: null, v: null }); });
    await waitFor(() => expect(result.current.insight).toBeNull());
    expect(result.current.error).toBeNull();
  });
});
