# Bible Verse-Layout Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header control to the Bible reader that cycles verse text through three layout modes (inline prose / one-per-line / one-per-line-with-gap), persisted per-device and cross-device.

**Architecture:** A new `bible-layout-types` module + a `useBibleVerseLayout` hook clone the existing translation/theme preference pattern (localStorage default + `profiles` column sync). `BibleReader` receives the current layout and a change callback as props (presentational, like `translation`); the two host components own the hook. The verse render branches on the layout while keeping each verse's `id`, click handler, and highlight styling identical across modes.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + @testing-library/react (jsdom), lucide-react 0.562, Supabase (`profiles` table), Tailwind.

## Global Constraints

- Build/typecheck command is `tsc -b` (NOT bare `tsc --noEmit` — the root tsconfig has `files: []` so `--noEmit` checks nothing).
- Test runner: `npm test` → `vitest run`. Single file: `npx vitest run <path>`.
- The repo ships a known red baseline (~114 lint errors, 4 tsc errors in `force-sphere.test.ts`, 2 failing test files: `Editor.toolbar-placement`, `garden-scene`). Do NOT gate on a green repo. The bar is: **this change adds ZERO new lint/tsc/test failures.**
- Storage keys are namespaced `psalms.*` string constants in `src/notepad/session/session-storage.ts`.
- Preference enum values used everywhere: `'inline' | 'lines' | 'spaced'`, default `'inline'`. The `profiles` column is `bible_verse_layout`.
- `BibleReader`'s new props are OPTIONAL (default layout `'inline'`, no-op callback) so existing `BibleReader.test.tsx` cases that omit them keep compiling and passing.
- Migrations apply via `supabase db push` (a rollout step run by the user with Supabase access — NOT part of any automated test step).
- Commit after each task.

---

### Task 1: `bible-layout-types` module

**Files:**
- Create: `src/notepad/bible/bible-layout-types.ts`
- Test: `src/notepad/bible/bible-layout-types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type VerseLayout = 'inline' | 'lines' | 'spaced'`
  - `const VERSE_LAYOUTS: readonly VerseLayout[]` (cycle order `['inline','lines','spaced']`)
  - `const DEFAULT_VERSE_LAYOUT: VerseLayout` (`'inline'`)
  - `function isVerseLayout(value: unknown): value is VerseLayout`
  - `function nextVerseLayout(current: VerseLayout): VerseLayout`
  - `const VERSE_LAYOUT_LABEL: Record<VerseLayout, string>`

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/bible-layout-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  VERSE_LAYOUTS,
  DEFAULT_VERSE_LAYOUT,
  isVerseLayout,
  nextVerseLayout,
  VERSE_LAYOUT_LABEL,
} from './bible-layout-types';

describe('bible-layout-types', () => {
  it('exposes the three layouts in cycle order', () => {
    expect(VERSE_LAYOUTS).toEqual(['inline', 'lines', 'spaced']);
  });

  it('defaults to inline', () => {
    expect(DEFAULT_VERSE_LAYOUT).toBe('inline');
  });

  it('guards unknown values', () => {
    expect(isVerseLayout('lines')).toBe(true);
    expect(isVerseLayout('paragraph')).toBe(false);
    expect(isVerseLayout(null)).toBe(false);
    expect(isVerseLayout(undefined)).toBe(false);
  });

  it('cycles inline -> lines -> spaced -> inline', () => {
    expect(nextVerseLayout('inline')).toBe('lines');
    expect(nextVerseLayout('lines')).toBe('spaced');
    expect(nextVerseLayout('spaced')).toBe('inline');
  });

  it('has a human label for every layout', () => {
    expect(VERSE_LAYOUT_LABEL.inline).toBe('Inline');
    expect(VERSE_LAYOUT_LABEL.lines).toBe('Lines');
    expect(VERSE_LAYOUT_LABEL.spaced).toBe('Spaced');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/bible-layout-types.test.ts`
Expected: FAIL — `Failed to resolve import './bible-layout-types'`.

- [ ] **Step 3: Write the module**

Create `src/notepad/bible/bible-layout-types.ts`:

```ts
// src/notepad/bible/bible-layout-types.ts
// The verse layout for the Bible reader. Mirrors the theme/translation
// preference shape (a small types module paired with a persistence hook).
export type VerseLayout = 'inline' | 'lines' | 'spaced';

export const VERSE_LAYOUTS: readonly VerseLayout[] = ['inline', 'lines', 'spaced'] as const;
export const DEFAULT_VERSE_LAYOUT: VerseLayout = 'inline';

export function isVerseLayout(value: unknown): value is VerseLayout {
  return value === 'inline' || value === 'lines' || value === 'spaced';
}

/** The next mode in the cycle: inline -> lines -> spaced -> inline. */
export function nextVerseLayout(current: VerseLayout): VerseLayout {
  const i = VERSE_LAYOUTS.indexOf(current);
  return VERSE_LAYOUTS[(i + 1) % VERSE_LAYOUTS.length];
}

/** Human label for each mode (used in the control's title/aria-label). */
export const VERSE_LAYOUT_LABEL: Record<VerseLayout, string> = {
  inline: 'Inline',
  lines: 'Lines',
  spaced: 'Spaced',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/bible-layout-types.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/bible-layout-types.ts src/notepad/bible/bible-layout-types.test.ts
git commit -m "feat(notepad): verse-layout types + cycle helper"
```

---

### Task 2: `useBibleVerseLayout` hook (+ storage key)

**Files:**
- Modify: `src/notepad/session/session-storage.ts` (add + export `KEY_BIBLE_VERSE_LAYOUT`)
- Create: `src/notepad/bible/useBibleVerseLayout.ts`
- Test: `src/notepad/bible/useBibleVerseLayout.test.ts`

**Interfaces:**
- Consumes: `VerseLayout`, `VERSE_LAYOUTS`, `DEFAULT_VERSE_LAYOUT`, `isVerseLayout` (Task 1); `loadEnum`, `saveEnum` (existing); `supabase` (existing).
- Produces:
  - `interface UseBibleVerseLayoutResult { verseLayout: VerseLayout; setVerseLayout: (layout: VerseLayout) => void; }`
  - `function useBibleVerseLayout({ userId }?: { userId?: string | null }): UseBibleVerseLayoutResult`
  - storage key constant `KEY_BIBLE_VERSE_LAYOUT = 'psalms.bible.verseLayout'`

- [ ] **Step 1: Add the storage key**

In `src/notepad/session/session-storage.ts`, add the constant next to `KEY_BIBLE_TRANSLATION` (line 11):

```ts
const KEY_BIBLE_TRANSLATION = 'psalms.bible.translation';
const KEY_BIBLE_VERSE_LAYOUT = 'psalms.bible.verseLayout';
```

And add it to the export block (lines 14–21):

```ts
export {
  KEY_LAST_NOTE,
  KEY_MOBILE_TAB,
  KEY_EDITOR_TAB,
  KEY_STUDY_TAB,
  KEY_BIBLE_TRANSLATION,
  KEY_BIBLE_VERSE_LAYOUT,
  KEY_THEME,
};
```

- [ ] **Step 2: Write the failing test**

Create `src/notepad/bible/useBibleVerseLayout.test.ts` (mirrors `useBibleTranslation.test.ts`):

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/useBibleVerseLayout.test.ts`
Expected: FAIL — `Failed to resolve import './useBibleVerseLayout'`.

- [ ] **Step 4: Write the hook**

Create `src/notepad/bible/useBibleVerseLayout.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_VERSE_LAYOUT } from '../session/session-storage';
import { type VerseLayout, DEFAULT_VERSE_LAYOUT, VERSE_LAYOUTS, isVerseLayout } from './bible-layout-types';
import { supabase } from '@/lib/supabase';

export interface UseBibleVerseLayoutResult {
  verseLayout: VerseLayout;
  setVerseLayout: (layout: VerseLayout) => void;
}

export function useBibleVerseLayout(
  { userId = null }: { userId?: string | null } = {},
): UseBibleVerseLayoutResult {
  const [verseLayout, setState] = useState<VerseLayout>(() =>
    loadEnum<VerseLayout>(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS, DEFAULT_VERSE_LAYOUT),
  );

  // Hydrate from the profile when signed in (localStorage is the instant default).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
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

  const setVerseLayout = useCallback((layout: VerseLayout) => {
    setState(layout);
    saveEnum(KEY_BIBLE_VERSE_LAYOUT, layout);
    if (userId && supabase) {
      void supabase.from('profiles').update({ bible_verse_layout: layout }).eq('id', userId);
    }
  }, [userId]);

  return { verseLayout, setVerseLayout };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/useBibleVerseLayout.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: No NEW errors (the only pre-existing errors are in `force-sphere.test.ts` per the baseline).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/session/session-storage.ts src/notepad/bible/useBibleVerseLayout.ts src/notepad/bible/useBibleVerseLayout.test.ts
git commit -m "feat(notepad): useBibleVerseLayout hook with localStorage + profile sync"
```

---

### Task 3: Migration — `profiles.bible_verse_layout`

**Files:**
- Create: `supabase/migrations/040_profiles_bible_verse_layout.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: a nullable-default `text` column `profiles.bible_verse_layout` with a CHECK constraint matching the three enum values. No automated test (SQL migration); the deliverable is the file. Applied at rollout via `supabase db push`.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/040_profiles_bible_verse_layout.sql` (modeled on `039_profiles_theme.sql`):

```sql
-- 040_profiles_bible_verse_layout.sql
-- Per-user Bible verse layout (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
-- Modeled on theme (039): a plain owner-writable column guarded only by RLS,
-- NOT a privileged column — the 021 protect_privileged_profile_columns trigger
-- guards only is_admin / note_count / highest_note_count, so a normal owner
-- UPDATE of bible_verse_layout passes.
alter table public.profiles
  add column bible_verse_layout text not null default 'inline';

alter table public.profiles
  add constraint profiles_bible_verse_layout_check
  check (bible_verse_layout in ('inline', 'lines', 'spaced'));
```

- [ ] **Step 2: Verify it is the next number and well-formed**

Run: `ls supabase/migrations/ | sort | tail -3`
Expected: `040_profiles_bible_verse_layout.sql` is the highest number (prior top was `039_profiles_theme.sql`). Confirm the file contains both `add column` and the `check` constraint.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/040_profiles_bible_verse_layout.sql
git commit -m "feat(db): add profiles.bible_verse_layout column (migration 040)"
```

> **Rollout note (NOT an automated step):** the user applies this with `supabase db push` before signed-in cross-device sync works. Until applied, the hook degrades gracefully — the `select` returns no such column / the `update` is a fire-and-forget `void`, so the reader still works from localStorage.

---

### Task 4: `BibleReader` — props, cycle control, render branch

**Files:**
- Modify: `src/notepad/bible/BibleReader.tsx`
- Test: `src/notepad/bible/BibleReader.test.tsx` (append cases)

**Interfaces:**
- Consumes: `VerseLayout`, `nextVerseLayout`, `VERSE_LAYOUT_LABEL` (Task 1).
- Produces: two new OPTIONAL props on `BibleReaderProps`:
  - `verseLayout?: VerseLayout` (default `'inline'`)
  - `onVerseLayoutChange?: (layout: VerseLayout) => void`

- [ ] **Step 1: Write the failing tests**

Append to `src/notepad/bible/BibleReader.test.tsx` (after the existing `describe('BibleReader translation selector', ...)` block):

```tsx
describe('BibleReader verse layout control', () => {
  it('renders the layout control labelled with the current mode', () => {
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="inline" onVerseLayoutChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /change verse layout \(currently inline\)/i })).toBeInTheDocument();
  });

  it('cycles inline -> lines on click', () => {
    const onVerseLayoutChange = vi.fn();
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="inline" onVerseLayoutChange={onVerseLayoutChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change verse layout/i }));
    expect(onVerseLayoutChange).toHaveBeenCalledWith('lines');
  });

  it('cycles spaced -> inline on click', () => {
    const onVerseLayoutChange = vi.fn();
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="spaced" onVerseLayoutChange={onVerseLayoutChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change verse layout/i }));
    expect(onVerseLayoutChange).toHaveBeenCalledWith('inline');
  });

  it('keeps verse anchors, text, and tap selection in spaced mode', () => {
    const onSelectVerse = vi.fn();
    const { container } = render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="spaced" onVerseLayoutChange={() => {}}
        onSelectVerse={onSelectVerse}
      />,
    );
    const verse1 = container.querySelector('#bible-verse-1') as HTMLElement;
    expect(verse1).not.toBeNull();
    expect(verse1.textContent).toMatch(/In the beginning was the Word/);
    fireEvent.click(screen.getByText(/In the beginning was the Word/));
    expect(onSelectVerse).toHaveBeenLastCalledWith({ book: 'jhn', chapter: 1, verse: 1 });
  });

  it('defaults to inline (joined prose) when no layout prop is given', () => {
    const { container } = render(
      <BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />,
    );
    // Inline mode renders the verses inside a <p>; block modes use a <div>.
    const verse1 = container.querySelector('#bible-verse-1') as HTMLElement;
    expect(verse1.closest('p')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: FAIL — the new cases can't find the `change verse layout` button (control not implemented yet). The pre-existing cases still pass.

- [ ] **Step 3: Update the lucide import**

In `src/notepad/bible/BibleReader.tsx` line 3, extend the icon import:

```tsx
import { ChevronLeft, ChevronRight, CornerDownLeft, Search, Info, WrapText, List, Rows3 } from 'lucide-react';
```

> If `tsc -b` later reports any of `WrapText`/`List`/`Rows3` is not exported, substitute a present equivalent (`AlignJustify`, `AlignLeft`, `Rows2`) — the icon identity is cosmetic. (Verified present in lucide-react 0.562.)

- [ ] **Step 4: Add the `Fragment` import**

In `src/notepad/bible/BibleReader.tsx` line 2, add `Fragment`:

```tsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 5: Import the layout types**

Add below the existing `./translations` import (line 7):

```tsx
import { type VerseLayout, nextVerseLayout, VERSE_LAYOUT_LABEL } from './bible-layout-types';
```

- [ ] **Step 6: Add the two props to the interface**

In `BibleReaderProps` (after `verseNumberColor?: string;`, line 42), add:

```tsx
  /** Current verse layout. Defaults to 'inline' (continuous prose). */
  verseLayout?: VerseLayout;
  /** Called when the user cycles the layout control. */
  onVerseLayoutChange?: (layout: VerseLayout) => void;
```

- [ ] **Step 7: Destructure the new props with a default**

In the component parameter list (after `verseNumberColor = 'var(--lamplight-accent)',`, line 55), add:

```tsx
  verseLayout = 'inline',
  onVerseLayoutChange,
```

- [ ] **Step 8: Compute the current icon before `return (`**

Just above `const label = ...` (line 154), add:

```tsx
  const LayoutIcon = verseLayout === 'inline' ? WrapText : verseLayout === 'lines' ? List : Rows3;
```

- [ ] **Step 9: Add the cycle button to the header cluster**

Inside the `<div className="flex items-center gap-1">` (line 169), insert this button as the FIRST child, immediately before the translation `<select>`:

```tsx
          <button
            aria-label={`Change verse layout (currently ${VERSE_LAYOUT_LABEL[verseLayout].toLowerCase()})`}
            title={`Verse layout: ${VERSE_LAYOUT_LABEL[verseLayout]} — click to change`}
            onClick={() => onVerseLayoutChange?.(nextVerseLayout(verseLayout))}
            className="p-1.5 rounded hover:bg-black/5 transition-colors"
          >
            <LayoutIcon className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
          </button>
```

- [ ] **Step 10: Replace the verse render block**

Replace the entire verses block (lines 321–351, the `{!loading && !error && verses.length > 0 && ( <p> ... </p> )}` expression) with this branch-aware version:

```tsx
        {!loading && !error && verses.length > 0 && (() => {
          const blockMode = verseLayout !== 'inline';
          const Container = blockMode ? 'div' : 'p';
          return (
            <Container className="text-[13px] leading-[1.9]" style={{ color: 'var(--deep-umber)' }}>
              {verses.map((v) => {
                const swatchId = highlightSwatchByVerse[v.verse];
                const asset = swatchId ? getStyleAsset(swatchId) : undefined;
                const highlightStyle = asset ? highlightBackgroundStyle(asset.displayUrl) : '';
                const verseSpan = (
                  <span
                    id={`bible-verse-${v.verse}`}
                    onClick={() => selectVerse(v.verse)}
                    className={asset ? 'cursor-pointer bible-verse-highlight' : 'cursor-pointer'}
                    // A persisted swatch wins; otherwise show the transient tap tint.
                    style={
                      asset
                        ? cssTextToStyle(highlightStyle)
                        : {
                            background:
                              selectedVerse === v.verse ? 'rgba(196,154,120,0.22)' : 'transparent',
                            borderRadius: 3,
                            padding: '0 2px',
                          }
                    }
                  >
                    <sup className="text-[9px] font-bold mr-1" style={{ color: verseNumberColor }}>{v.verse}</sup>
                    {v.text}{blockMode ? '' : ' '}
                  </span>
                );
                return blockMode ? (
                  <div key={v.verse} style={{ marginBottom: verseLayout === 'spaced' ? '0.7em' : 0 }}>
                    {verseSpan}
                  </div>
                ) : (
                  <Fragment key={v.verse}>{verseSpan}</Fragment>
                );
              })}
            </Container>
          );
        })()}
```

> Rationale: the verse `<span>` (with its `id`, `onClick`, and highlight `style`) is byte-for-byte the original — only its key moved to the wrapper and the trailing space is dropped in block mode. So highlighting, verse-tap selection, and the `getElementById('bible-verse-N')` scroll/anchor logic are unchanged. Block modes wrap each verse in a `<div>` (one verse per line); `spaced` adds `marginBottom`. Inline keeps the original `<p>` + inline spans + joining space.

- [ ] **Step 11: Run the BibleReader tests**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: PASS — all pre-existing cases plus the 5 new layout cases.

- [ ] **Step 12: Typecheck**

Run: `npx tsc -b`
Expected: No NEW errors versus the baseline.

- [ ] **Step 13: Commit**

```bash
git add src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleReader.test.tsx
git commit -m "feat(notepad): verse-layout cycle control + 3-mode render in BibleReader"
```

---

### Task 5: Wire the hook into both host components

**Files:**
- Modify: `src/notepad/bible/BibleStudyPane.tsx`
- Modify: `src/notepad/study/panes/StudyReader.tsx`
- Test: `src/notepad/bible/BibleStudyPane.test.tsx` (append one case)

**Interfaces:**
- Consumes: `useBibleVerseLayout` (Task 2); `BibleReader`'s `verseLayout`/`onVerseLayoutChange` props (Task 4).
- Produces: both reader surfaces now own and persist the layout preference.

- [ ] **Step 1: Write the failing test**

Append to `src/notepad/bible/BibleStudyPane.test.tsx` a case asserting the control is wired through. First open the file and confirm how it mocks/render-mounts `BibleStudyPane`; match that harness. The case:

```tsx
it('renders the verse-layout control wired through to the reader', () => {
  // (use the same render/mount + mocks the existing BibleStudyPane tests use)
  renderBibleStudyPane(); // <- replace with this file's existing mount helper/inline render
  expect(
    screen.getByRole('button', { name: /change verse layout/i }),
  ).toBeInTheDocument();
});
```

> If `BibleStudyPane.test.tsx` mounts the component inline (no helper), copy that exact inline `render(<BibleStudyPane ... />)` setup (including any provider/mocks) into this case rather than inventing a helper.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/notepad/bible/BibleStudyPane.test.tsx`
Expected: FAIL — the layout button isn't rendered because the pane doesn't yet pass the props.

- [ ] **Step 3: Wire `BibleStudyPane`**

In `src/notepad/bible/BibleStudyPane.tsx`:

Add the import near the other bible-hook imports (after line 13, `import { useBibleTranslation } from './useBibleTranslation';`):

```tsx
import { useBibleVerseLayout } from './useBibleVerseLayout';
```

Add the hook call directly after the `useBibleTranslation` call (line 55):

```tsx
  const { translation, setTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setVerseLayout } = useBibleVerseLayout({ userId });
```

Pass the props into `<BibleReader>` (within the props block at lines 123–132), e.g. after `onTranslationChange={setTranslation}`:

```tsx
            translation={translation}
            onTranslationChange={setTranslation}
            verseLayout={verseLayout}
            onVerseLayoutChange={setVerseLayout}
```

- [ ] **Step 4: Wire `StudyReader`**

Replace the body of `src/notepad/study/panes/StudyReader.tsx` so it owns the layout hook (no `userId` — matching its existing `useBibleTranslation()` call):

```tsx
// src/notepad/study/panes/StudyReader.tsx
import { BibleReader } from '@/notepad/bible/BibleReader';
import { useBibleTranslation } from '@/notepad/bible/useBibleTranslation';
import { useBibleVerseLayout } from '@/notepad/bible/useBibleVerseLayout';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
}

export function StudyReader({ book, chapter, onPassageChange }: StudyReaderProps) {
  const { translation, setTranslation } = useBibleTranslation();
  const { verseLayout, setVerseLayout } = useBibleVerseLayout();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setTranslation}
      verseLayout={verseLayout}
      onVerseLayoutChange={setVerseLayout}
      onPassageChange={onPassageChange}
      verseNumberColor="var(--study-verse-num)"
    />
  );
}
```

- [ ] **Step 5: Run the host test**

Run: `npx vitest run src/notepad/bible/BibleStudyPane.test.tsx`
Expected: PASS — existing cases plus the new wired-control case.

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: No NEW errors versus the baseline.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/bible/BibleStudyPane.tsx src/notepad/study/panes/StudyReader.tsx src/notepad/bible/BibleStudyPane.test.tsx
git commit -m "feat(notepad): thread verse-layout preference through both reader surfaces"
```

---

### Task 6: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full bible + theme test dirs**

Run: `npx vitest run src/notepad/bible src/notepad/session`
Expected: All green (these dirs hold the touched code). No new failures.

- [ ] **Step 2: Typecheck the whole build**

Run: `npx tsc -b`
Expected: Only the pre-existing baseline error(s) in `force-sphere.test.ts`; nothing new in `src/notepad/**`.

- [ ] **Step 3: Lint only the touched files**

Run: `npx eslint src/notepad/bible/bible-layout-types.ts src/notepad/bible/useBibleVerseLayout.ts src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleStudyPane.tsx src/notepad/study/panes/StudyReader.tsx src/notepad/session/session-storage.ts`
Expected: No errors introduced by these files (repo-wide lint baseline is red and out of scope).

- [ ] **Step 4: Manual smoke checklist (record results)**

Run the app (`npm run dev`) and verify, in BOTH the Study/Bible pane and the Study-mode reader:
  - The layout button appears in the reader header next to the translation selector.
  - Clicking cycles inline → lines → spaced → inline; the icon changes each click.
  - `inline` reads as continuous prose; `lines` puts each verse on its own line tightly; `spaced` adds a gap between verses.
  - Tapping a verse still selects/opens the highlight picker; an existing highlight still tints in all three modes.
  - A typed verse-reference search (e.g. "John 3:16") still scrolls the verse into view.
  - The choice survives a page refresh (localStorage). Signed in (after `supabase db push`), it persists across devices.

- [ ] **Step 5: Final commit (if the manual pass needed any tweak)**

```bash
git add -A
git commit -m "chore(notepad): verse-layout toggle verification fixes"
```

(Skip if Step 4 needed no changes.)

---

## Self-Review

**Spec coverage:**
- Three modes (inline/lines/spaced) → Task 1 (types) + Task 4 (render). ✓
- Cycle control in header → Task 4 (Steps 8–9). ✓
- Default unchanged → Task 4 (optional prop default `'inline'`; dedicated test Step 1 case 5). ✓
- localStorage default + profile hydrate/dual-write → Task 2 (hook + tests). ✓
- Storage key → Task 2 Step 1. ✓
- Migration 040 → Task 3. ✓
- No regression to highlight/selection/anchors → Task 4 Step 10 (span untouched) + test case 4. ✓
- Both surfaces wired → Task 5. ✓
- Testing + `tsc -b` build check + red-baseline rule → Tasks 1–6 + Global Constraints. ✓

**Placeholder scan:** The only intentional "fill from the file" instruction is Task 5 Step 1 (match `BibleStudyPane.test.tsx`'s existing mount harness) — necessary because that harness wasn't read; the surrounding steps give the exact assertion. No `TBD`/`TODO`/"add error handling" placeholders. ✓

**Type consistency:** `verseLayout` / `setVerseLayout` / `VerseLayout` / `bible_verse_layout` (DB) / `KEY_BIBLE_VERSE_LAYOUT` / `nextVerseLayout` / `VERSE_LAYOUT_LABEL` used identically across Tasks 1, 2, 4, 5. `BibleReader` props `verseLayout?` + `onVerseLayoutChange?` match between Task 4 (definition) and Task 5 (consumption). ✓
