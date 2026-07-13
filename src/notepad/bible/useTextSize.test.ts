// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { mockFrom, mockSelect, mockSelectEq, mockMaybeSingle, mockUpdate, mockUpdateEq } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
  const mockUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  const mockFrom = vi.fn(() => ({ select: mockSelect, update: mockUpdate }));
  return { mockFrom, mockSelect, mockSelectEq, mockMaybeSingle, mockUpdate, mockUpdateEq };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }));

import { useTextSize } from './useTextSize';

describe('useTextSize', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSelectEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
  });

  it('defaults to base', () => {
    const { result } = renderHook(() => useTextSize());
    expect(result.current.textSize).toBe('base');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.textSize', 'huge');
    const { result } = renderHook(() => useTextSize());
    expect(result.current.textSize).toBe('base');
  });

  it('never reads the profile on mount — seeding lives in BiblePrefsProvider', async () => {
    const { result } = renderHook(() => useTextSize({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.textSize).toBe('base');
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('setLocalTextSize writes state + localStorage but never the DB', () => {
    const { result } = renderHook(() => useTextSize({ userId: 'user-123' }));
    act(() => result.current.setLocalTextSize('xlarge'));
    expect(result.current.textSize).toBe('xlarge');
    expect(localStorage.getItem('psalms.textSize')).toBe('xlarge');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saveGlobalTextSize awaits the DB write and returns ok on success', async () => {
    const { result } = renderHook(() => useTextSize({ userId: 'user-123' }));

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalTextSize('large'); });

    expect(res).toEqual({ ok: true });
    expect(result.current.textSize).toBe('large');
    expect(mockUpdate).toHaveBeenCalledWith({ text_size: 'large' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('saveGlobalTextSize returns the error when the DB write fails', async () => {
    const { result } = renderHook(() => useTextSize({ userId: 'user-123' }));
    mockUpdateEq.mockResolvedValue({ error: { message: 'boom' } });

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalTextSize('xlarge'); });

    expect(res).toEqual({ ok: false, error: 'boom' });
    expect(result.current.textSize).toBe('xlarge');
  });

  it('saveGlobalTextSize is a no-op DB write when signed out', async () => {
    const { result } = renderHook(() => useTextSize());
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalTextSize('large'); });
    expect(res).toEqual({ ok: true });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
