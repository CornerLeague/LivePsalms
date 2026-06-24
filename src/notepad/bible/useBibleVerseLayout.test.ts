// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

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

  it('seeds from the profile when the device has no stored value', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'lines' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    expect(result.current.verseLayout).toBe('inline');
    await waitFor(() => expect(result.current.verseLayout).toBe('lines'));
    expect(localStorage.getItem('psalms.bible.verseLayout')).toBe('lines');
    expect(mockSelect).toHaveBeenCalledWith('bible_verse_layout');
  });

  it('does NOT override a value already stored on this device (reload-bug regression)', async () => {
    localStorage.setItem('psalms.bible.verseLayout', 'spaced');
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'lines' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.verseLayout).toBe('spaced');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('does not seed when the remote value is invalid', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'paragraph' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.verseLayout).toBe('inline');
  });

  it('seeds from the profile when the stored layout is corrupt (heals localStorage)', async () => {
    localStorage.setItem('psalms.bible.verseLayout', 'blocks');
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'spaced' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    expect(result.current.verseLayout).toBe('inline'); // corrupt ignored, falls back to default
    await waitFor(() => expect(result.current.verseLayout).toBe('spaced'));
    expect(localStorage.getItem('psalms.bible.verseLayout')).toBe('spaced');
    expect(mockSelect).toHaveBeenCalledWith('bible_verse_layout'); // seed ran
  });

  it('setLocalVerseLayout writes state + localStorage but never the DB', () => {
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    act(() => result.current.setLocalVerseLayout('spaced'));
    expect(result.current.verseLayout).toBe('spaced');
    expect(localStorage.getItem('psalms.bible.verseLayout')).toBe('spaced');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saveGlobalVerseLayout awaits the DB write and returns ok on success', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'inline' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalVerseLayout('spaced'); });

    expect(res).toEqual({ ok: true });
    expect(result.current.verseLayout).toBe('spaced');
    expect(mockUpdate).toHaveBeenCalledWith({ bible_verse_layout: 'spaced' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('saveGlobalVerseLayout returns the error when the DB write fails', async () => {
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
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
