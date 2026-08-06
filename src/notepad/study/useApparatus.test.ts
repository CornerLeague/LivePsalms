// @vitest-environment jsdom
// src/notepad/study/useApparatus.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { BibleTranslation } from '../bible/translations';

interface Query { table: string; filters: Record<string, unknown> }
type Result = { data: unknown; error: unknown };

// A table-routing PostgREST stub: every `from()` records its table and the
// filters applied to it, so a test can assert *which* columns a query narrowed
// on — the whole point here is that `bible_passages` must narrow on translation.
const { from, queries, setHandler } = vi.hoisted(() => {
  const queries: Query[] = [];
  let handler: (q: Query) => Result = () => ({ data: null, error: null });
  const from = vi.fn((table: string) => {
    const q: Query = { table, filters: {} };
    queries.push(q);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { q.filters[col] = val; return builder; };
    builder.order = () => builder;
    builder.limit = () => Promise.resolve(handler(q));
    builder.maybeSingle = () => Promise.resolve(handler(q));
    return builder;
  });
  return { from, queries, setHandler: (h: (q: Query) => Result) => { handler = h; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useApparatus } from './useApparatus';

const BOOK_ROW = {
  book: 'psa', full_name: 'Psalms', author: 'David and others', author_note: 'multiple authors',
  date_label: '~1000–400 BC', region: 'Israel', cultural_context: 'Temple worship',
  genre: 'Poetry', summary: 'The songbook of Israel.',
};
const XREF_ROW = { to_book: 'heb', to_chapter: 11, to_verse_start: 6, to_verse_end: 6, votes: 42 };

const KJV_TEXT = 'But without faith it is impossible to please him';
const BSB_TEXT = 'And without faith it is impossible to please God';

// Models the real table faithfully: bible_passages' primary key is
// (translation, id) since migration 036, so a read that does NOT narrow on
// translation matches one row per ingested translation — and `maybeSingle()`
// answers a multi-row match with a PGRST116 error and null data.
function routeQuery(q: Query): Result {
  if (q.table === 'bible_books') return { data: BOOK_ROW, error: null };
  if (q.table === 'bible_cross_references') return { data: [XREF_ROW], error: null };
  if (q.table === 'bible_passages') {
    if (q.filters.translation === undefined) {
      return { data: null, error: { code: 'PGRST116', message: 'multiple (or no) rows returned' } };
    }
    return { data: { text: q.filters.translation === 'KJV' ? KJV_TEXT : BSB_TEXT }, error: null };
  }
  return { data: null, error: null };
}

beforeEach(() => {
  from.mockClear();
  queries.length = 0;
  setHandler(routeQuery);
});
afterEach(cleanup);

describe('useApparatus', () => {
  it('reads cross-reference text in the active translation', async () => {
    const { result } = renderHook(() => useApparatus('psa', 27, 'KJV'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.crossRefs).toHaveLength(1);
    expect(result.current.crossRefs[0].text).toBe(KJV_TEXT);
  });

  it('narrows the bible_passages read on translation', async () => {
    const { result } = renderHook(() => useApparatus('psa', 27, 'KJV'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const passageQueries = queries.filter((q) => q.table === 'bible_passages');
    expect(passageQueries).toHaveLength(1);
    expect(passageQueries[0].filters).toMatchObject({ id: 'heb.11.6', translation: 'KJV' });
  });

  it('is not pinned to one translation', async () => {
    const { result } = renderHook(() => useApparatus('psa', 27, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.crossRefs[0].text).toBe(BSB_TEXT);
  });

  it('refetches when the translation changes', async () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: BibleTranslation }) => useApparatus('psa', 27, t),
      { initialProps: { t: 'BSB' as BibleTranslation } },
    );
    await waitFor(() => expect(result.current.crossRefs[0]?.text).toBe(BSB_TEXT));

    rerender({ t: 'KJV' as BibleTranslation });
    await waitFor(() => expect(result.current.crossRefs[0]?.text).toBe(KJV_TEXT));
  });

  it('still loads book context alongside the cross-references', async () => {
    const { result } = renderHook(() => useApparatus('psa', 27, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.book?.full_name).toBe('Psalms');
    expect(result.current.book?.author_note).toBe('multiple authors');
  });

  it('flags cross-references that cross the testament divide', async () => {
    const { result } = renderHook(() => useApparatus('psa', 27, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.crossRefs[0].crossesTestament).toBe(true);
  });
});
