import { describe, it, expect, vi } from 'vitest';
import { createBrowserVerseSearchDeps } from './verse-search-client';

function fakeClient(captured: Array<{ col: string; val: unknown }>) {
  const b: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'select', 'like', 'textSearch', 'limit', 'order', 'abortSignal']) b[m] = vi.fn(() => b);
  (b as Record<string, unknown>).eq = vi.fn((col: string, val: unknown) => { captured.push({ col, val }); return b; });
  (b as Record<string, unknown>).then = (res: (v: unknown) => void) => res({ data: [], error: null });
  return b as unknown as Parameters<typeof createBrowserVerseSearchDeps>[0];
}

function makeSupabaseStub(over: Record<string, unknown> = {}) {
  return {
    from: vi.fn(),
    functions: { invoke: vi.fn(async () => ({ data: { matches: [] }, error: null })) },
    ...over,
  };
}

describe('createBrowserVerseSearchDeps translation', () => {
  it('FTS filters by the given translation', async () => {
    const captured: Array<{ col: string; val: unknown }> = [];
    const deps = createBrowserVerseSearchDeps(fakeClient(captured), 'KJV');
    await deps.ftsSearch('love', {});
    expect(captured).toContainEqual({ col: 'translation', val: 'KJV' });
  });

  it('resolvePericope filters by the given translation', async () => {
    const captured: Array<{ col: string; val: unknown }> = [];
    const deps = createBrowserVerseSearchDeps(fakeClient(captured), 'WEB');
    await deps.resolvePericope('jhn.3', {});
    expect(captured).toContainEqual({ col: 'translation', val: 'WEB' });
  });

  it('reports the chosen translation as the one whose rows it reads, for a local one', () => {
    const deps = createBrowserVerseSearchDeps(fakeClient([]), 'KJV');
    expect(deps.translation).toBe('KJV');
    expect(deps.rowsTranslation).toBe('KJV');
  });

  it('searches BSB rows for an api-sourced translation and says so on the deps', async () => {
    const captured: Array<{ col: string; val: unknown }> = [];
    const deps = createBrowserVerseSearchDeps(fakeClient(captured), 'NLT');
    await deps.ftsSearch('shepherd', {});
    await deps.resolvePericope('psa.23', {});
    expect(captured.filter((c) => c.col === 'translation').map((c) => c.val)).toEqual(['BSB', 'BSB']);
    expect(deps.translation).toBe('NLT');
    expect(deps.rowsTranslation).toBe('BSB');
  });
});

describe('createBrowserVerseSearchDeps.ftsSearch', () => {
  it('queries text_tsv with websearch, BSB filter, and maps rows', async () => {
    const order = vi.fn(async () => ({
      data: [{ id: 'jhn.3.16', book: 'John', chapter: 3, verse_start: 16, verse_end: null, text: 'For God...' }],
      error: null,
    }));
    const limit = vi.fn(() => ({ order }));
    const textSearch = vi.fn(() => ({ limit }));
    const like = vi.fn(() => ({ textSearch }));
    const eq = vi.fn(() => ({ like, textSearch }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ from }) as never);

    const rows = await deps.ftsSearch('love', {});
    expect(from).toHaveBeenCalledWith('bible_passages');
    expect(eq).toHaveBeenCalledWith('translation', 'BSB');
    expect(textSearch).toHaveBeenCalledWith('text_tsv', 'love', { type: 'websearch' });
    expect(rows[0]).toMatchObject({ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null });
  });

  it('restricts the FTS query to verse-grain ids (≥2 dots) to protect the row budget', async () => {
    const order = vi.fn(async () => ({ data: [], error: null }));
    const limit = vi.fn(() => ({ order }));
    const textSearch = vi.fn(() => ({ limit }));
    const like = vi.fn(() => ({ textSearch }));
    const eq = vi.fn(() => ({ like, textSearch }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ from }) as never);

    await deps.ftsSearch('shepherd', {});
    expect(like).toHaveBeenCalledWith('id', '%.%.%');
  });

  it('excludes pericope-grain aggregate rows from FTS results', async () => {
    const order = vi.fn(async () => ({
      data: [
        { id: 'psa.23.1', book: 'Psa', chapter: 23, verse_start: 1, verse_end: null, text: 'The LORD is my shepherd' },
        { id: 'psa.23', book: 'Psa', chapter: 23, verse_start: 1, verse_end: 6, text: 'A psalm of David...' },
      ],
      error: null,
    }));
    const limit = vi.fn(() => ({ order }));
    const textSearch = vi.fn(() => ({ limit }));
    const like = vi.fn(() => ({ textSearch }));
    const eq = vi.fn(() => ({ like, textSearch }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ from }) as never);

    const rows = await deps.ftsSearch('shepherd', {});
    expect(rows.map((r) => r.id)).toEqual(['psa.23.1']);
  });
});

describe('createBrowserVerseSearchDeps.semanticSearch', () => {
  it('invokes the verse-search edge fn and maps matches', async () => {
    const invoke = vi.fn(async () => ({
      data: { matches: [{ sourceId: 'jhn.3.16', text: 'x', similarity: 0.8 }] }, error: null,
    }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ functions: { invoke } }) as never);
    const rows = await deps.semanticSearch('love', {});
    expect(invoke).toHaveBeenCalledWith('verse-search', { body: { query: 'love' } });
    expect(rows[0]).toMatchObject({ sourceId: 'jhn.3.16', similarity: 0.8 });
  });

  it('returns [] when the edge fn errors (graceful degrade)', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ functions: { invoke } }) as never);
    expect(await deps.semanticSearch('love', {})).toEqual([]);
  });

  it('forwards the abort signal into functions.invoke (cancels stale requests)', async () => {
    const invoke = vi.fn(async () => ({ data: { matches: [] }, error: null }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ functions: { invoke } }) as never);
    const controller = new AbortController();
    await deps.semanticSearch('love', { signal: controller.signal });
    expect(invoke).toHaveBeenCalledWith('verse-search', { body: { query: 'love' }, signal: controller.signal });
  });
});

describe('createBrowserVerseSearchDeps.resolvePericope', () => {
  function pericopeStub(result: { data: unknown; error: unknown }) {
    const order = vi.fn(async () => result);
    const eq2 = vi.fn(() => ({ order }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select }));
    return { stub: makeSupabaseStub({ from }), from, eq1, eq2 };
  }

  it('returns null for an unknown osis book (no DB call)', async () => {
    const { stub, from } = pericopeStub({ data: [], error: null });
    const deps = createBrowserVerseSearchDeps(stub as never);
    expect(await deps.resolvePericope('zzz.3', {})).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when the query errors', async () => {
    const { stub } = pericopeStub({ data: null, error: { message: 'boom' } });
    const deps = createBrowserVerseSearchDeps(stub as never);
    expect(await deps.resolvePericope('jhn.3', {})).toBeNull();
  });

  it('aggregates rows into a PericopeRange (min/max verses, joined text, canonical book)', async () => {
    const rows = [
      { chapter: 3, verse_start: 1, verse_end: null, text: 'a' },
      { chapter: 3, verse_start: 2, verse_end: 21, text: 'b' },
    ];
    const { stub, eq1, eq2 } = pericopeStub({ data: rows, error: null });
    const deps = createBrowserVerseSearchDeps(stub as never);
    const range = await deps.resolvePericope('jhn.3', {});
    expect(range).not.toBeNull();
    expect(range!.book).toBe('John');
    expect(range!.chapter).toBe(3);
    expect(range!.verseStart).toBe(1);
    expect(range!.verseEnd).toBe(21);
    expect(range!.text).toBe('a b');
    expect(eq1).toHaveBeenCalledWith('pericope_id', 'jhn.3');
    expect(eq2).toHaveBeenCalledWith('translation', 'BSB');
  });
});
