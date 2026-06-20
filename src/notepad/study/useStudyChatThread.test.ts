// @vitest-environment jsdom
// src/notepad/study/useStudyChatThread.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';

// Mock refs wrapped in vi.hoisted so they are initialized before the hoisted
// vi.mock() factory runs (matches the convention in useChatThread.test.ts).
const {
  order, eqMsg, selectMsg, eqThread, eqSurface, selectThread, maybeSingle, from,
  threadBuilder, msgBuilder, setOrderResult,
} = vi.hoisted(() => {
  const order = vi.fn();
  const eqMsg = vi.fn();
  const selectMsg = vi.fn();
  // eqThread handles all .eq() calls on the thread builder; eqSurface is the
  // same spy re-exported so callers can assert specifically on ('surface','study').
  const eqThread = vi.fn();
  const eqSurface = eqThread;
  const selectThread = vi.fn();
  const maybeSingle = vi.fn();
  const from = vi.fn();

  let orderResult: { data: unknown; error: unknown } = { data: [], error: null };

  const threadBuilder = { select: selectThread, eq: eqThread, maybeSingle };
  const msgBuilder = {
    select: selectMsg, eq: eqMsg, order,
    then: (r: (v: unknown) => unknown) => Promise.resolve(r(orderResult)),
  };

  return {
    order, eqMsg, selectMsg, eqThread, eqSurface, selectThread, maybeSingle, from,
    threadBuilder, msgBuilder,
    setOrderResult: (v: { data: unknown; error: unknown }) => { orderResult = v; },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useStudyChatThread } from './useStudyChatThread';

beforeEach(() => {
  vi.clearAllMocks();
  from.mockImplementation((t: string) => (t === 'lamplight_chat_threads' ? threadBuilder : msgBuilder));
  selectThread.mockImplementation(() => threadBuilder);
  eqThread.mockImplementation(() => threadBuilder);
  selectMsg.mockImplementation(() => msgBuilder);
  eqMsg.mockImplementation(() => msgBuilder);
  order.mockImplementation(() => msgBuilder);
  setOrderResult({ data: [], error: null });
});
afterEach(cleanup);

describe('useStudyChatThread', () => {
  it('returns [] when no thread exists for the passage', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toEqual([]);
  });

  it('loads ordered messages when a thread exists', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 't1' }, error: null });
    setOrderResult({
      data: [
        { id: 'm1', role: 'user', content: 'hi', citations: [] },
        { id: 'm2', role: 'assistant', content: 'grace', citations: [{ type: 'verse', ref: 'jhn 10:11' }] },
      ],
      error: null,
    });
    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(eqMsg).toHaveBeenCalledWith('thread_id', 't1');
  });

  it('only loads the active (non-archived) thread', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 't1' }, error: null });
    setOrderResult({ data: [], error: null });
    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(eqThread).toHaveBeenCalledWith('archived', false);
  });

  it('archiveAndReset archives the active thread then reloads', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 't1' }, error: null });
    setOrderResult({ data: [{ id: 'm1', role: 'assistant', content: 'x', citations: [] }], error: null });

    // update().eq().eq().eq().eq() chain returns { error: null }
    const updEq4 = vi.fn().mockResolvedValue({ error: null });
    const updEq3 = vi.fn(() => ({ eq: updEq4 }));
    const updEq2 = vi.fn(() => ({ eq: updEq3 }));
    const updEq1 = vi.fn(() => ({ eq: updEq2 }));
    const update = vi.fn(() => ({ eq: updEq1 }));
    from.mockImplementation((t: string) =>
      t === 'lamplight_chat_threads' ? { ...threadBuilder, update } : msgBuilder,
    );

    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.archiveAndReset(); });
    expect(update).toHaveBeenCalledWith({ archived: true });
  });

  it('archiveAndReset surfaces the error and keeps the conversation when the archive write fails', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 't1' }, error: null });
    setOrderResult({ data: [{ id: 'm1', role: 'assistant', content: 'x', citations: [] }], error: null });

    // update().eq().eq().eq().eq() chain rejects with a Postgres error
    const updEq4 = vi.fn().mockResolvedValue({ error: { message: 'archive failed' } });
    const updEq3 = vi.fn(() => ({ eq: updEq4 }));
    const updEq2 = vi.fn(() => ({ eq: updEq3 }));
    const updEq1 = vi.fn(() => ({ eq: updEq2 }));
    const update = vi.fn(() => ({ eq: updEq1 }));
    from.mockImplementation((t: string) =>
      t === 'lamplight_chat_threads' ? { ...threadBuilder, update } : msgBuilder,
    );

    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1']);

    await act(async () => { await result.current.archiveAndReset(); });
    // The failed write is surfaced, and the existing conversation is preserved
    // (not silently cleared and then re-loaded from the still-active thread).
    expect(result.current.error).toBe('archive failed');
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('scopes the active-thread lookup to the study surface', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(eqSurface).toHaveBeenCalledWith('surface', 'study');
  });
});
