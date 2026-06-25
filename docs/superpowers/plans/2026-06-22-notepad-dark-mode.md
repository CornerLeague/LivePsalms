# Notepad Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable light/dark theme to the entire notepad workspace, derived from the landing hero palette, persisted per-account with a localStorage fallback.

**Architecture:** A `ThemeProvider` (mounted inside `AuthProvider`, wrapping `Routes`) owns theme state via a `useThemePreference` hook (clone of `useBibleTranslation`) and applies a `.dark` class to `<html>` **only while a `/notepad/notes` route is mounted** (Approach C). The notepad's ~8 brand CSS custom properties + the shadcn HSL set are redefined under `.dark` in `src/index.css`, which auto-flips ~430 var references and the whole TipTap editor. A bounded set of hardcoded literals and the JS-painted graph canvas are re-themed by hand.

**Tech Stack:** Vite + React + TypeScript + Tailwind (`darkMode: ["class"]` already set) + Supabase (Postgres + RLS) + TipTap. Tests: Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Zero new errors, not a green repo.** The repo ships a known red baseline (~114 lint errors, 4 tsc errors in `force-sphere.test.ts`, 2 failing test files: `Editor.toolbar-placement`, `garden-scene`). Gate every task on introducing **zero new** lint/tsc/test failures, not on a globally green run.
- **Typecheck with `tsc -b`** (the real build command), NOT bare `tsc --noEmit` — the root tsconfig has `files: []`, so `--noEmit` checks nothing. Use `npm run build` or `npx tsc -b`.
- **Migrations apply via `supabase db push`** (history is in sync; only new migrations are pending). No edge-function changes in this feature.
- **Scope:** notepad workspace only (`/notepad/notes`, `/notepad/u/:username` + their `study` children). Marketing/landing/auth/profile/admin stay light — never apply `.dark` outside notepad routes.
- **Theme value:** `theme: 'system' | 'light' | 'dark'`, default `'system'`. localStorage key `'psalms.session.theme'`.
- **Palette source:** landing hero (`src/notepad-landing/styles/landing.css`) — bg `#0e0e0e`, ink `#efedee`/`#f4f0e8`, accent `#c4b5a0`, muted `#b7ada0`/`#8d8478`. Three-step warm elevation ramp: body `#0a0a0a` → paper `#16130f` → elevated `~#211d17`.
- **Branch:** stay on `feat/notepad-dark-mode`. Do not push or open a PR unless the user asks.
- Run a single test file with `npx vitest run <path>`. Lint a path with `npx eslint <path>`.

---

## File Structure

**New files:**
- `src/notepad/theme/theme-types.ts` — shared types (`Theme`, `ResolvedTheme`) + the pure route/dark predicates.
- `src/notepad/theme/useThemePreference.ts` — storage + profile-sync hook with `'system'` resolution.
- `src/notepad/theme/useThemePreference.test.ts` — unit tests (mirror `useBibleTranslation.test.ts`).
- `src/notepad/theme/theme-context.ts` — `ThemeContext` + `useTheme()` consumer hook.
- `src/notepad/theme/ThemeProvider.tsx` — owns state, applies route-gated `.dark`, provides context.
- `src/notepad/theme/ThemeProvider.test.tsx` — route-gating + DOM class tests.
- `src/notepad/theme/ThemeToggle.tsx` — the sun/moon control.
- `src/notepad/theme/ThemeToggle.test.tsx` — toggle behavior tests.
- `src/notepad/graph/graph-palette.ts` — `resolveGraphPalette()` reading computed CSS vars.
- `src/notepad/graph/graph-palette.test.ts` — palette resolution unit tests.
- `supabase/migrations/039_profiles_theme.sql` — `profiles.theme` column + CHECK.

**Modified files:**
- `src/notepad/session/session-storage.ts` — add + export `KEY_THEME`.
- `src/App.tsx` — mount `<ThemeProvider>` inside `<AuthProvider>`.
- `src/index.css` — add `.dark { … }` brand-var + shadcn HSL block; add `--surface-elevated` and graph vars to `:root`.
- `src/notepad/components/NotepadToolbar.tsx` — mount `ThemeToggle` beside New Note; convert toolbar literals.
- `src/components/sections/notepad/mobile/MobileNotesView.tsx` — mount `ThemeToggle`; `dark:` hover.
- `src/components/sections/notepad/mobile/MobileEditorView.tsx` — mount `ThemeToggle`; `dark:` hover.
- `src/notepad/study/StudyWorkspace.tsx` — mount `ThemeToggle` beside `NotepadAuthControls`.
- `src/notepad/storage/profiles-privileged-columns.test.ts` — assert `theme` is self-updatable.
- `src/notepad/graph/graph-view.ts` + `src/components/sections/notepad/GraphPane.tsx` — consume `resolveGraphPalette`.
- Tier 2/3 literal files (Editor, Sidebar, FolderItem, NoteItem, etc.) + `scripture-ref.css`, `scan.css`, lamplight chat, `DecorationItem.tsx`.

---

## Task 1: Migration 039 — `profiles.theme` column + guard test

**Files:**
- Create: `supabase/migrations/039_profiles_theme.sql`
- Modify/Test: `src/notepad/storage/profiles-privileged-columns.test.ts`

**Interfaces:**
- Produces: a `profiles.theme text not null default 'system'` column, CHECK-constrained to `('light','dark','system')`, owner-writable (not captured by the `021_protect_privileged_profile_columns` trigger). `useThemePreference` (Task 2) reads/writes it.

- [ ] **Step 1: Write the failing guard test**

In `src/notepad/storage/profiles-privileged-columns.test.ts`, add after the existing `'still allows a normal field update (username)'` test (around line 79):

```typescript
  it('still allows the owner to self-update theme', async () => {
    const { error } = await userA.client
      .from('profiles').update({ theme: 'dark' }).eq('id', userA.userId);
    expect(error).toBeNull();

    const { data } = await serviceClient()
      .from('profiles').select('theme').eq('id', userA.userId).single();
    expect(data?.theme).toBe('dark');

    // restore default so the row is left clean for other runs
    await userA.client.from('profiles').update({ theme: 'system' }).eq('id', userA.userId);
  });
```

- [ ] **Step 2: Run the suite to confirm it does not error in unconfigured CI**

Run: `npx vitest run src/notepad/storage/profiles-privileged-columns.test.ts`
Expected: the whole describe is **skipped** (`describe.skip`) because `SUPABASE_TEST_*` env vars are absent locally/CI — output shows the suite skipped, **0 failures**. (This test executes only against a configured Supabase test project; the migration is what makes it pass there.)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/039_profiles_theme.sql`:

```sql
-- 039_profiles_theme.sql
-- Per-user notepad color theme (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
-- Modeled on bible_translation (037/038): a plain owner-writable column, NOT a
-- privileged column — the 021 protect_privileged_profile_columns trigger guards
-- only is_admin / note_count / highest_note_count, so a normal owner UPDATE of
-- theme passes (verified by profiles-privileged-columns.test.ts).
alter table public.profiles
  add column theme text not null default 'system';

alter table public.profiles
  add constraint profiles_theme_check
  check (theme in ('light', 'dark', 'system'));
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db push`
Expected: `039_profiles_theme.sql` applied; no other migrations pending. If push reports the column already exists, the migration is idempotent enough to re-run only after a manual `alter table ... drop column` — do not force.

- [ ] **Step 5: Verify the trigger does not guard `theme`**

Run: `grep -n "theme" supabase/migrations/021_protect_privileged_profile_columns.sql`
Expected: **no match** — confirming `theme` is not a privileged column. (If a later migration extended the trigger, grep those too: `grep -rln "protect_privileged_profile" supabase/migrations/` and confirm none reference `theme`.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/039_profiles_theme.sql src/notepad/storage/profiles-privileged-columns.test.ts
git commit -m "feat(notepad): add profiles.theme column + owner-writable guard test"
```

---

## Task 2: `useThemePreference` hook + `KEY_THEME`

**Files:**
- Modify: `src/notepad/session/session-storage.ts`
- Create: `src/notepad/theme/theme-types.ts`
- Create: `src/notepad/theme/useThemePreference.ts`
- Test: `src/notepad/theme/useThemePreference.test.ts`

**Interfaces:**
- Consumes: `loadEnum` / `saveEnum` from `../session/session-storage`; `supabase` from `@/lib/supabase`.
- Produces:
  - `type Theme = 'system' | 'light' | 'dark'` and `type ResolvedTheme = 'light' | 'dark'` (in `theme-types.ts`).
  - `KEY_THEME = 'psalms.session.theme'` (exported from `session-storage.ts`).
  - `useThemePreference({ userId }: { userId?: string | null }): { theme: Theme; resolvedTheme: ResolvedTheme; setTheme: (t: Theme) => void }`.

- [ ] **Step 1: Add `KEY_THEME` to session-storage**

In `src/notepad/session/session-storage.ts`, add the key constant after `KEY_BIBLE_TRANSLATION` (line 11) and add it to the export block (lines 13-19):

```typescript
const KEY_BIBLE_TRANSLATION = 'psalms.bible.translation';
const KEY_THEME = 'psalms.session.theme';

export {
  KEY_LAST_NOTE,
  KEY_MOBILE_TAB,
  KEY_EDITOR_TAB,
  KEY_STUDY_TAB,
  KEY_BIBLE_TRANSLATION,
  KEY_THEME,
};
```

- [ ] **Step 2: Create the shared types**

Create `src/notepad/theme/theme-types.ts`:

```typescript
export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'] as const;
export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** True when the path is a notepad workspace route that should be dark-eligible. */
export function isNotepadRoute(pathname: string): boolean {
  return pathname.startsWith('/notepad/notes') || pathname.startsWith('/notepad/u/');
}

/** Whether `.dark` should be on <html> for this route + resolved theme. */
export function shouldApplyDark(pathname: string, resolved: ResolvedTheme): boolean {
  return resolved === 'dark' && isNotepadRoute(pathname);
}
```

- [ ] **Step 3: Write the failing hook test**

Create `src/notepad/theme/useThemePreference.test.ts` (mirrors `useBibleTranslation.test.ts`, adds `matchMedia` resolution):

```typescript
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
    expect(mockSelect).toHaveBeenCalledWith('theme');
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
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/notepad/theme/useThemePreference.test.ts`
Expected: FAIL — `Failed to resolve import "./useThemePreference"` (module not yet created).

- [ ] **Step 5: Write the hook**

Create `src/notepad/theme/useThemePreference.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, KEY_THEME } from '../session/session-storage';
import { type Theme, type ResolvedTheme, THEMES, DEFAULT_THEME, isTheme } from './theme-types';
import { supabase } from '@/lib/supabase';

export interface UseThemePreferenceResult {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useThemePreference(
  { userId = null }: { userId?: string | null } = {},
): UseThemePreferenceResult {
  const [theme, setState] = useState<Theme>(() =>
    loadEnum<Theme>(KEY_THEME, THEMES, DEFAULT_THEME),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Track the OS scheme so 'system' resolves live.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent | { matches: boolean }) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Hydrate from the profile when signed in (localStorage is the instant default).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('theme').eq('id', userId).maybeSingle();
      const remote = data?.theme;
      if (!cancelled && isTheme(remote)) {
        setState(remote);
        saveEnum(KEY_THEME, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setTheme = useCallback((t: Theme) => {
    setState(t);
    saveEnum(KEY_THEME, t);
    if (userId && supabase) {
      void supabase.from('profiles').update({ theme: t }).eq('id', userId);
    }
  }, [userId]);

  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  return { theme, resolvedTheme, setTheme };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/notepad/theme/useThemePreference.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 7: Typecheck + lint the new files**

Run: `npx tsc -b && npx eslint src/notepad/theme src/notepad/session/session-storage.ts`
Expected: no NEW errors beyond the known baseline (`force-sphere.test.ts` tsc errors are pre-existing; the new files must add none).

- [ ] **Step 8: Commit**

```bash
git add src/notepad/theme/theme-types.ts src/notepad/theme/useThemePreference.ts src/notepad/theme/useThemePreference.test.ts src/notepad/session/session-storage.ts
git commit -m "feat(notepad): useThemePreference hook + KEY_THEME (system/light/dark)"
```

---

## Task 3: `ThemeProvider` + `useTheme` context + route-gated `.dark`

**Files:**
- Create: `src/notepad/theme/theme-context.ts`
- Create: `src/notepad/theme/ThemeProvider.tsx`
- Test: `src/notepad/theme/ThemeProvider.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useThemePreference` (Task 2), `shouldApplyDark` / `Theme` / `ResolvedTheme` (Task 2), `useAuthSession` from `@/auth/context/useAuthSession`, `useLocation` from `react-router-dom`.
- Produces:
  - `ThemeContext` (React context of `{ theme; resolvedTheme; setTheme }`) and `useTheme(): { theme: Theme; resolvedTheme: ResolvedTheme; setTheme: (t: Theme) => void }` (in `theme-context.ts`). Consumed by `ThemeToggle` (Task 5).
  - `ThemeProvider` React component (in `ThemeProvider.tsx`) wrapping children.

- [ ] **Step 1: Create the context + consumer hook**

Create `src/notepad/theme/theme-context.ts`:

```typescript
import { createContext, useContext } from 'react';
import type { Theme, ResolvedTheme } from './theme-types';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
```

- [ ] **Step 2: Write the failing provider test**

Create `src/notepad/theme/ThemeProvider.test.tsx`:

```tsx
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
const fakeSession = {
  subscribe: () => () => {},
  getSnapshot: () => ({ user: null, loading: false, adapter: null }),
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/notepad/theme/ThemeProvider.test.tsx`
Expected: FAIL — `Failed to resolve import "./ThemeProvider"`.

- [ ] **Step 4: Write the provider**

Create `src/notepad/theme/ThemeProvider.tsx`:

```tsx
import { useEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useThemePreference } from './useThemePreference';
import { shouldApplyDark } from './theme-types';
import { ThemeContext } from './theme-context';

/**
 * Owns notepad theme state and applies the `.dark` class to <html> only while a
 * notepad workspace route is mounted AND the resolved theme is dark (Approach C).
 * Because `.dark` lives on <html> while in the notepad, portaled Radix surfaces
 * and Tailwind `dark:` variants resolve correctly; because it is stripped on exit
 * (or on light), marketing/auth never render dark.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { theme, resolvedTheme, setTheme } = useThemePreference({ userId });
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    const on = shouldApplyDark(pathname, resolvedTheme);
    root.classList.toggle('dark', on);
    return () => { root.classList.remove('dark'); };
  }, [pathname, resolvedTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/notepad/theme/ThemeProvider.test.tsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 6: Mount the provider in `App.tsx`**

In `src/App.tsx`, add the import near the other auth/provider imports (after line 25):

```typescript
import { ThemeProvider } from '@/notepad/theme/ThemeProvider';
```

Then wrap `<RouteTransitionProvider>` with `<ThemeProvider>` inside `<AuthProvider>`. Change the opening (lines 205-207):

```tsx
    <AuthProvider>
      <ThemeProvider>
      <RouteTransitionProvider value={routeTransitionValue}>
        <LoadingOverlayContext.Provider value={overlayPresent}>
```

and the closing (lines 313-315):

```tsx
        </LoadingOverlayContext.Provider>
    </RouteTransitionProvider>
      </ThemeProvider>
    </AuthProvider>
```

- [ ] **Step 7: Verify the full notepad test surface + typecheck**

Run: `npx vitest run src/notepad/theme && npx tsc -b`
Expected: theme tests PASS; `tsc -b` shows only the pre-existing `force-sphere.test.ts` errors (zero new).

- [ ] **Step 8: Commit**

```bash
git add src/notepad/theme/theme-context.ts src/notepad/theme/ThemeProvider.tsx src/notepad/theme/ThemeProvider.test.tsx src/App.tsx
git commit -m "feat(notepad): ThemeProvider with route-gated .dark + useTheme context"
```

---

## Task 4: Tier 1 — `.dark {}` brand-var + shadcn HSL block in `index.css`

This is the 80%: redefining the ~8 brand vars + shadcn HSL set under `.dark` auto-flips ~430 var references and the entire TipTap editor. No automated unit test (CSS); acceptance is build + the route-gating already proven in Task 3 + manual sight-check.

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Produces: a `.dark { … }` rule (placed AFTER `:root` so its equal-specificity declarations win) and two new `:root` vars (`--surface-elevated`, plus its dark value) consumed by Task 6's literal conversions.

- [ ] **Step 1: Add `--surface-elevated` to `:root`**

In `src/index.css`, inside the `:root` block, after the `--lamplight-accent` line (line 100), add:

```css
    --lamplight-accent: #C49A78; /* scripture gold; overridden to indigo under [data-mode="study"] */
    /* Elevated chrome (toolbars / sidebar headers / popovers) — one step above
       --plaster. Single source for the warm three-step elevation ramp. */
    --surface-elevated: rgba(240, 236, 232, 0.97);
```

- [ ] **Step 2: Add the `.dark` block**

In `src/index.css`, immediately after the `:root { … }` block closes (the `}` that closes `:root`, then the `}` that closes its `@layer base` — around line 130), insert a new block. It must come after `:root` for source-order specificity to win:

```css
@layer base {
  /* Dark theme — applied to <html> only while a notepad workspace route is
     mounted (see ThemeProvider, Approach C). Values derived from the notepad
     landing hero: warm near-black bg, warm off-white ink, taupe-gold accent.
     Three-step warm elevation ramp: --app-bg #0a0a0a → --plaster #16130f →
     --surface-elevated ~#211d17. Starter values; tuned during Tier 4 visual QA. */
  .dark {
    /* PSALMS brand vars (inline-applied across the notepad) */
    --app-bg: #0a0a0a;
    --app-bg-rgb: 10, 10, 10;
    --plaster: #16130f;
    --surface-elevated: rgba(33, 29, 23, 0.97);
    --deep-umber: #efedee;            /* body ink inverts to warm off-white */
    --deep-umber-rgb: 239, 237, 238;  /* keep in sync so rgba(var(--deep-umber-rgb),…) flips */
    --charred: #f4f0e8;               /* headings/titles */
    --silica: #8d8478;                /* muted text/icons */
    --pale-stone: rgba(255, 255, 255, 0.10); /* hairlines */
    --warm-sand: #c4b5a0;             /* active/hover, blockquote rule */
    --alabaster: #14120f;             /* lamplight empty bg */
    --cream: #0e0e0e;                 /* Study desk bg (var(--cream,#F4F1EA) fallback) */
    --lamplight-accent: #c4b5a0;      /* scripture gold (study overrides to indigo) */
    --text-muted: #14120f;

    /* shadcn HSL set — warm-tinted dark so portaled dialogs/inputs/toasts match */
    --background: 30 8% 5%;
    --foreground: 40 12% 93%;
    --card: 34 18% 7%;
    --card-foreground: 40 12% 93%;
    --popover: 33 18% 11%;
    --popover-foreground: 40 12% 93%;
    --primary: 40 12% 93%;
    --primary-foreground: 30 8% 7%;
    --secondary: 33 12% 16%;
    --secondary-foreground: 40 12% 93%;
    --muted: 33 10% 14%;
    --muted-foreground: 35 8% 60%;
    --accent: 33 14% 18%;
    --accent-foreground: 40 12% 93%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 98%;
    --border: 36 8% 18%;
    --input: 36 8% 18%;
    --ring: 36 22% 64%;
  }
}
```

- [ ] **Step 3: Confirm the study indigo accent still layers on dark**

`src/notepad/study/study-theme.css` sets `[data-mode='study'] { --lamplight-accent: #43508C; }`. Because `[data-mode='study']` (an attribute selector, specificity 0,1,0) sits on the workspace root **inside** `<html class="dark">`, and the rule is loaded after `index.css`'s `.dark`, the indigo override wins within the Study subtree. No change needed — just verify after Task 7's QA. Run: `grep -n "lamplight-accent" src/notepad/study/study-theme.css` → confirms the override exists.

- [ ] **Step 4: Build to verify CSS compiles**

Run: `npx tsc -b && npx vite build`
Expected: build succeeds (Vite processes `index.css`); no new tsc errors. (If `vite build` is slow, `npx vite build --mode development` is acceptable for a compile check.)

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(notepad): dark-mode brand var + shadcn HSL block (Tier 1 auto-flip)"
```

---

## Task 5: `ThemeToggle` UI + mount points (desktop / mobile / study)

**Files:**
- Create: `src/notepad/theme/ThemeToggle.tsx`
- Test: `src/notepad/theme/ThemeToggle.test.tsx`
- Modify: `src/notepad/components/NotepadToolbar.tsx`
- Modify: `src/components/sections/notepad/mobile/MobileNotesView.tsx`
- Modify: `src/components/sections/notepad/mobile/MobileEditorView.tsx`
- Modify: `src/notepad/study/StudyWorkspace.tsx`

**Interfaces:**
- Consumes: `useTheme()` (Task 3), `Sun`/`Moon` from `lucide-react`.
- Produces: `ThemeToggle` component (no required props; optional `className?: string` + `size?: number`). Toggling sets explicit `'light'`/`'dark'` based on the **current resolved** theme (first interaction from `'system'` writes the opposite of what is currently shown).

- [ ] **Step 1: Write the failing toggle test**

Create `src/notepad/theme/ThemeToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeContext, type ThemeContextValue } from './theme-context';
import { ThemeToggle } from './ThemeToggle';

function renderWith(value: ThemeContextValue) {
  return render(
    <ThemeContext.Provider value={value}>
      <ThemeToggle />
    </ThemeContext.Provider>,
  );
}

describe('ThemeToggle', () => {
  it('renders an accessible control reflecting the resolved theme', () => {
    renderWith({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() });
    const btn = screen.getByRole('button', { name: /theme/i });
    expect(btn).toBeTruthy();
  });

  it('sets dark when currently resolved light', () => {
    const setTheme = vi.fn();
    renderWith({ theme: 'system', resolvedTheme: 'light', setTheme });
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('sets light when currently resolved dark', () => {
    const setTheme = vi.fn();
    renderWith({ theme: 'dark', resolvedTheme: 'dark', setTheme });
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    expect(setTheme).toHaveBeenCalledWith('light');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/theme/ThemeToggle.test.tsx`
Expected: FAIL — `Failed to resolve import "./ThemeToggle"`.

- [ ] **Step 3: Write the toggle**

Create `src/notepad/theme/ThemeToggle.tsx`:

```tsx
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-context';

interface ThemeToggleProps {
  className?: string;
  size?: number;
}

/**
 * Compact sun/moon control. Reflects the *resolved* theme; the first interaction
 * from 'system' writes an explicit 'light'/'dark' (the opposite of what shows).
 */
export function ThemeToggle({ className, size = 18 }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={
        'flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ' +
        (className ?? '')
      }
      style={{ color: 'var(--deep-umber)' }}
    >
      {isDark ? <Sun size={size} /> : <Moon size={size} />}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/theme/ThemeToggle.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Mount on desktop toolbar (beside New Note)**

In `src/notepad/components/NotepadToolbar.tsx`, add the import after line 21:

```typescript
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
```

Then place the toggle just before the New Note dropdown — after the spacer `<div className="flex-1" />` (line 123) and before `{/* NEW NOTE dropdown */}` (line 125):

```tsx
          {/* Spacer */}
          <div className="flex-1" />

          {/* Theme toggle */}
          <ThemeToggle className="w-8 h-8" />

          {/* NEW NOTE dropdown */}
```

- [ ] **Step 6: Mount on mobile notes view (beside account icon)**

In `src/components/sections/notepad/mobile/MobileNotesView.tsx`, add after line 4:

```typescript
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
```

Then in the `flex items-center gap-1` row, place the toggle before the Account button (between the Search button closing `</button>` at line 52 and the Account `<button>` at line 53):

```tsx
            <Search size={18} />
          </button>
          <ThemeToggle className="w-9 h-9" />
          <button
            aria-label="Account"
```

- [ ] **Step 7: Mount on mobile editor view (beside account icon)**

In `src/components/sections/notepad/mobile/MobileEditorView.tsx`, add after line 6:

```typescript
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
```

Then in the `flex items-center gap-1` row (line 44), place the toggle before the Account button (line 45):

```tsx
        <div className="flex items-center gap-1">
        <ThemeToggle className="w-9 h-9" />
        <button
          aria-label="Account"
```

- [ ] **Step 8: Mount on Study desk (parity, beside NotepadAuthControls)**

In `src/notepad/study/StudyWorkspace.tsx`, add the import alongside the existing notepad imports (top of file):

```typescript
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
```

Then place the toggle after the spacer and before `<NotepadAuthControls />` (lines 72-73):

```tsx
        {/* Push auth controls to the far right, same spot as the journal toolbar */}
        <div style={{ flex: 1 }} />
        <ThemeToggle className="w-8 h-8" />
        <NotepadAuthControls />
```

- [ ] **Step 9: Typecheck, lint, and run theme tests**

Run: `npx tsc -b && npx eslint src/notepad/theme src/notepad/components/NotepadToolbar.tsx src/components/sections/notepad/mobile/MobileNotesView.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx src/notepad/study/StudyWorkspace.tsx && npx vitest run src/notepad/theme`
Expected: zero new tsc/lint errors; all theme tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/notepad/theme/ThemeToggle.tsx src/notepad/theme/ThemeToggle.test.tsx src/notepad/components/NotepadToolbar.tsx src/components/sections/notepad/mobile/MobileNotesView.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx src/notepad/study/StudyWorkspace.tsx
git commit -m "feat(notepad): theme toggle UI (desktop toolbar, mobile headers, study desk)"
```

---

## Task 6: Tier 2 — literal families → vars + `dark:` hover

Recurring inline literals that won't auto-flip (they're not vars) get converted to their brand var; the `hover:bg-black/5` family gets a `dark:hover:bg-white/10` companion. Mechanical; acceptance is grep + build + visual.

**Files (per the spec §6 Tier 2 list):**
- Modify: `src/notepad/components/NotepadToolbar.tsx`, `src/notepad/components/Editor.tsx`, `src/notepad/components/Sidebar.tsx`, `src/components/sections/notepad/GraphPane.tsx`, `src/notepad/components/NotepadAuthControls.tsx`, `src/notepad/components/FolderItem.tsx`, `src/notepad/components/NoteItem.tsx`, `src/components/sections/notepad/mobile/MobileNotesView.tsx`, `src/components/sections/notepad/mobile/MobileEditorView.tsx`

**Interfaces:**
- Consumes: `--surface-elevated`, `--plaster`, `--warm-sand`, `--pale-stone`, `--deep-umber-rgb` (all flipped under `.dark` in Task 4).

- [ ] **Step 1: Convert the toolbar's elevated-surface literal**

In `src/notepad/components/NotepadToolbar.tsx`, change the toolbar background (line 62) from the literal to the var so it flips:

```tsx
          background: 'var(--surface-elevated)',
```

The search-bar button literals (lines 98-99, 112) are `--warm-sand`/`--pale-stone` tints; convert:

```tsx
              background: 'rgba(188, 179, 163, 0.15)',  →  background: 'color-mix(in srgb, var(--warm-sand) 15%, transparent)',
              border: '1px solid rgba(206, 204, 202, 0.5)',  →  border: '1px solid color-mix(in srgb, var(--pale-stone) 50%, transparent)',
```

and line 112 `background: 'rgba(188, 179, 163, 0.3)'` → `background: 'color-mix(in srgb, var(--warm-sand) 30%, transparent)'`.

> Note: `--pale-stone` is already `rgba(255,255,255,.10)` under dark, so `color-mix(... 50%, transparent)` halves its alpha — acceptable. If `color-mix` support is a concern, the equivalent is a `.dark`-scoped class override in `index.css`; prefer `color-mix` (supported in all target browsers per the existing codebase usage — verify with `grep -rn "color-mix" src/`). If unused elsewhere, fall back to keeping the literal under `:root` and adding a `.dark .notepad-toolbar-search { background: rgba(196,181,160,.15) }` rule.

- [ ] **Step 2: Find every `hover:bg-black/5` / `bg-black/10` in the Tier 2 files**

Run: `grep -rn "hover:bg-black/5\|hover:bg-black/10\|bg-black/5\|bg-black/10" src/notepad/components/Editor.tsx src/notepad/components/Sidebar.tsx src/components/sections/notepad/GraphPane.tsx src/notepad/components/NotepadAuthControls.tsx src/notepad/components/FolderItem.tsx src/notepad/components/NoteItem.tsx src/notepad/components/NotepadToolbar.tsx src/components/sections/notepad/mobile/MobileNotesView.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx`
Expected: ~20 matches. Record them.

- [ ] **Step 3: Add `dark:hover:bg-white/10` beside each black hover**

For each match, append the dark companion in the same `className` string. Example pattern (apply to every hit):

```
hover:bg-black/5            →  hover:bg-black/5 dark:hover:bg-white/10
hover:bg-black/10           →  hover:bg-black/10 dark:hover:bg-white/15
```

(The `NotepadToolbar` shared `btnClass` at line 52-53 is the highest-leverage single edit — it covers Back, Upload, Graph, New Note buttons at once:)

```typescript
  const btnClass =
    'flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer';
```

- [ ] **Step 4: Convert remaining `rgba(240,236,232,*)` / `rgba(188,179,163,*)` / `rgba(206,204,202,*)` literals in these files**

Run: `grep -rn "rgba(240, *236, *232\|rgba(188, *179, *163\|rgba(206, *204, *202\|rgba(62, *50, *40\|rgba(58, *52, *38" src/notepad src/components/sections/notepad`
For each hit, replace with the matching var:
- `rgba(240,236,232,a)` → `color-mix(in srgb, var(--plaster) <a*100>%, transparent)` (panels/popovers/floating surfaces) — or `var(--surface-elevated)` if it's a solid chrome surface.
- `rgba(188,179,163,a)` → `color-mix(in srgb, var(--warm-sand) <a*100>%, transparent)`
- `rgba(206,204,202,a)` → `color-mix(in srgb, var(--pale-stone) <a*100>%, transparent)`
- `rgba(62,50,40,a)` / `rgba(58,52,38,a)` → `rgba(var(--deep-umber-rgb), a)` (these auto-flip because `--deep-umber-rgb` flips in Task 4).

Prioritize the `rgba(62,50,40,*)`/`rgba(58,52,38,*)` → `rgba(var(--deep-umber-rgb), *)` swaps — those are the highest-impact (scrollbars, borders, shadows reading as dark-on-dark otherwise).

- [ ] **Step 5: Build, lint, and run the notepad test suite**

Run: `npx tsc -b && npx eslint src/notepad/components src/components/sections/notepad && npx vitest run src/notepad src/components/sections/notepad`
Expected: zero new errors; the pre-existing `Editor.toolbar-placement` failure is unchanged (still red, no new reds). Confirm the count of failing files is exactly the baseline 2.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(notepad): Tier 2 dark-mode — literal→var conversions + dark: hover companions"
```

---

## Task 7: Tier 3 — graph canvas re-theming via computed CSS vars

The graph paints on `<canvas>` via JS, so CSS vars don't reach it. Introduce graph color vars (light + dark), read them at draw time with `getComputedStyle`, and derive the node/edge/label palette. Falls back to today's hardcoded values when vars are absent (keeps existing structural-mock tests green).

**Files:**
- Create: `src/notepad/graph/graph-palette.ts`
- Test: `src/notepad/graph/graph-palette.test.ts`
- Modify: `src/index.css` (add graph vars to `:root` and `.dark`)
- Modify: `src/notepad/graph/graph-view.ts`
- Modify: `src/components/sections/notepad/GraphPane.tsx`

**Interfaces:**
- Produces: `resolveGraphPalette(read: (name: string) => string): GraphPalette` where
  `GraphPalette = { nodeColors: Record<'scripture'|'sermon'|'devotion'|'theme'|'general', string>; edge: string; label: string }`.
  `read` is typically `(n) => getComputedStyle(el).getPropertyValue(n).trim()`. Empty reads fall back to the current light defaults.

- [ ] **Step 1: Write the failing palette test**

Create `src/notepad/graph/graph-palette.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveGraphPalette, GRAPH_NODE_COLORS_LIGHT } from './graph-palette';

describe('resolveGraphPalette', () => {
  it('falls back to light defaults when vars are empty (jsdom/tests)', () => {
    const p = resolveGraphPalette(() => '');
    expect(p.nodeColors.scripture).toBe(GRAPH_NODE_COLORS_LIGHT.scripture);
    expect(p.edge).toBe('rgba(168, 160, 145, 1)');
    expect(p.label).toBe('rgba(62, 50, 40, 1)');
  });

  it('reads provided CSS var values when present', () => {
    const vars: Record<string, string> = {
      '--graph-node-scripture': '#d8c4a8',
      '--graph-edge': 'rgba(120, 116, 108, 1)',
      '--graph-label': 'rgba(239, 237, 238, 1)',
    };
    const p = resolveGraphPalette((n) => vars[n] ?? '');
    expect(p.nodeColors.scripture).toBe('#d8c4a8');
    expect(p.edge).toBe('rgba(120, 116, 108, 1)');
    expect(p.label).toBe('rgba(239, 237, 238, 1)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/graph/graph-palette.test.ts`
Expected: FAIL — `Failed to resolve import "./graph-palette"`.

- [ ] **Step 3: Write the palette helper**

Create `src/notepad/graph/graph-palette.ts`:

```typescript
export type GraphNodeType = 'scripture' | 'sermon' | 'devotion' | 'theme' | 'general';

export interface GraphPalette {
  nodeColors: Record<GraphNodeType, string>;
  edge: string;
  label: string;
}

// Current (light) node hues — also the fallback when CSS vars are unavailable.
export const GRAPH_NODE_COLORS_LIGHT: Record<GraphNodeType, string> = {
  scripture: '#C49A78',
  sermon: '#7A9BAE',
  devotion: '#6B8B7A',
  theme: '#D4A0A0',
  general: '#9E9484',
};

const EDGE_LIGHT = 'rgba(168, 160, 145, 1)';
const LABEL_LIGHT = 'rgba(62, 50, 40, 1)';

const VAR: Record<GraphNodeType, string> = {
  scripture: '--graph-node-scripture',
  sermon: '--graph-node-sermon',
  devotion: '--graph-node-devotion',
  theme: '--graph-node-theme',
  general: '--graph-node-general',
};

/**
 * Resolve the graph palette from CSS custom properties so the canvas tracks the
 * theme. `read` returns a computed property value (or '' if undefined). Any var
 * that reads empty falls back to the light default — so tests with structural
 * canvas mocks (no real computed styles) keep today's colors.
 */
export function resolveGraphPalette(read: (name: string) => string): GraphPalette {
  const pick = (v: string, fallback: string) => {
    const s = v.trim();
    return s.length > 0 ? s : fallback;
  };
  const nodeColors = (Object.keys(VAR) as GraphNodeType[]).reduce((acc, k) => {
    acc[k] = pick(read(VAR[k]), GRAPH_NODE_COLORS_LIGHT[k]);
    return acc;
  }, {} as Record<GraphNodeType, string>);
  return {
    nodeColors,
    edge: pick(read('--graph-edge'), EDGE_LIGHT),
    label: pick(read('--graph-label'), LABEL_LIGHT),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/graph/graph-palette.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Add graph vars to `:root` and `.dark` in `index.css`**

In `:root` (after `--surface-elevated` from Task 4), add:

```css
    /* Graph canvas palette (read by graph-view.ts via getComputedStyle) */
    --graph-node-scripture: #C49A78;
    --graph-node-sermon: #7A9BAE;
    --graph-node-devotion: #6B8B7A;
    --graph-node-theme: #D4A0A0;
    --graph-node-general: #9E9484;
    --graph-edge: rgba(168, 160, 145, 1);
    --graph-label: rgba(62, 50, 40, 1);
```

In `.dark` (Task 4 block), add (node hues brightened slightly for contrast on `#0a0a0a`; tuned in Tier 4):

```css
    --graph-node-scripture: #d8b48f;
    --graph-node-sermon: #8fb4c8;
    --graph-node-devotion: #84a795;
    --graph-node-theme: #e0b0b0;
    --graph-node-general: #b8ac9a;
    --graph-edge: rgba(140, 132, 120, 0.85);
    --graph-label: rgba(239, 237, 238, 0.9);
```

- [ ] **Step 6: Consume the palette in `graph-view.ts`**

In `src/notepad/graph/graph-view.ts`:
1. Add the import at the top: `import { resolveGraphPalette, type GraphPalette } from './graph-palette';`
2. Delete the module-level `const NODE_COLORS` (lines 79-85).
3. Add a private field on the class: `private palette: GraphPalette | null = null;` (near `canvas`/`container`/`ctx` fields ~line 148).
4. In the draw method (`render`/`draw` around line 320, before the edge/node loops), refresh the palette from the container's computed styles each frame (cheap; getComputedStyle is fast and this keeps it theme-synced):

```typescript
    const styles = this.container ? getComputedStyle(this.container) : null;
    const palette = resolveGraphPalette((name) => styles?.getPropertyValue(name) ?? '');
    this.palette = palette;
```

5. Replace the literals:
   - edge `ctx.strokeStyle = \`rgba(168, 160, 145, ${alpha})\`;` (line 374) → build from `palette.edge` (it has alpha 1; multiply): `ctx.strokeStyle = palette.edge.replace(/[\d.]+\)$/, `${alpha})`);` — or simpler, keep edge base opaque and use `ctx.globalAlpha = alpha` around the stroke. Use the `globalAlpha` form to avoid string surgery:

```typescript
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = palette.edge;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = (1.8 + link.weight * 1.5) * this.settings.edgeThickness * cam.scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
```

   - node color `const color = NODE_COLORS[n.type] ?? '#999';` (line 385) → `const color = palette.nodeColors[n.type as keyof typeof palette.nodeColors] ?? '#999';`
   - hover ring `ctx.strokeStyle = \`${NODE_COLORS[d.n.type] ?? '#999'}80\`;` (line 413) → `ctx.strokeStyle = \`${palette.nodeColors[d.n.type as keyof typeof palette.nodeColors] ?? '#999'}80\`;`
   - hover label `ctx.fillStyle = 'rgba(62, 50, 40, 0.85)';` (line 419) → `ctx.fillStyle = palette.label;`

- [ ] **Step 7: Consume the palette in `GraphPane.tsx` legend**

In `src/components/sections/notepad/GraphPane.tsx`, the duplicate `NODE_COLORS` (lines 16-22) feeds the legend/filter swatches in the DOM (so it can use CSS vars directly). Replace the object with var references so the legend matches the canvas:

```typescript
const NODE_COLORS: Record<string, string> = {
  scripture: 'var(--graph-node-scripture)',
  sermon: 'var(--graph-node-sermon)',
  devotion: 'var(--graph-node-devotion)',
  theme: 'var(--graph-node-theme)',
  general: 'var(--graph-node-general)',
};
```

Also re-theme the GraphPane literals flagged in the spec: edge legend `rgba(168,160,145,*)` → `var(--graph-edge)`; hover-label/popover surface literals → `var(--plaster)` / `rgba(var(--deep-umber-rgb), *)`; `accent-[#C49A78]` → `accent-[color:var(--graph-node-scripture)]` (or a `.dark` override). Find them: `grep -n "C49A78\|168, *160, *145\|62, *50, *40" src/components/sections/notepad/GraphPane.tsx`.

- [ ] **Step 8: Run the graph tests + typecheck + build**

Run: `npx vitest run src/notepad/graph && npx tsc -b`
Expected: `graph-palette` tests PASS; existing graph-view tests still PASS (fallback preserves colors under structural mocks); the pre-existing `force-sphere.test.ts` tsc errors are unchanged (zero new). Build the bundle: `npx vite build` succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/notepad/graph/graph-palette.ts src/notepad/graph/graph-palette.test.ts src/notepad/graph/graph-view.ts src/components/sections/notepad/GraphPane.tsx src/index.css
git commit -m "feat(notepad): Tier 3 graph canvas re-themes from computed CSS vars"
```

---

## Task 8: Tier 3 — specific surfaces (scoped `.dark` CSS overrides)

The remaining JS/CSS surfaces that don't ride the brand vars. Each gets a `.dark { … }` override. CSS-only; acceptance is build + Tier 4 visual sight-check.

**Files:**
- Modify: `src/notepad/extensions/scripture-ref.css`
- Modify: `src/notepad/scan/scan.css`
- Modify: lamplight chat bubble styles (`src/components/lamplight/chat/*`, `src/notepad/study/panes/LamplightStudyPanel.tsx`)
- Modify: `src/notepad/decorations/DecorationItem.tsx`

- [ ] **Step 1: Inventory the hardcoded colors per surface**

Run:
```
grep -n "#[0-9a-fA-F]\{3,6\}\|rgba(" src/notepad/extensions/scripture-ref.css
grep -n "#[0-9a-fA-F]\{3,6\}\|rgba(" src/notepad/scan/scan.css
grep -rn "#fff\|#FFFFFF\|rgba(255" src/notepad/decorations/DecorationItem.tsx
grep -rln "background\|color" src/components/lamplight/chat/
```
Record the gold accents, verse-card bg, shadows (scripture-ref); gold FAB / camera bg / error-rose / found-verse-teal (scan); chat bubble bg/border (lamplight); `#fff` sticker handles + shadows (decorations).

- [ ] **Step 2: Add `.dark` overrides to `scripture-ref.css`**

Append a dark block. Example (adjust selectors to the actual classes found in Step 1):

```css
/* Dark theme — gold accents read brighter on near-black; verse card lifts to paper. */
.dark .scripture-ref-pill { color: var(--lamplight-accent); }
.dark .scripture-verse-card {
  background: var(--surface-elevated);
  border-color: var(--pale-stone);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.dark .verse-search-dropdown { background: var(--surface-elevated); }
```

Confirm the scoped `::selection` override still reads on dark — if it sets a light highlight, add `.dark … ::selection { background: rgba(196,181,160,.3); color: var(--charred); }`.

- [ ] **Step 3: Add `.dark` overrides to `scan.css`**

Append, mapping each named color to its dark counterpart (keep semantic colors — error rose, found-verse teal — but darken backgrounds and lift surfaces). Example:

```css
.dark .scan-camera-bg { background: var(--app-bg); }
.dark .scan-sheet { background: var(--surface-elevated); color: var(--deep-umber); }
.dark .scan-error { color: #f1a3a3; }      /* rose, lifted for dark contrast */
.dark .scan-found-verse { color: #7fc8b6; } /* teal, lifted */
```

- [ ] **Step 4: Re-theme lamplight chat bubbles**

For the chat bubble styles found in Step 1, ensure assistant/user bubble backgrounds and borders use brand vars (`--surface-elevated`, `--plaster`, `--pale-stone`) rather than fixed light hexes, OR add `.dark` overrides. Verify the apparatus-grounded study panel (`LamplightStudyPanel.tsx`, which uses `var(--lamplight-accent)` inline — already flips) reads correctly under both `data-mode="study"` (indigo) and journal (gold).

- [ ] **Step 5: Re-theme decoration sticker handles**

In `src/notepad/decorations/DecorationItem.tsx`, the `#fff` handle/shadow values should lift on dark. Where a handle is `background: '#fff'`, change to `background: 'var(--plaster)'` (or add a `dark:` class if it's a Tailwind class). Spot-check `text-red-600` (error ×8) and `text-white` (×2) contrast — if any sit on a now-dark surface and lose contrast, add `dark:text-red-400` / `dark:text-…` companions.

- [ ] **Step 6: Build + lint**

Run: `npx vite build && npx eslint src/notepad/decorations/DecorationItem.tsx`
Expected: build succeeds; zero new lint errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(notepad): Tier 3 dark overrides — scripture-ref, scan, lamplight chat, decorations"
```

---

## Task 9: Tier 4 — visual QA pass

No automated screenshot gate (per spec §8). Manual pass against the running app, tuning palette values where contrast or warmth is off.

**Files:**
- Modify (tuning only): `src/index.css` `.dark` block.

- [ ] **Step 1: Run the app**

Run: `npm run dev`
Open `http://localhost:5173/notepad/notes`, sign in (or stay anon), and flip the theme toggle.

- [ ] **Step 2: Walk the surface checklist** (toggle dark on each; verify no light-on-light or dark-on-dark, readable contrast, warm—not cool—greys):
  - Journal: sidebar, note list, editor paper, TipTap toolbar + all marks (headings, blockquote rule, code, links).
  - Bible: reader, split view, translation dropdown, verse highlighting swatches.
  - Study desk: indigo accent still distinct from journal gold; panes, apparatus rail, lamplight study panel.
  - Graph: nodes legible on near-black, edges visible, hover label readable, legend swatches match canvas.
  - Collection / folders: folder + note rows, hover states, drag affordances.
  - Lamplight chat: assistant/user bubbles, scripture cards.
  - Onboarding SpotlightTour, search dialog (⌘K), all dropdowns/dialogs (portaled — confirm they're dark).
  - Mobile (resize to 390px): notes view, editor view, toggle beside account icon, FAB menus.

- [ ] **Step 3: Confirm marketing stays light**

Navigate to `/`, `/notepad` (landing), `/login`, `/profile` with dark active in the notepad — confirm `.dark` is stripped (DevTools: `<html>` has no `dark` class) and these render light. Navigate back to `/notepad/notes` — dark returns.

- [ ] **Step 4: Tune values**

Adjust any `.dark` var that reads wrong (e.g. paper too dark/light, accent too dim, borders invisible). Re-check after each change. Keep the three-step ramp intact (`--app-bg` < `--plaster` < `--surface-elevated` in lightness).

- [ ] **Step 5: Final full verification**

Run: `npm run build && npm run test`
Expected: build succeeds; test run shows the **same** baseline failures only (2 pre-existing failing files: `Editor.toolbar-placement`, `garden-scene`), zero new. Run `npm run lint` and confirm the error count has not risen above the ~114 baseline for files this feature touched.

- [ ] **Step 6: Commit any tuning**

```bash
git add src/index.css
git commit -m "feat(notepad): Tier 4 visual QA palette tuning"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §3 Approach C, route-gated `.dark`, provider placement | Task 3 |
| §4.1 stored value `system/light/dark` default `system` | Task 2 (`theme-types`, hook) |
| §4.2 `useThemePreference` (init, hydrate, setter) + `KEY_THEME` | Task 2 |
| §4.3 migration `039_profiles_theme` + privileged-column guard test | Task 1 |
| §5 palette mapping (brand vars + shadcn HSL + `--cream` + study indigo) | Task 4 |
| §6 Tier 1 `.dark` auto-flip | Task 4 |
| §6 Tier 2 literal families + `dark:` hover | Task 6 |
| §6 Tier 3 graph canvas (computed vars) | Task 7 |
| §6 Tier 3 scripture-ref / scan / lamplight / decorations / contrast | Task 8 |
| §6 Tier 4 visual QA | Task 9 |
| §7 toggle UI + mount points (desktop/mobile/study) | Task 5 |
| §8 testing (hook unit, migration guard, provider gating, visual) | Tasks 1,2,3,9 |
| §9 FOUC (layout-effect from sync localStorage) | Task 3 (effect on resolvedTheme) |

No gaps. Highlight swatches (§6 "may stay fixed by intent") are covered as a spot-check in Task 8/9, not a forced conversion — matches spec intent.

**2. Placeholder scan:** Code steps carry complete code. Tier 2/3 mechanical edits (Tasks 6 & 8) use exact grep commands + explicit literal→var mappings rather than enumerating all ~20–430 sites (the bulk auto-flip via Task 4; the rest are uniform substitutions). This is intentional and matches the spec's tiered strategy — not a "fill in later" placeholder.

**3. Type consistency:** `Theme` / `ResolvedTheme` defined in `theme-types.ts` (Task 2), consumed unchanged in hook (Task 2), context (`ThemeContextValue`, Task 3), provider (Task 3), toggle (Task 5). `useThemePreference` returns `{ theme, resolvedTheme, setTheme }` — same shape consumed by `ThemeProvider` and exposed via `useTheme()`. `resolveGraphPalette(read)` / `GraphPalette` (Task 7) consistent between helper, test, and `graph-view.ts`. `KEY_THEME = 'psalms.session.theme'` consistent across `session-storage.ts`, hook, and tests. `isNotepadRoute` / `shouldApplyDark` defined once (Task 2), consumed in provider (Task 3).
