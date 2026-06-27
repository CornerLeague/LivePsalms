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

import { useBibleVerseLayout } from './useBibleVerseLayout';

describe('useBibleVerseLayout', () => {
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

  it('defaults to inline', () => {
    const { result } = renderHook(() => useBibleVerseLayout());
    expect(result.current.verseLayout).toBe('inline');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.bible.verseLayout', 'paragraph');
    const { result } = renderHook(() => useBibleVerseLayout());
    expect(result.current.verseLayout).toBe('inline');
  });

  it('never reads the profile on mount — seeding lives in BiblePrefsProvider', async () => {
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.verseLayout).toBe('inline');
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('setLocalVerseLayout writes state + localStorage but never the DB', () => {
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    act(() => result.current.setLocalVerseLayout('spaced'));
    expect(result.current.verseLayout).toBe('spaced');
    expect(localStorage.getItem('psalms.bible.verseLayout')).toBe('spaced');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saveGlobalVerseLayout awaits the DB write and returns ok on success', async () => {
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalVerseLayout('spaced'); });

    expect(res).toEqual({ ok: true });
    expect(result.current.verseLayout).toBe('spaced');
    expect(mockUpdate).toHaveBeenCalledWith({ bible_verse_layout: 'spaced' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('saveGlobalVerseLayout returns the error when the DB write fails', async () => {
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    mockUpdateEq.mockResolvedValue({ error: { message: 'boom' } });

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalVerseLayout('lines'); });

    expect(res).toEqual({ ok: false, error: 'boom' });
    expect(result.current.verseLayout).toBe('lines');
  });

  it('saveGlobalVerseLayout is a no-op DB write when signed out', async () => {
    const { result } = renderHook(() => useBibleVerseLayout());
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalVerseLayout('lines'); });
    expect(res).toEqual({ ok: true });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
