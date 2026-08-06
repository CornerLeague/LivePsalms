// @vitest-environment jsdom
// src/notepad/study/insights/usePassageInsight.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import {
  passageRefId,
  PASSAGE_SECTIONS,
  type PassageInsightInvoke,
  type PassageInsightSseEvent,
} from './passage-insight-stream-client';

interface Query { table: string; filters: Record<string, unknown> }
type Result = { data: unknown; error: unknown };

const { from, queries, setResult } = vi.hoisted(() => {
  const queries: Query[] = [];
  let result: Result = { data: [], error: null };
  const from = vi.fn((table: string) => {
    const q: Query = { table, filters: {} };
    queries.push(q);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { q.filters[col] = val; return builder; };
    builder.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej);
    return builder;
  });
  return { from, queries, setResult: (r: Result) => { result = r; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { usePassageInsight } from './usePassageInsight';

const KEYS = PASSAGE_SECTIONS.map((s) => s.key);
const SCOPE = { book: 'psa', chapter: 27, verse: null };

function cachedRows(bodies: Partial<Record<string, string>> = {}) {
  return KEYS.map((k) => ({ section: k, body: bodies[k] ?? `cached ${k}` }));
}

/** An invoke that replays a fixed beat script. */
function scriptedInvoke(beats: PassageInsightSseEvent[]): PassageInsightInvoke {
  return vi.fn(async (_scope, handlers) => {
    for (const b of beats) handlers.onEvent(b);
  });
}

beforeEach(() => {
  queries.length = 0;
  setResult({ data: [], error: null });
  from.mockClear();
});
afterEach(() => cleanup());

describe('passageRefId — the cache key both sides must agree on', () => {
  it('composes a chapter ref', () => {
    expect(passageRefId({ book: 'psa', chapter: 27, verse: null })).toBe('psa.27');
  });

  it('composes a verse ref', () => {
    expect(passageRefId({ book: 'psa', chapter: 27, verse: 4 })).toBe('psa.27.4');
  });

  it('lowercases the book, exactly as the server does before writing', () => {
    // The server writes under its normalised ref. A client reading under 'Psa.27'
    // would miss a door sitting right there and re-bill every reader for it.
    expect(passageRefId({ book: 'PSA', chapter: 27, verse: null })).toBe('psa.27');
  });
});

describe('usePassageInsight — reading the cache', () => {
  it('reads on open and NEVER generates on its own', async () => {
    const invoke = scriptedInvoke([]);
    setResult({ data: cachedRows(), error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sections).not.toBeNull();
    // Explicit generate is the whole product decision — nothing generates on
    // open, ever.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('queries the door by scope, ref and door', async () => {
    setResult({ data: cachedRows(), error: null });
    const { result } = renderHook(() => usePassageInsight({ book: 'psa', chapter: 27, verse: 4 }, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(queries[0].table).toBe('bible_passage_insight');
    expect(queries[0].filters).toEqual({ scope: 'verse', ref_id: 'psa.27.4', door: 'passage' });
  });

  it('renders a cached door immediately — no stream, no generating state', async () => {
    const invoke = scriptedInvoke([]);
    setResult({ data: cachedRows(), error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sections!.overview).toBe('cached overview');
    expect(result.current.streaming).toBe(false);
    expect(result.current.cached).toBe(true);
  });

  it('reports an uncached door as null sections, not as empty ones', async () => {
    setResult({ data: [], error: null });
    const { result } = renderHook(() => usePassageInsight(SCOPE, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // null is what makes the door offer to generate; four empty strings would
    // render a door that was never written.
    expect(result.current.sections).toBeNull();
  });

  it('degrades a failed read to the generate path rather than an error state', async () => {
    setResult({ data: null, error: { message: 'connection reset' } });
    const { result } = renderHook(() => usePassageInsight(SCOPE, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sections).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('re-reads when the reader changes the scope', async () => {
    setResult({ data: cachedRows(), error: null });
    const { result, rerender } = renderHook(
      ({ scope }) => usePassageInsight(scope, null),
      { initialProps: { scope: { book: 'psa', chapter: 27, verse: null as number | null } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ scope: { book: 'psa', chapter: 27, verse: 4 } });
    await waitFor(() => expect(queries.length).toBe(2));
    expect(queries[1].filters.ref_id).toBe('psa.27.4');
  });

  it('does not re-read when an equal scope arrives as a fresh object', async () => {
    setResult({ data: cachedRows(), error: null });
    const { result, rerender } = renderHook(
      ({ scope }) => usePassageInsight(scope, null),
      { initialProps: { scope: { book: 'psa', chapter: 27, verse: null as number | null } } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ scope: { book: 'psa', chapter: 27, verse: null } });
    await new Promise((r) => setTimeout(r, 0));
    expect(queries.length).toBe(1);
  });
});

describe('usePassageInsight — generating', () => {
  it('shows sections as they arrive rather than all at once on completion', async () => {
    // The reveal is the point of D3: Overview lands while the rest fill in.
    let emit!: (ev: PassageInsightSseEvent) => void;
    const invoke: PassageInsightInvoke = vi.fn(async (_s, handlers) => {
      emit = handlers.onEvent;
      await new Promise((r) => setTimeout(r, 50));
    });
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { void result.current.generate(); });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => { emit({ t: 'text', field: 'overview', delta: 'David opens' }); });
    await waitFor(() => expect(result.current.sections?.overview).toBe('David opens'));
    // The other three are still empty while the first is on screen.
    expect(result.current.sections?.reflection ?? '').toBe('');
  });

  it('accumulates deltas rather than replacing on each one', async () => {
    let emit!: (ev: PassageInsightSseEvent) => void;
    const invoke: PassageInsightInvoke = vi.fn(async (_s, handlers) => {
      emit = handlers.onEvent;
      await new Promise((r) => setTimeout(r, 50));
    });
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { void result.current.generate(); });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    act(() => {
      emit({ t: 'text', field: 'overview', delta: 'David ' });
      emit({ t: 'text', field: 'overview', delta: 'opens by naming' });
    });
    await waitFor(() => expect(result.current.sections?.overview).toBe('David opens by naming'));
  });

  it('settles on the done payload and marks the door cached', async () => {
    const sections = Object.fromEntries(KEYS.map((k) => [k, `final ${k}`]));
    const invoke = scriptedInvoke([
      { t: 'text', field: 'overview', delta: 'partial' },
      { t: 'done', payload: { ok: true, cached: true, sections } },
    ]);
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.sections!.overview).toBe('final overview');
    expect(result.current.cached).toBe(true);
    expect(result.current.streaming).toBe(false);
  });

  it('does NOT claim the door is cached when the server refused to write it', async () => {
    // An all-empty door is not written; saying otherwise would leave the reader
    // looking at nothing with no way to try again.
    const sections = Object.fromEntries(KEYS.map((k) => [k, '']));
    const invoke = scriptedInvoke([{ t: 'done', payload: { ok: true, cached: false, sections } }]);
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.cached).toBe(false);
  });

  it('surfaces an error beat and stops streaming', async () => {
    const invoke = scriptedInvoke([{ t: 'error', reason: 'validators_failed' }]);
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.error).toBe('validators_failed');
    expect(result.current.streaming).toBe(false);
  });

  it('a failed generation leaves the door offerable again, not stranded empty', async () => {
    // Partial text streamed in and then the generation failed. Nothing was
    // written, so there IS no door: showing the fragments would render one that
    // does not exist, and leaving four empty strings would strand the reader
    // with no way to press the button again.
    const invoke = scriptedInvoke([
      { t: 'text', field: 'overview', delta: 'David opens by naming' },
      { t: 'error', reason: 'The operation was aborted.' },
    ]);
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.sections).toBeNull();
    expect(result.current.cached).toBe(false);
    expect(result.current.error).toBe('The operation was aborted.');
  });

  it('surfaces a transport failure without leaving the door stuck streaming', async () => {
    const invoke: PassageInsightInvoke = vi.fn(async () => { throw new Error('passage-insight failed: 403'); });
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.streaming).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it('takes the cache-hit answer when another reader warmed the door first', async () => {
    // The race the server's cache-first read settles, surfaced to the client:
    // a JSON answer instead of a stream.
    const invoke: PassageInsightInvoke = vi.fn(async (_s, handlers) => {
      handlers.onCached({ sections: Object.fromEntries(KEYS.map((k) => [k, `warm ${k}`])) });
    });
    setResult({ data: [], error: null });

    const { result } = renderHook(() => usePassageInsight(SCOPE, invoke));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.sections!.overview).toBe('warm overview');
    expect(result.current.cached).toBe(true);
    expect(result.current.streaming).toBe(false);
  });

  it('does nothing when there is no invoke — a signed-out reader cannot generate', async () => {
    setResult({ data: [], error: null });
    const { result } = renderHook(() => usePassageInsight(SCOPE, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.generate(); });

    expect(result.current.sections).toBeNull();
    expect(result.current.streaming).toBe(false);
  });
});
