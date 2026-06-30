// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { from, select, eq, order, limit } = vi.hoisted(() => {
  const select = vi.fn();
  const eq = vi.fn();
  const order = vi.fn();
  const limit = vi.fn();
  const from = vi.fn();
  return { from, select, eq, order, limit };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { useStudyChatHistory } from './useStudyChatHistory';

let current: { data: unknown; error: unknown };
const builder: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  current = { data: [], error: null };
  builder.select = select.mockReturnValue(builder);
  builder.eq = eq.mockReturnValue(builder);
  builder.order = order.mockReturnValue(builder);
  builder.limit = limit.mockImplementation(() => Promise.resolve(current));
  from.mockReturnValue(builder);
});
afterEach(cleanup);

describe('useStudyChatHistory', () => {
  it('maps rows to items and queries study surface ordered by updated_at desc, limit 50', async () => {
    current = {
      data: [
        { id: 't1', book: 'rom', chapter: 8, title: 'Paul', updated_at: '2026-06-29T12:00:00Z' },
        { id: 't2', book: 'jhn', chapter: 10, title: 'Shepherd', updated_at: '2026-06-28T12:00:00Z' },
      ],
      error: null,
    };
    const { result } = renderHook(() => useStudyChatHistory('u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([
      { threadId: 't1', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-29T12:00:00Z' },
      { threadId: 't2', book: 'jhn', chapter: 10, title: 'Shepherd', updatedAt: '2026-06-28T12:00:00Z' },
    ]);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq).toHaveBeenCalledWith('surface', 'study');
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('returns [] without querying when there is no user', async () => {
    const { result } = renderHook(() => useStudyChatHistory(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a query error', async () => {
    current = { data: null, error: { message: 'boom' } };
    const { result } = renderHook(() => useStudyChatHistory('u1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.items).toEqual([]);
  });
});
