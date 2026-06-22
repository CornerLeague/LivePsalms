// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Supabase mock — must be set up with vi.hoisted so variables are available
// when vi.mock factory is hoisted to the top of the file.
// ---------------------------------------------------------------------------
const { mockFrom, mockSelect, mockSelectEq, mockMaybeSingle, mockUpdate, mockUpdateEq } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn();
  const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));

  const mockUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));

  const mockFrom = vi.fn(() => ({
    select: mockSelect,
    update: mockUpdate,
  }));

  return { mockFrom, mockSelect, mockSelectEq, mockMaybeSingle, mockUpdate, mockUpdateEq };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}));

import { useBibleTranslation } from './useBibleTranslation';

describe('useBibleTranslation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // Re-wire after clearAllMocks so chains still return correct shapes
    mockSelectEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
  });

  // -------------------------------------------------------------------------
  // Anon tests (no userId) — must stay green with the new signature
  // -------------------------------------------------------------------------
  it('defaults to BSB', () => {
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });

  it('persists a new selection across remounts', () => {
    const first = renderHook(() => useBibleTranslation());
    act(() => first.result.current.setTranslation('KJV'));
    const second = renderHook(() => useBibleTranslation());
    expect(second.result.current.translation).toBe('KJV');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.bible.translation', 'NIV');
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });

  // -------------------------------------------------------------------------
  // Signed-in tests — userId triggers supabase hydration and writes
  // -------------------------------------------------------------------------
  it('hydrates translation from profile when userId is provided', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'KJV' }, error: null });

    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));

    // Initial state is BSB (localStorage default)
    expect(result.current.translation).toBe('BSB');

    // After async hydration, state should reflect the profile value
    await waitFor(() => expect(result.current.translation).toBe('KJV'));

    // Verify the correct supabase chain was called
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('bible_translation');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'user-123');
    expect(mockMaybeSingle).toHaveBeenCalled();
  });

  it('does not hydrate when remote value is not a valid translation', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'NIV' }, error: null });

    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));

    // Wait a tick to ensure the effect has run
    await act(async () => { await Promise.resolve(); });

    // Should remain the localStorage default (BSB), not the invalid remote value
    expect(result.current.translation).toBe('BSB');
  });

  it('writes to profiles when setTranslation is called with a userId', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'BSB' }, error: null });

    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));

    // Wait for hydration
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());

    // Clear mocks to isolate the write test
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });

    act(() => result.current.setTranslation('WEB'));

    expect(result.current.translation).toBe('WEB');
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockUpdate).toHaveBeenCalledWith({ bible_translation: 'WEB' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('does not write to supabase when no userId', () => {
    const { result } = renderHook(() => useBibleTranslation());
    act(() => result.current.setTranslation('KJV'));

    expect(mockFrom).not.toHaveBeenCalled();
  });
});
