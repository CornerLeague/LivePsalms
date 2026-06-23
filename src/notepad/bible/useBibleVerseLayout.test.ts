// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Supabase mock — hoisted so the vi.mock factory can reach the mocks.
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

  it('persists a new selection across remounts', () => {
    const first = renderHook(() => useBibleVerseLayout());
    act(() => first.result.current.setVerseLayout('spaced'));
    const second = renderHook(() => useBibleVerseLayout());
    expect(second.result.current.verseLayout).toBe('spaced');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.bible.verseLayout', 'paragraph');
    const { result } = renderHook(() => useBibleVerseLayout());
    expect(result.current.verseLayout).toBe('inline');
  });

  it('hydrates from the profile when userId is provided', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'lines' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    expect(result.current.verseLayout).toBe('inline');
    await waitFor(() => expect(result.current.verseLayout).toBe('lines'));
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('bible_verse_layout');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'user-123');
    expect(mockMaybeSingle).toHaveBeenCalled();
  });

  it('does not hydrate when the remote value is invalid', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'paragraph' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.verseLayout).toBe('inline');
  });

  it('writes to profiles when setVerseLayout is called with a userId', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_verse_layout: 'inline' }, error: null });
    const { result } = renderHook(() => useBibleVerseLayout({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());

    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });

    act(() => result.current.setVerseLayout('spaced'));

    expect(result.current.verseLayout).toBe('spaced');
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockUpdate).toHaveBeenCalledWith({ bible_verse_layout: 'spaced' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('does not write to supabase when there is no userId', () => {
    const { result } = renderHook(() => useBibleVerseLayout());
    act(() => result.current.setVerseLayout('lines'));
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
