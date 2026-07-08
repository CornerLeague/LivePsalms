// @vitest-environment jsdom
// src/notepad/study/lexicon/useReviewedEtymologyEntries.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { from, select, inFn, eq, getBuilder, setResult } = vi.hoisted(() => {
  const select = vi.fn();
  const inFn = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const builder = { select, in: inFn, eq };
  select.mockImplementation(() => builder);
  inFn.mockImplementation(() => builder);
  eq.mockImplementation(() => Promise.resolve(result)); // terminal: .eq('reviewed', true)
  from.mockImplementation(() => builder);
  return { from, select, inFn, eq, getBuilder: () => builder, setResult: (v: { data: unknown; error: unknown }) => { result = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useReviewedEtymologyEntries } from './useReviewedEtymologyEntries';

const ROW = {
  strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', root_gloss: 'to tend, graze',
  development: 'From the root of tending a flock…', related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }],
  study_value: 9, source: "Strong's + BDB",
};

beforeEach(() => {
  from.mockClear(); select.mockClear(); inFn.mockClear(); eq.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  inFn.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setResult({ data: [], error: null });
  eq.mockImplementation(() => Promise.resolve({ data: [], error: null }));
});
afterEach(cleanup);

describe('useReviewedEtymologyEntries', () => {
  it('fetches reviewed rows and maps snake_case → camelCase into a Map keyed by strongs', async () => {
    setResult({ data: [ROW], error: null });
    eq.mockImplementation(() => Promise.resolve({ data: [ROW], error: null }));
    const { result } = renderHook(() => useReviewedEtymologyEntries(['H7462']));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).toHaveBeenCalledWith('bible_etymology');
    expect(eq).toHaveBeenCalledWith('reviewed', true);
    expect(result.current.entries.get('H7462')).toEqual({
      strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze',
      development: 'From the root of tending a flock…',
      related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }],
      studyValue: 9, source: "Strong's + BDB",
    });
  });

  it('returns an empty map without querying when given no keys', async () => {
    const { result } = renderHook(() => useReviewedEtymologyEntries([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.entries.size).toBe(0);
  });
});
