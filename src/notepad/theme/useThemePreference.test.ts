// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { useThemePreference } from './useThemePreference';

// Controllable matchMedia mock: drives prefers-color-scheme + change events.
let mqListeners: Array<(e: { matches: boolean }) => void>;
let systemDark: boolean;
function installMatchMedia(initialDark: boolean) {
  systemDark = initialDark;
  mqListeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('dark') ? systemDark : false,
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => mqListeners.push(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      mqListeners = mqListeners.filter((l) => l !== cb);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
function emitSystemChange(dark: boolean) {
  systemDark = dark;
  mqListeners.forEach((l) => l({ matches: dark }));
}

describe('useThemePreference', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockSelectEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    installMatchMedia(false);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('defaults to system', () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.theme).toBe('system');
  });

  it('resolves system to light when OS is light', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('resolves system to dark when OS is dark', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('updates resolvedTheme when the OS scheme changes and theme is system', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.resolvedTheme).toBe('light');
    act(() => emitSystemChange(true));
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('resolvedTheme follows an explicit theme regardless of OS', () => {
    installMatchMedia(true); // OS dark
    const { result } = renderHook(() => useThemePreference());
    act(() => result.current.setTheme('light'));
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('persists a new selection across remounts', () => {
    const first = renderHook(() => useThemePreference());
    act(() => first.result.current.setTheme('dark'));
    const second = renderHook(() => useThemePreference());
    expect(second.result.current.theme).toBe('dark');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.session.theme', 'neon');
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.theme).toBe('system');
  });

  it('hydrates theme from profile when userId is provided', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { theme: 'dark' }, error: null });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    expect(result.current.theme).toBe('system');
    await waitFor(() => expect(result.current.theme).toBe('dark'));
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('theme, light_theme');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('does not hydrate when remote value is invalid', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { theme: 'neon' }, error: null });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.theme).toBe('system');
  });

  it('writes to profiles when setTheme is called with a userId', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { theme: 'system' }, error: null });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(mockUpdate).toHaveBeenCalledWith({ theme: 'light' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });

  it('does not write to supabase when no userId', () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => result.current.setTheme('dark'));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('defaults lightTheme to classic', () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.lightTheme).toBe('classic');
  });

  it('persists a light-theme selection across remounts', () => {
    const first = renderHook(() => useThemePreference());
    act(() => first.result.current.setLightTheme('stormy-sky'));
    const second = renderHook(() => useThemePreference());
    expect(second.result.current.lightTheme).toBe('stormy-sky');
  });

  it('ignores a corrupt stored light-theme value', () => {
    localStorage.setItem('psalms.session.lightTheme', 'neon');
    const { result } = renderHook(() => useThemePreference());
    expect(result.current.lightTheme).toBe('classic');
  });

  it('hydrates light_theme from profile when userId is provided', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { theme: 'light', light_theme: 'olive-grove' },
      error: null,
    });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await waitFor(() => expect(result.current.lightTheme).toBe('olive-grove'));
    expect(result.current.theme).toBe('light');
  });

  it('falls back to a theme-only select when the combined select fails (pre-migration DB)', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'column profiles.light_theme does not exist' } })
      .mockResolvedValueOnce({ data: { theme: 'dark' }, error: null });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await waitFor(() => expect(result.current.theme).toBe('dark'));
    expect(result.current.lightTheme).toBe('classic');
    expect(mockSelect).toHaveBeenNthCalledWith(1, 'theme, light_theme');
    expect(mockSelect).toHaveBeenNthCalledWith(2, 'theme');
  });

  it('does not hydrate an invalid remote light_theme', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { theme: 'light', light_theme: 'neon' },
      error: null,
    });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await waitFor(() => expect(result.current.theme).toBe('light'));
    expect(result.current.lightTheme).toBe('classic');
  });

  it('does not let a slow profile hydration clobber a palette the user picks meanwhile', async () => {
    // Hydration fetch stays pending until we resolve it by hand.
    let resolveFetch!: (v: { data: unknown; error: null }) => void;
    const pending = new Promise<{ data: unknown; error: null }>((r) => { resolveFetch = r; });
    mockMaybeSingle.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    // User picks a palette while the profile read is still in flight.
    act(() => result.current.setLightTheme('stormy-sky'));
    expect(result.current.lightTheme).toBe('stormy-sky');

    // The stale profile value arrives afterward — it must NOT win.
    await act(async () => {
      resolveFetch({ data: { theme: 'system', light_theme: 'classic' }, error: null });
      await pending;
    });
    expect(result.current.lightTheme).toBe('stormy-sky');
    expect(localStorage.getItem('psalms.session.lightTheme')).toBe('stormy-sky');
  });

  it('logs, without throwing, when the light_theme profile write fails', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { theme: 'system', light_theme: 'classic' }, error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    mockUpdateEq.mockResolvedValueOnce({ error: { message: 'rls denied' } });
    act(() => { result.current.setLightTheme('graphite'); });
    expect(result.current.lightTheme).toBe('graphite');
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[theme] profile preference sync failed:', 'rls denied'),
    );
    warn.mockRestore();
  });

  it('writes light_theme to profiles when setLightTheme is called with a userId', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { theme: 'system', light_theme: 'classic' }, error: null });
    const { result } = renderHook(() => useThemePreference({ userId: 'user-123' }));
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });
    act(() => result.current.setLightTheme('graphite'));
    expect(result.current.lightTheme).toBe('graphite');
    expect(mockUpdate).toHaveBeenCalledWith({ light_theme: 'graphite' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-123');
  });
});
