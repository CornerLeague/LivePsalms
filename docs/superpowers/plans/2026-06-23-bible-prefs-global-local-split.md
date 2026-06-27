# Global-vs-Local Bible Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make localStorage the authoritative per-device Bible version + verse-layout value, with the profile row as a global value written only by Profile Settings → Save and read once to seed a fresh device — fixing the reload-revert bug and splitting the in-reader pillar (local-only) from Settings (global).

**Architecture:** The two preference hooks (`useBibleTranslation`, `useBibleVerseLayout`) keep localStorage as the instant default and only **seed** from the profile when the device has no stored value (killing today's unconditional DB-wins hydration + race). Each hook exposes a local setter (state + localStorage) and an awaited global writer (state + localStorage + DB). `BiblePrefsProvider` composes the two global writers into a single `saveGlobalPrefs`. The in-reader pillar wires to the local setters and adds a one-line toast nudge + a Radix tooltip; Profile Settings becomes a draft form with an explicit Save.

**Tech Stack:** React + TypeScript, Vite, Vitest + @testing-library/react + jest-dom, sonner (toasts), `@radix-ui/react-tooltip` via `src/components/ui/tooltip.tsx`, Supabase JS.

## Global Constraints

- **Gates per commit:** `npx tsc -b` exits 0; `npx eslint <touched files>` adds zero new errors on touched files; the affected Vitest set stays green. (Repo baseline is otherwise clean.)
- **No DB migration** — `profiles.bible_translation` (037/038) and `profiles.bible_verse_layout` (040) already exist.
- **localStorage keys (verbatim, unchanged):** `psalms.bible.translation` (`KEY_BIBLE_TRANSLATION`), `psalms.bible.verseLayout` (`KEY_BIBLE_VERSE_LAYOUT`).
- **Hook symbol names unchanged** (`useBibleTranslation`, `useBibleVerseLayout`), so `src/notepad/bible/prefs/single-instance.test.ts` needs NO change and must stay green.
- **Toast nudge copy (verbatim), version-only:** `Switched to ${translationInfo(value).label} on this device. To use it everywhere, set it in Profile → Bible & Reading.`
- **Tooltip copy (verbatim), with the translation attribution kept as a secondary line:** `Changing the version here applies to this device only. To set it everywhere, update Profile → Bible & Reading.`
- **Settings Save toasts (verbatim):** success `Bible settings saved`; error `result.error ?? 'Could not save Bible settings'`.
- **No layout nudge** — the toast/tooltip nudge is version-only.
- **Branch:** `feat/bible-version-global-prefs` (extends PR #53). Commit per task.

## File Structure

- `src/notepad/session/session-storage.ts` — add `hasStored(key)` presence helper (the only place that knows raw localStorage).
- `src/notepad/bible/useBibleTranslation.ts` / `useBibleVerseLayout.ts` — seed-only hydration + `setLocal*` + `saveGlobal*`. One column each.
- `src/notepad/bible/prefs/bible-prefs-context.ts` — the context interface (the public contract).
- `src/notepad/bible/prefs/BiblePrefsProvider.tsx` — composes the hooks + `saveGlobalPrefs`.
- `src/auth/settings/BibleReadingSettingsSection.tsx` — draft form + Save (the only global writer surface).
- `src/notepad/bible/BibleReader.tsx` — pillar `<select>` local set + toast nudge + tooltip (presentational; props in, no context).
- `src/notepad/bible/BibleStudyPane.tsx`, `src/notepad/study/panes/StudyReader.tsx` — wire pillar handlers to `setLocal*`.
- Tests live beside each unit (`*.test.ts(x)`).

---

### Task 1: `hasStored` presence helper

**Files:**
- Modify: `src/notepad/session/session-storage.ts`
- Test: `src/notepad/session/session-storage.test.ts` (create)

**Interfaces:**
- Produces: `hasStored(key: string): boolean` — `true` iff localStorage has any value at `key` (distinguishes "absent → default" from "explicitly set").

- [ ] **Step 1: Write the failing test**

Create `src/notepad/session/session-storage.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { hasStored, saveEnum, KEY_BIBLE_TRANSLATION } from './session-storage';

describe('hasStored', () => {
  beforeEach(() => localStorage.clear());

  it('returns false when the key was never written', () => {
    expect(hasStored(KEY_BIBLE_TRANSLATION)).toBe(false);
  });

  it('returns true once a value has been stored', () => {
    saveEnum(KEY_BIBLE_TRANSLATION, 'KJV');
    expect(hasStored(KEY_BIBLE_TRANSLATION)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/session/session-storage.test.ts`
Expected: FAIL — `hasStored` is not exported.

- [ ] **Step 3: Add the helper**

In `src/notepad/session/session-storage.ts`, immediately after `saveEnum` (the existing `export function saveEnum(...)`), add:

```ts
/** True iff this key has any stored value — distinguishes "set" from "absent → default". */
export function hasStored(key: string): boolean {
  return readRaw(key) != null;
}
```

(`readRaw` is the module-private safe getter `loadEnum` already uses — reuse it; do not add a new try/catch.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/session/session-storage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
npx tsc -b
npx eslint src/notepad/session/session-storage.ts src/notepad/session/session-storage.test.ts
git add src/notepad/session/session-storage.ts src/notepad/session/session-storage.test.ts
git commit -m "feat(session-storage): add hasStored presence helper"
```

---

### Task 2: Seed-only hooks with local + global writers (bug fix)

**Files:**
- Modify: `src/notepad/bible/useBibleTranslation.ts`
- Modify: `src/notepad/bible/useBibleVerseLayout.ts`
- Modify: `src/notepad/bible/prefs/BiblePrefsProvider.tsx` (consume new hook API; keep the existing context shape via alias so consumers still compile)
- Test: `src/notepad/bible/useBibleTranslation.test.ts` (rewrite)
- Test: `src/notepad/bible/useBibleVerseLayout.test.ts` (rewrite)

**Interfaces:**
- Consumes: `hasStored` (Task 1), `loadEnum`/`saveEnum`, `KEY_BIBLE_TRANSLATION`/`KEY_BIBLE_VERSE_LAYOUT`.
- Produces:
  - `useBibleTranslation({userId}) -> { translation, setLocalTranslation(t), saveGlobalTranslation(t): Promise<{ok:boolean; error?:string}> }`
  - `useBibleVerseLayout({userId}) -> { verseLayout, setLocalVerseLayout(l), saveGlobalVerseLayout(l): Promise<{ok:boolean; error?:string}> }`
  - Provider still exposes the OLD context shape (`setTranslation`/`setVerseLayout`) aliased to the local setters — the context interface changes in Task 3.

- [ ] **Step 1: Write the failing tests — `useBibleTranslation.test.ts` (full rewrite)**

Replace the entire file `src/notepad/bible/useBibleTranslation.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/notepad/bible/useBibleTranslation.test.ts`
Expected: FAIL — `setLocalTranslation`/`saveGlobalTranslation` do not exist.

- [ ] **Step 3: Rewrite `useBibleTranslation.ts`**

Replace the entire file `src/notepad/bible/useBibleTranslation.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, hasStored, KEY_BIBLE_TRANSLATION } from '../session/session-storage';
import { type BibleTranslation, DEFAULT_TRANSLATION, TRANSLATIONS, isBibleTranslation } from './translations';
import { supabase } from '@/lib/supabase';

const ALLOWED = TRANSLATIONS.map((t) => t.id) as readonly BibleTranslation[];

export interface UseBibleTranslationResult {
  translation: BibleTranslation;
  setLocalTranslation: (t: BibleTranslation) => void;
  saveGlobalTranslation: (t: BibleTranslation) => Promise<{ ok: boolean; error?: string }>;
}

export function useBibleTranslation(
  { userId = null }: { userId?: string | null } = {},
): UseBibleTranslationResult {
  const [translation, setState] = useState<BibleTranslation>(() =>
    loadEnum<BibleTranslation>(KEY_BIBLE_TRANSLATION, ALLOWED, DEFAULT_TRANSLATION),
  );

  // Seed from the profile ONLY when this device has no stored value yet. A device
  // that already has a local pick keeps it — local wins on reload (the bug fix).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    if (hasStored(KEY_BIBLE_TRANSLATION)) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('bible_translation').eq('id', userId).maybeSingle();
      const remote = data?.bible_translation;
      if (!cancelled && isBibleTranslation(remote)) {
        setState(remote);
        saveEnum(KEY_BIBLE_TRANSLATION, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setLocalTranslation = useCallback((t: BibleTranslation) => {
    setState(t);
    saveEnum(KEY_BIBLE_TRANSLATION, t);
  }, []);

  const saveGlobalTranslation = useCallback(
    async (t: BibleTranslation): Promise<{ ok: boolean; error?: string }> => {
      setState(t);
      saveEnum(KEY_BIBLE_TRANSLATION, t);
      if (!userId || !supabase) return { ok: true };
      const { error } = await supabase
        .from('profiles').update({ bible_translation: t }).eq('id', userId);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    [userId],
  );

  return { translation, setLocalTranslation, saveGlobalTranslation };
}
```

- [ ] **Step 4: Mirror the test for `useBibleVerseLayout.test.ts` (full rewrite)**

Replace the entire file `src/notepad/bible/useBibleVerseLayout.test.ts` with:

```ts
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
```

- [ ] **Step 5: Rewrite `useBibleVerseLayout.ts`**

Replace the entire file `src/notepad/bible/useBibleVerseLayout.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, hasStored, KEY_BIBLE_VERSE_LAYOUT } from '../session/session-storage';
import { type VerseLayout, DEFAULT_VERSE_LAYOUT, VERSE_LAYOUTS, isVerseLayout } from './bible-layout-types';
import { supabase } from '@/lib/supabase';

export interface UseBibleVerseLayoutResult {
  verseLayout: VerseLayout;
  setLocalVerseLayout: (l: VerseLayout) => void;
  saveGlobalVerseLayout: (l: VerseLayout) => Promise<{ ok: boolean; error?: string }>;
}

export function useBibleVerseLayout(
  { userId = null }: { userId?: string | null } = {},
): UseBibleVerseLayoutResult {
  const [verseLayout, setState] = useState<VerseLayout>(() =>
    loadEnum<VerseLayout>(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS, DEFAULT_VERSE_LAYOUT),
  );

  // Seed from the profile ONLY when this device has no stored value yet.
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    if (hasStored(KEY_BIBLE_VERSE_LAYOUT)) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('bible_verse_layout').eq('id', userId).maybeSingle();
      const remote = data?.bible_verse_layout;
      if (!cancelled && isVerseLayout(remote)) {
        setState(remote);
        saveEnum(KEY_BIBLE_VERSE_LAYOUT, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setLocalVerseLayout = useCallback((l: VerseLayout) => {
    setState(l);
    saveEnum(KEY_BIBLE_VERSE_LAYOUT, l);
  }, []);

  const saveGlobalVerseLayout = useCallback(
    async (l: VerseLayout): Promise<{ ok: boolean; error?: string }> => {
      setState(l);
      saveEnum(KEY_BIBLE_VERSE_LAYOUT, l);
      if (!userId || !supabase) return { ok: true };
      const { error } = await supabase
        .from('profiles').update({ bible_verse_layout: l }).eq('id', userId);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    [userId],
  );

  return { verseLayout, setLocalVerseLayout, saveGlobalVerseLayout };
}
```

- [ ] **Step 6: Update `BiblePrefsProvider.tsx` to consume the new hook API (keep the old context shape via alias)**

Replace the entire file `src/notepad/bible/prefs/BiblePrefsProvider.tsx` with:

```tsx
import { useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useBibleTranslation } from '../useBibleTranslation';
import { useBibleVerseLayout } from '../useBibleVerseLayout';
import { BiblePrefsContext } from './bible-prefs-context';

/**
 * Single source of truth for Bible version + verse layout. Calls each hook ONCE
 * with the signed-in userId. localStorage is the authoritative per-device value;
 * the profile row is the global value — seeded once on a fresh device and written
 * only by Profile Settings → Save.
 */
export function BiblePrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { translation, setLocalTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setLocalVerseLayout } = useBibleVerseLayout({ userId });

  // Transitional: the context still exposes setTranslation/setVerseLayout until the
  // interface migrates in the next task. They alias the local setters (no DB write).
  const value = useMemo(
    () => ({
      translation,
      setTranslation: setLocalTranslation,
      verseLayout,
      setVerseLayout: setLocalVerseLayout,
    }),
    [translation, setLocalTranslation, verseLayout, setLocalVerseLayout],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
```

- [ ] **Step 7: Run the hook + provider tests**

Run: `npx vitest run src/notepad/bible/useBibleTranslation.test.ts src/notepad/bible/useBibleVerseLayout.test.ts src/notepad/bible/prefs/BiblePrefsProvider.test.tsx src/notepad/bible/prefs/single-instance.test.ts`
Expected: PASS (hook suites green; the unchanged provider + single-instance suites stay green).

- [ ] **Step 8: Typecheck + lint, then commit**

```bash
npx tsc -b
npx eslint src/notepad/bible/useBibleTranslation.ts src/notepad/bible/useBibleVerseLayout.ts src/notepad/bible/prefs/BiblePrefsProvider.tsx src/notepad/bible/useBibleTranslation.test.ts src/notepad/bible/useBibleVerseLayout.test.ts
git add src/notepad/bible/useBibleTranslation.ts src/notepad/bible/useBibleVerseLayout.ts src/notepad/bible/prefs/BiblePrefsProvider.tsx src/notepad/bible/useBibleTranslation.test.ts src/notepad/bible/useBibleVerseLayout.test.ts
git commit -m "fix(bible-prefs): seed-only hydration + local/global writers (kills reload revert)"
```

---

### Task 3: New context interface + `saveGlobalPrefs`

**Files:**
- Modify: `src/notepad/bible/prefs/bible-prefs-context.ts`
- Modify: `src/notepad/bible/prefs/BiblePrefsProvider.tsx`
- Test: `src/notepad/bible/prefs/BiblePrefsProvider.test.tsx` (rewrite to the new API)

**Interfaces:**
- Consumes: the Task 2 hook returns (`setLocal*`, `saveGlobal*`).
- Produces — `BiblePrefsContextValue`:
  - `translation`, `verseLayout`
  - `setLocalTranslation(t)`, `setLocalVerseLayout(l)` — local only, no DB
  - `saveGlobalPrefs({translation, verseLayout}): Promise<{ok:boolean; error?:string}>` — awaited DB (both columns) + localStorage + state
  - `setTranslation`/`setVerseLayout` — `@deprecated` aliases for `setLocal*`, removed in Task 7 once all consumers migrate.

- [ ] **Step 1: Rewrite the provider test — `BiblePrefsProvider.test.tsx`**

Replace the entire file `src/notepad/bible/prefs/BiblePrefsProvider.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { BiblePrefsProvider } from './BiblePrefsProvider';
import { useBiblePrefs } from './bible-prefs-context';

vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' } }),
}));
// supabase null → saveGlobalPrefs takes the signed-out no-op path but still updates state.
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function Probe() {
  const { translation, verseLayout, setLocalTranslation, setLocalVerseLayout, saveGlobalPrefs } = useBiblePrefs();
  return (
    <div>
      <span data-testid="t">{translation}</span>
      <span data-testid="l">{verseLayout}</span>
      <button onClick={() => setLocalTranslation('KJV')}>set-local-kjv</button>
      <button onClick={() => setLocalVerseLayout('spaced')}>set-local-spaced</button>
      <button onClick={() => { void saveGlobalPrefs({ translation: 'WEB', verseLayout: 'lines' }); }}>save-global</button>
    </div>
  );
}

describe('BiblePrefsProvider', () => {
  it('provides defaults and local setters', () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    expect(screen.getByTestId('t').textContent).toBe('BSB');
    expect(screen.getByTestId('l').textContent).toBe('inline');
    fireEvent.click(screen.getByText('set-local-kjv'));
    fireEvent.click(screen.getByText('set-local-spaced'));
    expect(screen.getByTestId('t').textContent).toBe('KJV');
    expect(screen.getByTestId('l').textContent).toBe('spaced');
  });

  it('saveGlobalPrefs updates both values', async () => {
    render(<BiblePrefsProvider><Probe /></BiblePrefsProvider>);
    fireEvent.click(screen.getByText('save-global'));
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('WEB'));
    expect(screen.getByTestId('l').textContent).toBe('lines');
  });

  it('useBiblePrefs throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/BiblePrefsProvider/);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/notepad/bible/prefs/BiblePrefsProvider.test.tsx`
Expected: FAIL — `setLocalTranslation`/`saveGlobalPrefs` not on the context value.

- [ ] **Step 3: Update the context interface**

Replace the entire file `src/notepad/bible/prefs/bible-prefs-context.ts` with:

```ts
import { createContext, useContext } from 'react';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';

export interface BiblePrefsContextValue {
  translation: BibleTranslation;
  verseLayout: VerseLayout;
  /** Pillar / any in-reader control: localStorage only, no DB. */
  setLocalTranslation: (t: BibleTranslation) => void;
  setLocalVerseLayout: (l: VerseLayout) => void;
  /** Profile Settings → Save: awaited DB (both columns) + localStorage + state. */
  saveGlobalPrefs: (
    p: { translation: BibleTranslation; verseLayout: VerseLayout },
  ) => Promise<{ ok: boolean; error?: string }>;
  /** @deprecated transitional alias for setLocalTranslation; removed in the cleanup task. */
  setTranslation: (t: BibleTranslation) => void;
  /** @deprecated transitional alias for setLocalVerseLayout; removed in the cleanup task. */
  setVerseLayout: (l: VerseLayout) => void;
}

export const BiblePrefsContext = createContext<BiblePrefsContextValue | null>(null);

export function useBiblePrefs(): BiblePrefsContextValue {
  const ctx = useContext(BiblePrefsContext);
  if (!ctx) throw new Error('useBiblePrefs must be used within a BiblePrefsProvider');
  return ctx;
}
```

- [ ] **Step 4: Compose `saveGlobalPrefs` in the provider**

Replace the entire file `src/notepad/bible/prefs/BiblePrefsProvider.tsx` with:

```tsx
import { useCallback, useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';
import { useBibleTranslation } from '../useBibleTranslation';
import { useBibleVerseLayout } from '../useBibleVerseLayout';
import { BiblePrefsContext } from './bible-prefs-context';

/**
 * Single source of truth for Bible version + verse layout. Calls each hook ONCE
 * with the signed-in userId. localStorage is the authoritative per-device value;
 * the profile row is the global value — seeded once on a fresh device and written
 * only by Profile Settings → Save.
 */
export function BiblePrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { translation, setLocalTranslation, saveGlobalTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setLocalVerseLayout, saveGlobalVerseLayout } = useBibleVerseLayout({ userId });

  const saveGlobalPrefs = useCallback(
    async (
      p: { translation: BibleTranslation; verseLayout: VerseLayout },
    ): Promise<{ ok: boolean; error?: string }> => {
      const [tRes, lRes] = await Promise.all([
        saveGlobalTranslation(p.translation),
        saveGlobalVerseLayout(p.verseLayout),
      ]);
      if (!tRes.ok) return tRes;
      if (!lRes.ok) return lRes;
      return { ok: true };
    },
    [saveGlobalTranslation, saveGlobalVerseLayout],
  );

  const value = useMemo(
    () => ({
      translation,
      verseLayout,
      setLocalTranslation,
      setLocalVerseLayout,
      saveGlobalPrefs,
      // @deprecated aliases — removed in the cleanup task.
      setTranslation: setLocalTranslation,
      setVerseLayout: setLocalVerseLayout,
    }),
    [translation, verseLayout, setLocalTranslation, setLocalVerseLayout, saveGlobalPrefs],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/notepad/bible/prefs/BiblePrefsProvider.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + lint, then commit**

```bash
npx tsc -b
npx eslint src/notepad/bible/prefs/bible-prefs-context.ts src/notepad/bible/prefs/BiblePrefsProvider.tsx src/notepad/bible/prefs/BiblePrefsProvider.test.tsx
git add src/notepad/bible/prefs/bible-prefs-context.ts src/notepad/bible/prefs/BiblePrefsProvider.tsx src/notepad/bible/prefs/BiblePrefsProvider.test.tsx
git commit -m "feat(bible-prefs): context exposes setLocal*/saveGlobalPrefs"
```

> Note: `tsc -b` stays green here because the deprecated `setTranslation`/`setVerseLayout` remain on the interface, so `BibleReadingSettingsSection`, `BibleStudyPane`, and `StudyReader` (not yet migrated) still compile.

---

### Task 4: Profile Settings — draft form + Save

**Files:**
- Modify: `src/auth/settings/BibleReadingSettingsSection.tsx`
- Test: `src/auth/settings/BibleReadingSettingsSection.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `useBiblePrefs()` → `translation`, `verseLayout`, `saveGlobalPrefs`.
- Produces: a section whose Save button is enabled only when the draft differs from the saved (context) values; Save calls `saveGlobalPrefs(draft)` and toasts success/error.

- [ ] **Step 1: Rewrite the test — `BibleReadingSettingsSection.test.tsx`**

Replace the entire file `src/auth/settings/BibleReadingSettingsSection.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { BibleReadingSettingsSection } from './BibleReadingSettingsSection';
import { BiblePrefsContext } from '@/notepad/bible/prefs/bible-prefs-context';
import type { BibleTranslation } from '@/notepad/bible/translations';
import type { VerseLayout } from '@/notepad/bible/bible-layout-types';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const saveSpy = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// Stateful harness: saveGlobalPrefs updates context like the real provider, so the
// draft re-syncs and Save re-disables after a successful save.
function Harness({ saveResult = { ok: true } as { ok: boolean; error?: string } }) {
  const [translation, setT] = useState<BibleTranslation>('BSB');
  const [verseLayout, setL] = useState<VerseLayout>('inline');
  const saveGlobalPrefs = useCallback(
    async (p: { translation: BibleTranslation; verseLayout: VerseLayout }) => {
      saveSpy(p);
      if (saveResult.ok) { setT(p.translation); setL(p.verseLayout); }
      return saveResult;
    },
    [saveResult],
  );
  const value = {
    translation,
    verseLayout,
    setLocalTranslation: setT,
    setLocalVerseLayout: setL,
    saveGlobalPrefs,
    setTranslation: setT,
    setVerseLayout: setL,
  };
  return (
    <BiblePrefsContext.Provider value={value}>
      <BibleReadingSettingsSection />
    </BiblePrefsContext.Provider>
  );
}

describe('BibleReadingSettingsSection', () => {
  it('keeps Save disabled until the draft differs from the saved value', () => {
    render(<Harness />);
    const save = screen.getByRole('button', { name: /save bible settings/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Bible version'), { target: { value: 'KJV' } });
    expect(save).toBeEnabled();
  });

  it('saves the draft, toasts success, and re-disables Save', async () => {
    render(<Harness saveResult={{ ok: true }} />);
    fireEvent.change(screen.getByLabelText('Bible version'), { target: { value: 'KJV' } });
    fireEvent.click(screen.getByRole('button', { name: /save bible settings/i }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ translation: 'KJV', verseLayout: 'inline' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bible settings saved'));
    expect(screen.getByRole('button', { name: /save bible settings/i })).toBeDisabled();
  });

  it('toasts the error and leaves the form editable when the save fails', async () => {
    render(<Harness saveResult={{ ok: false, error: 'Network down' }} />);
    fireEvent.change(screen.getByLabelText('Bible version'), { target: { value: 'WEB' } });
    fireEvent.click(screen.getByRole('button', { name: /save bible settings/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network down'));
    expect(screen.getByRole('button', { name: /save bible settings/i })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/auth/settings/BibleReadingSettingsSection.test.tsx`
Expected: FAIL — no Save button / section still auto-saves on change.

- [ ] **Step 3: Rewrite `BibleReadingSettingsSection.tsx`**

Replace the entire file `src/auth/settings/BibleReadingSettingsSection.tsx` with:

```tsx
import { useEffect, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { TRANSLATIONS, translationInfo, type BibleTranslation } from '@/notepad/bible/translations';
import { VERSE_LAYOUTS, VERSE_LAYOUT_LABEL, type VerseLayout } from '@/notepad/bible/bible-layout-types';

export function BibleReadingSettingsSection({
  sectionStyle,
  labelStyle,
}: { sectionStyle?: CSSProperties; labelStyle?: CSSProperties } = {}) {
  const { translation, verseLayout, saveGlobalPrefs } = useBiblePrefs();

  // Draft state — edits stay local to the form until Save. Re-seed whenever the
  // saved (global) value changes: the first-load DB seed, or a successful Save.
  const [draftTranslation, setDraftTranslation] = useState<BibleTranslation>(translation);
  const [draftLayout, setDraftLayout] = useState<VerseLayout>(verseLayout);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraftTranslation(translation); }, [translation]);
  useEffect(() => { setDraftLayout(verseLayout); }, [verseLayout]);

  const dirty = draftTranslation !== translation || draftLayout !== verseLayout;

  async function handleSave() {
    setSaving(true);
    const result = await saveGlobalPrefs({ translation: draftTranslation, verseLayout: draftLayout });
    setSaving(false);
    if (result.ok) toast.success('Bible settings saved');
    else toast.error(result.error ?? 'Could not save Bible settings');
  }

  return (
    <div style={sectionStyle}>
      <p style={labelStyle}>BIBLE &amp; READING</p>

      <label
        htmlFor="settings-bible-version"
        className="block text-xs mb-1"
        style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
      >
        Bible version
      </label>
      <select
        id="settings-bible-version"
        aria-label="Bible version"
        value={draftTranslation}
        onChange={(e) => setDraftTranslation(e.target.value as BibleTranslation)}
        className="text-xs rounded px-2 py-1 outline-none"
        style={{ color: 'var(--deep-umber)', background: 'transparent', border: '1px solid var(--pale-stone)' }}
      >
        {TRANSLATIONS.map((t) => (
          <option key={t.id} value={t.id}>{t.fullName} ({t.label})</option>
        ))}
      </select>
      <p className="text-[10px] mt-1" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
        {translationInfo(draftTranslation).attribution}
      </p>

      <p className="block text-xs mt-4 mb-1" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
        Verse layout
      </p>
      <div className="flex gap-2">
        {VERSE_LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={draftLayout === l}
            onClick={() => setDraftLayout(l)}
            className="text-[11px] rounded-full px-3 py-1"
            style={{
              fontFamily: 'Outfit, sans-serif',
              border: '1px solid var(--pale-stone)',
              background: draftLayout === l ? 'var(--deep-umber)' : 'transparent',
              color: draftLayout === l ? '#fff' : 'var(--deep-umber)',
            }}
          >
            {VERSE_LAYOUT_LABEL[l]}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Save Bible settings"
        disabled={!dirty || saving}
        onClick={handleSave}
        className="mt-4 text-xs rounded px-3 py-1 disabled:opacity-40"
        style={{
          fontFamily: 'Outfit, sans-serif',
          border: '1px solid var(--pale-stone)',
          background: 'var(--deep-umber)',
          color: '#fff',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/auth/settings/BibleReadingSettingsSection.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
npx tsc -b
npx eslint src/auth/settings/BibleReadingSettingsSection.tsx src/auth/settings/BibleReadingSettingsSection.test.tsx
git add src/auth/settings/BibleReadingSettingsSection.tsx src/auth/settings/BibleReadingSettingsSection.test.tsx
git commit -m "feat(settings): Bible prefs become a draft form with explicit Save"
```

---

### Task 5: Reader pillar — local nudge toast + Radix tooltip

**Files:**
- Modify: `src/notepad/bible/BibleReader.tsx` (toolbar `<select>` onChange + the (i) icon ~lines 186–199)
- Test: `src/notepad/bible/BibleReader.test.tsx` (add a sonner mock + 2 tests)

**Interfaces:**
- Consumes: existing props `translation`, `onTranslationChange`; helpers `translationInfo` (already imported); `toast` from `sonner`; `Tooltip`/`TooltipTrigger`/`TooltipContent` from `@/components/ui/tooltip` (the `Tooltip` wrapper already includes its own `TooltipProvider`).
- Produces: changing the version fires the device-only toast nudge; the (i) affordance shows the device-only tooltip (with attribution as a secondary line). No behavior change for the layout control.

- [ ] **Step 1: Add the sonner mock + failing tests to `BibleReader.test.tsx`**

In `src/notepad/bible/BibleReader.test.tsx`, add the sonner mock immediately after the existing `vi.mock('./useBiblePassages', ...)` line (so it is hoisted with the others):

```ts
vi.mock('sonner', () => ({ toast: vi.fn() }));
```

Add this import next to the existing `import { BibleReader } from './BibleReader';`:

```ts
import { toast } from 'sonner';
```

Then add these two tests inside the `describe('BibleReader', ...)` block:

```tsx
it('fires a device-only toast nudge when the version is changed in the reader', () => {
  render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'KJV' } });
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('on this device'));
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('KJV'));
});

it('shows a device-only tooltip on the translation info affordance', async () => {
  render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
  fireEvent.focus(screen.getByLabelText('Translation info'));
  expect(await screen.findByText(/applies to this device only/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: FAIL — toast not called on change; tooltip text not found (still a native `title`).

- [ ] **Step 3: Wire the toast + add the tooltip imports**

In `src/notepad/bible/BibleReader.tsx`, add these imports after the existing import block (top of file):

```ts
import { toast } from 'sonner';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
```

Change the translation `<select>` `onChange` (currently `onChange={(e) => onTranslationChange(e.target.value as BibleTranslation)}`) to:

```tsx
onChange={(e) => {
  const next = e.target.value as BibleTranslation;
  onTranslationChange(next);
  toast(`Switched to ${translationInfo(next).label} on this device. To use it everywhere, set it in Profile → Bible & Reading.`);
}}
```

- [ ] **Step 4: Replace the native-title (i) icon with the tooltip**

In `src/notepad/bible/BibleReader.tsx`, replace this block (~lines 197–199):

```tsx
<span title={translationInfo(translation).attribution} aria-label="Translation info">
  <Info className="w-3 h-3" style={{ color: 'var(--silica)' }} />
</span>
```

with:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <span aria-label="Translation info" tabIndex={0} className="inline-flex cursor-help">
      <Info className="w-3 h-3" style={{ color: 'var(--silica)' }} />
    </span>
  </TooltipTrigger>
  <TooltipContent className="max-w-[16rem]">
    <p>Changing the version here applies to this device only. To set it everywhere, update Profile → Bible &amp; Reading.</p>
    <p className="mt-1 opacity-70">{translationInfo(translation).attribution}</p>
  </TooltipContent>
</Tooltip>
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: PASS (existing tests + the 2 new ones).

> If `fireEvent.focus` does not open the tooltip in jsdom, fall back to `await userEvent.hover(trigger)` (`import userEvent from '@testing-library/user-event'`) and, if needed, stub `Element.prototype.hasPointerCapture = () => false` in a `beforeAll`. Focus-open is preferred because it avoids pointer-capture entirely.

- [ ] **Step 6: Typecheck + lint, then commit**

```bash
npx tsc -b
npx eslint src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleReader.test.tsx
git add src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleReader.test.tsx
git commit -m "feat(bible-reader): device-only nudge toast + tooltip on the version pillar"
```

---

### Task 6: Wire the reader surfaces to the local setters

**Files:**
- Modify: `src/notepad/bible/BibleStudyPane.tsx` (destructure ~line 55; JSX ~lines 127/129)
- Modify: `src/notepad/study/panes/StudyReader.tsx` (destructure ~line 12; JSX ~lines 18/20)
- Test: none added. ⚠️ `src/notepad/bible/BibleStudyPane.test.tsx` is a **pre-existing failure** — it renders `<BibleStudyPane>` with no `BiblePrefsProvider`, so `useBiblePrefs()` throws at the destructure line (verified 2026-06-23: 9 failing). Do NOT gate this task on it and do NOT count its failures as new. Fixing it (wrap the render in a real `BiblePrefsProvider`, or `vi.mock` `bible-prefs-context`) is optional cleanup, out of scope here.

**Interfaces:**
- Consumes: `useBiblePrefs()` → `setLocalTranslation`, `setLocalVerseLayout`.
- Produces: both reader surfaces pass the local setters to `BibleReader` so pillar changes are device-only.

- [ ] **Step 1: Update `BibleStudyPane.tsx`**

Change the destructuring (~line 55) from:

```tsx
const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
```

to:

```tsx
const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout } = useBiblePrefs();
```

Change the `<BibleReader>` props (~lines 127/129) from `onTranslationChange={setTranslation}` / `onVerseLayoutChange={setVerseLayout}` to:

```tsx
onTranslationChange={setLocalTranslation}
verseLayout={verseLayout}
onVerseLayoutChange={setLocalVerseLayout}
```

- [ ] **Step 2: Update `StudyReader.tsx`**

Change the destructuring (~line 12) from:

```tsx
const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
```

to:

```tsx
const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout } = useBiblePrefs();
```

Change the `<BibleReader>` props (~lines 18/20) to:

```tsx
onTranslationChange={setLocalTranslation}
verseLayout={verseLayout}
onVerseLayoutChange={setLocalVerseLayout}
```

- [ ] **Step 3: Run the affected suites**

Run: `npx vitest run src/notepad/bible/prefs/single-instance.test.ts`
Expected: PASS — the grep guard stays green (hook symbol names unchanged).

Do NOT run `BibleStudyPane.test.tsx` as a gate: it is a pre-existing failure (no provider; see Files above). Confirm Task 6 added no NEW breakage with `npx tsc -b` (Step 4) instead — that catches the destructure/prop rename across both files.

- [ ] **Step 4: Typecheck + lint, then commit**

```bash
npx tsc -b
npx eslint src/notepad/bible/BibleStudyPane.tsx src/notepad/study/panes/StudyReader.tsx
git add src/notepad/bible/BibleStudyPane.tsx src/notepad/study/panes/StudyReader.tsx
git commit -m "refactor(bible): pillar surfaces wire to setLocal* (device-only)"
```

---

### Task 7: Remove the deprecated aliases (cleanup)

**Files:**
- Modify: `src/notepad/bible/prefs/bible-prefs-context.ts` (drop `setTranslation`/`setVerseLayout`)
- Modify: `src/notepad/bible/prefs/BiblePrefsProvider.tsx` (drop the alias entries from the value)
- Modify: `src/notepad/study/panes/LamplightStudyPanel.test.tsx` (update the `useBiblePrefs` mock shape)

**Interfaces:**
- Produces: the final `BiblePrefsContextValue` exactly as the spec defines — no deprecated members.

- [ ] **Step 1: Update the Lamplight test mock**

In `src/notepad/study/panes/LamplightStudyPanel.test.tsx`, replace the `useBiblePrefs` mock object:

```ts
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({
  useBiblePrefs: () => ({ translation: 'BSB', setTranslation: vi.fn(), verseLayout: 'inline', setVerseLayout: vi.fn() }),
}));
```

with:

```ts
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({
  useBiblePrefs: () => ({
    translation: 'BSB',
    verseLayout: 'inline',
    setLocalTranslation: vi.fn(),
    setLocalVerseLayout: vi.fn(),
    saveGlobalPrefs: vi.fn(async () => ({ ok: true })),
  }),
}));
```

- [ ] **Step 2: Drop the deprecated members from the interface**

In `src/notepad/bible/prefs/bible-prefs-context.ts`, remove the two `@deprecated` lines so the interface is:

```ts
export interface BiblePrefsContextValue {
  translation: BibleTranslation;
  verseLayout: VerseLayout;
  setLocalTranslation: (t: BibleTranslation) => void;
  setLocalVerseLayout: (l: VerseLayout) => void;
  saveGlobalPrefs: (
    p: { translation: BibleTranslation; verseLayout: VerseLayout },
  ) => Promise<{ ok: boolean; error?: string }>;
}
```

- [ ] **Step 3: Drop the alias entries from the provider value**

In `src/notepad/bible/prefs/BiblePrefsProvider.tsx`, remove the two `// @deprecated aliases` lines from the `value` object so it contains only `translation, verseLayout, setLocalTranslation, setLocalVerseLayout, saveGlobalPrefs`.

- [ ] **Step 4: Verify no stragglers reference the old setters**

Run: `grep -rn "setTranslation\|setVerseLayout" src/ || echo "clean"`
Expected: no production/test references remain (only `setLocalTranslation`/`setLocalVerseLayout` and the hook-internal `saveGlobalTranslation`/`saveGlobalVerseLayout` should appear). If any file still references the bare `setTranslation`/`setVerseLayout`, fix it before continuing.

- [ ] **Step 5: Run the full prefs-affected suite + typecheck + lint**

```bash
npx vitest run src/notepad/bible src/auth/settings src/notepad/study/panes/LamplightStudyPanel.test.tsx src/notepad/session/session-storage.test.ts
npx tsc -b
npx eslint src/notepad/bible/prefs/bible-prefs-context.ts src/notepad/bible/prefs/BiblePrefsProvider.tsx src/notepad/study/panes/LamplightStudyPanel.test.tsx
```

Expected: all green; `tsc -b` exit 0; no new eslint errors.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/bible/prefs/bible-prefs-context.ts src/notepad/bible/prefs/BiblePrefsProvider.tsx src/notepad/study/panes/LamplightStudyPanel.test.tsx
git commit -m "refactor(bible-prefs): drop transitional setTranslation/setVerseLayout aliases"
```

---

## Final Verification

- [ ] `npx tsc -b` exits 0.
- [ ] Affected suites green **except known pre-existing reds**: `npx vitest run src/notepad/bible/useBibleTranslation.test.ts src/notepad/bible/useBibleVerseLayout.test.ts src/notepad/bible/prefs src/notepad/bible/BibleReader.test.tsx src/auth/settings/BibleReadingSettingsSection.test.tsx src/notepad/session/session-storage.test.ts src/notepad/study/panes/LamplightStudyPanel.test.tsx`. Do NOT include `BibleStudyPane.test.tsx` (pre-existing failure: no `BiblePrefsProvider`); compare against the baseline reds noted in project memory rather than gating on a fully-green repo.
- [ ] Manual smoke (signed in): change the version in the reader pillar → toast appears; reload → the pillar choice persists (bug fixed). Open Profile → Bible & Reading → change version + layout → Save → success toast; reload a second device that already had a local override → it keeps its local pick (accepted sync trade-off).
- [ ] `docs/superpowers/specs/2026-06-23-bible-prefs-global-local-split-design.md` requirements all map to a task (see coverage below).

## Spec Coverage Map

- Persistence model (local authoritative, DB seed-only, reload local-wins) → Task 2 (hooks) + Task 1 (`hasStored`).
- "Local wins; Save takes over" → Task 2 (seed guard) + Task 3/4 (`saveGlobalPrefs`).
- Both version + layout, saved together → Task 3 (`saveGlobalPrefs` Promise.all) + Task 4 (draft form).
- §1 `hasStored` → Task 1.
- §2 two write paths + seed-only hydration → Task 2.
- §3 new context interface → Task 3 (+ Task 7 final shape).
- §4 Settings draft + Save → Task 4.
- §5 pillar local set + toast nudge + tooltip → Task 5 (toast/tooltip) + Task 6 (local wiring).
- §6 wiring (`onTranslationChange`/`onVerseLayoutChange` → `setLocal*`) → Task 6.
- §7 touched files & test updates → Tasks 2–7 (each test rewritten alongside its unit; single-instance unchanged; Lamplight mock in Task 7).
- Out of scope (cross-device live sync, fetch/render changes, migration) → not implemented (correct).
