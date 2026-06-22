// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthSessionContext } from '@/auth/context/useAuthSession';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './theme-context';

// Supabase is imported transitively by useThemePreference; stub it out.
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function installMatchMedia(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('dark') ? dark : false,
    media: q,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Minimal AuthSession store stub so useAuthSession() resolves with user=null.
// useSyncExternalStore requires getSnapshot to return the same object identity,
// so we cache the snapshot.
const snapshot = { user: null, loading: false, adapter: null };
const fakeSession = {
  subscribe: () => () => {},
  getSnapshot: () => snapshot,
} as never;

function renderAt(path: string) {
  return render(
    <AuthSessionContext.Provider value={fakeSession}>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <ThemeSetter />
        </ThemeProvider>
      </MemoryRouter>
    </AuthSessionContext.Provider>,
  );
}

// Helper child that flips the theme to 'dark' on mount.
function ThemeSetter() {
  const { setTheme } = useTheme();
  // set synchronously on first render
  (globalThis as Record<string, unknown>).__setDark ??= () => setTheme('dark');
  return null;
}

describe('ThemeProvider route-gated .dark', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    installMatchMedia(true); // OS dark so 'system' resolves dark
  });

  it('adds .dark on a notepad route when resolved theme is dark', () => {
    renderAt('/notepad/notes');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does NOT add .dark on a marketing route even when resolved dark', () => {
    renderAt('/');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does NOT add .dark on a notepad route when resolved light', () => {
    installMatchMedia(false); // OS light, theme defaults to system → light
    renderAt('/notepad/notes');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes .dark when the provider unmounts', () => {
    const { unmount } = renderAt('/notepad/notes');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
