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

import { useBibleTranslation } from './useBibleTranslation';

describe('useBibleTranslation', () => {
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

  it('defaults to BSB', () => {
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.bible.translation', 'NIV');
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });

  it('seeds from the profile when the device has no stored value', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'KJV' }, error: null });
    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));
    expect(result.current.translation).toBe('BSB'); // instant default
    await waitFor(() => expect(result.current.translation).toBe('KJV'));
    expect(localStorage.getItem('psalms.bible.translation')).toBe('KJV');
    expect(mockSelect).toHaveBeenCalledWith('bible_translation');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('does NOT override a value already stored on this device (reload-bug regression)', async () => {
    localStorage.setItem('psalms.bible.translation', 'KJV');
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'WEB' }, error: null });
    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.translation).toBe('KJV');
    expect(mockSelect).not.toHaveBeenCalled(); // seed skipped entirely
  });

  it('does not seed when the remote value is invalid', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'NIV' }, error: null });
    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.translation).toBe('BSB');
  });

  it('setLocalTranslation writes state + localStorage but never the DB', () => {
    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));
    act(() => result.current.setLocalTranslation('WEB'));
    expect(result.current.translation).toBe('WEB');
    expect(localStorage.getItem('psalms.bible.translation')).toBe('WEB');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saveGlobalTranslation awaits the DB write and returns ok on success', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { bible_translation: 'BSB' }, error: null });
    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalTranslation('WEB'); });

    expect(res).toEqual({ ok: true });
    expect(result.current.translation).toBe('WEB');
    expect(localStorage.getItem('psalms.bible.translation')).toBe('WEB');
    expect(mockUpdate).toHaveBeenCalledWith({ bible_translation: 'WEB' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('saveGlobalTranslation returns the error when the DB write fails', async () => {
    const { result } = renderHook(() => useBibleTranslation({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    mockUpdateEq.mockResolvedValue({ error: { message: 'boom' } });

    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalTranslation('KJV'); });

    expect(res).toEqual({ ok: false, error: 'boom' });
    expect(result.current.translation).toBe('KJV'); // optimistic local update still applied
  });

  it('saveGlobalTranslation is a no-op DB write when signed out', async () => {
    const { result } = renderHook(() => useBibleTranslation());
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => { res = await result.current.saveGlobalTranslation('KJV'); });
    expect(res).toEqual({ ok: true });
    expect(result.current.translation).toBe('KJV');
    expect(localStorage.getItem('psalms.bible.translation')).toBe('KJV');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
