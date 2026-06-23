# Mobile Journal/Study Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-only Study experience (Reader / Study / Context tabs + a Journal⇄Study top toggle) so phone users can reach Study mode, which currently only renders the crushed desktop 3-column layout.

**Architecture:** Mirror the existing `NotepadWorkspace` mobile/desktop split. `StudyWorkspace` becomes a thin `useIsMobile()` dispatcher; the current body moves to `DesktopStudyWorkspace`; a new `MobileStudyWorkspace` renders a full-screen column with a top `StudyModeToggle`, a 3-slot `StudyTabBar`, and—when a note is active—a full-focus `MobileStudyEditorView`. All reader/notes/chat/apparatus internals are reused from the existing desktop panes.

**Tech Stack:** React 18 + TypeScript, react-router-dom v6, Vite, Vitest + @testing-library/react (jsdom), Tailwind + CSS custom properties.

## Global Constraints

- Mobile breakpoint is **768px** via `useIsMobile()` from `@/hooks/use-mobile`. Desktop (≥768px) behavior must be **unchanged**.
- Reuse existing panes verbatim — `StudyReader`, `StudySidePanel`, `ApparatusRail`, `StudyModeToggle`, `NotepadEditor`, `useEnsureStudyFolder`, `useKeyboardInset`. Do not fork them.
- The notes data layer (`NotepadProvider`) is hoisted by the layout route and must not be remounted; read it via `useNoteCollection()` / `useAuthSession()`.
- Session persistence is best-effort via `loadEnum`/`saveEnum` from `@/notepad/session/session-storage`.
- Default Study landing tab = `reader`. A note being active (`activeNote`) ⇒ full-focus editor, top toggle and tab bar hidden.
- Do not add new lint/tsc/test failures beyond the documented pre-existing red baseline (build-check with `tsc -b`, not bare `tsc --noEmit`).

---

### Task 1: Study mobile tab types + `StudyTabBar`

**Files:**
- Create: `src/notepad/study/mobile/types.ts`
- Create: `src/notepad/study/mobile/StudyTabBar.tsx`
- Test: `src/notepad/study/mobile/StudyTabBar.test.tsx`

**Interfaces:**
- Produces: `type MobileStudyTab = 'reader' | 'study' | 'context'`
- Produces: `StudyTabBar({ active: MobileStudyTab, onSelect: (tab: MobileStudyTab) => void })`

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/study/mobile/StudyTabBar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StudyTabBar } from './StudyTabBar';

afterEach(cleanup);

describe('StudyTabBar', () => {
  it('renders Reader, Study, and Context tabs and marks the active one', () => {
    render(<StudyTabBar active="reader" onSelect={() => {}} />);
    expect(screen.getByRole('tab', { name: /reader/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /study/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /context/i })).toBeInTheDocument();
  });

  it('calls onSelect with the tapped tab id', () => {
    const onSelect = vi.fn();
    render(<StudyTabBar active="reader" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    expect(onSelect).toHaveBeenCalledWith('context');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/mobile/StudyTabBar.test.tsx`
Expected: FAIL — cannot resolve `./StudyTabBar`.

- [ ] **Step 3: Create the type module**

```tsx
// src/notepad/study/mobile/types.ts
export type MobileStudyTab = 'reader' | 'study' | 'context';
```

- [ ] **Step 4: Create `StudyTabBar` (mirrors `MobileTabBar` styling)**

```tsx
// src/notepad/study/mobile/StudyTabBar.tsx
import { BookOpen, NotebookPen, ScrollText } from 'lucide-react';
import type { MobileStudyTab } from './types';

interface TabDef {
  id: MobileStudyTab;
  label: string;
  Icon: typeof BookOpen;
}

const TABS: TabDef[] = [
  { id: 'reader', label: 'Reader', Icon: BookOpen },
  { id: 'study', label: 'Study', Icon: NotebookPen },
  { id: 'context', label: 'Context', Icon: ScrollText },
];

export interface StudyTabBarProps {
  active: MobileStudyTab;
  onSelect: (tab: MobileStudyTab) => void;
}

export function StudyTabBar({ active, onSelect }: StudyTabBarProps) {
  return (
    <div
      role="tablist"
      className="shrink-0 flex"
      style={{
        borderTop: '1px solid var(--pale-stone)',
        background: 'var(--notepad-bar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(id)}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{
              minHeight: 56,
              color: selected ? 'var(--deep-umber)' : 'var(--silica)',
              borderTop: selected ? '2px solid var(--deep-umber)' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            <Icon size={18} />
            <span className="text-[10px] tracking-wide">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/mobile/StudyTabBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/study/mobile/types.ts src/notepad/study/mobile/StudyTabBar.tsx src/notepad/study/mobile/StudyTabBar.test.tsx
git commit -m "feat(study): mobile StudyTabBar + tab types"
```

---

### Task 2: `MobileStudyEditorView` (full-focus note editor)

**Files:**
- Create: `src/notepad/study/mobile/MobileStudyEditorView.tsx`
- Test: `src/notepad/study/mobile/MobileStudyEditorView.test.tsx`

**Interfaces:**
- Consumes: `NotepadEditor` (`@/notepad/components/Editor`), `useKeyboardInset` (`@/components/sections/notepad/mobile/useKeyboardInset`), `ThemeToggle` (`@/notepad/theme/ThemeToggle`).
- Produces: `MobileStudyEditorView({ onBack: () => void })` — renders a back-chevron header ("Study notes") + `NotepadEditor` with `toolbarPlacement="bottom"`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/study/mobile/MobileStudyEditorView.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/notepad/components/Editor', () => ({ NotepadEditor: () => <div>editor</div> }));
vi.mock('@/notepad/theme/ThemeToggle', () => ({ ThemeToggle: () => <div>theme</div> }));
vi.mock('@/components/sections/notepad/mobile/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

import { MobileStudyEditorView } from './MobileStudyEditorView';

afterEach(cleanup);

describe('MobileStudyEditorView', () => {
  it('renders the editor and a back control that calls onBack', () => {
    const onBack = vi.fn();
    render(<MobileStudyEditorView onBack={onBack} />);
    expect(screen.getByText('editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to study notes/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/mobile/MobileStudyEditorView.test.tsx`
Expected: FAIL — cannot resolve `./MobileStudyEditorView`.

- [ ] **Step 3: Create the component**

```tsx
// src/notepad/study/mobile/MobileStudyEditorView.tsx
import { ChevronLeft } from 'lucide-react';
import { NotepadEditor } from '@/notepad/components/Editor';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
import { useKeyboardInset } from '@/components/sections/notepad/mobile/useKeyboardInset';

export interface MobileStudyEditorViewProps {
  /** Return to the Study notes list (clears the active note). */
  onBack: () => void;
}

export function MobileStudyEditorView({ onBack }: MobileStudyEditorViewProps) {
  const keyboardInset = useKeyboardInset();
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--notepad-page-bg)' }}>
      <header
        className="shrink-0 flex items-center justify-between gap-1 px-3"
        style={{ height: 48, borderBottom: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}
      >
        <button
          aria-label="Back to Study notes"
          onClick={onBack}
          className="flex items-center gap-1"
          style={{ color: 'var(--deep-umber)', fontSize: 13, background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <ChevronLeft size={18} /> Study notes
        </button>
        <ThemeToggle className="w-9 h-9" />
      </header>
      <div className="flex-1 min-h-0">
        <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={keyboardInset} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/mobile/MobileStudyEditorView.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/mobile/MobileStudyEditorView.tsx src/notepad/study/mobile/MobileStudyEditorView.test.tsx
git commit -m "feat(study): mobile full-focus study note editor"
```

---

### Task 3: `MobileStudyWorkspace` + session key

**Files:**
- Modify: `src/notepad/session/session-storage.ts` (add + export `KEY_MOBILE_STUDY_TAB`)
- Create: `src/notepad/study/mobile/MobileStudyWorkspace.tsx`
- Test: `src/notepad/study/mobile/MobileStudyWorkspace.test.tsx`

**Interfaces:**
- Consumes: `StudyTabBar` (Task 1), `MobileStudyEditorView` (Task 2), `MobileStudyTab` (Task 1), `StudyReader`/`StudySidePanel`/`ApparatusRail` (existing panes), `StudyModeToggle`, `useEnsureStudyFolder`, `useAuthSession`, `useNoteCollection`, `loadEnum`/`saveEnum`/`KEY_MOBILE_STUDY_TAB`.
- `useNoteCollection()` returns `{ notes, activeNote, collection }`; `collection.openNote(id: string | null)` sets/clears the active note.
- `StudySidePanel` props: `{ book: string; chapter: number; userId: string | null }` (omit expand/collapse handlers to hide those controls).
- Produces: `MobileStudyWorkspace()` (no props).

- [ ] **Step 1: Add the session-storage key**

In `src/notepad/session/session-storage.ts`, add the constant next to the others and to the export block:

```tsx
const KEY_MOBILE_STUDY_TAB = 'psalms.session.mobileStudyTab';
```

Add `KEY_MOBILE_STUDY_TAB,` to the existing `export { ... };` list (the block that already exports `KEY_MOBILE_TAB`).

- [ ] **Step 2: Write the failing test**

```tsx
// src/notepad/study/mobile/MobileStudyWorkspace.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const openNote = vi.fn();
let activeNote: { id: string } | null = null;

vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNote, collection: { openNote } }),
}));
vi.mock('../useEnsureStudyFolder', () => ({ useEnsureStudyFolder: () => {} }));
vi.mock('../panes/StudyReader', () => ({ StudyReader: () => <div>reader-pane</div> }));
vi.mock('../panes/StudySidePanel', () => ({ StudySidePanel: () => <div>side-panel</div> }));
vi.mock('../panes/ApparatusRail', () => ({ ApparatusRail: () => <div>apparatus</div> }));
vi.mock('../StudyModeToggle', () => ({ StudyModeToggle: () => <div>mode-toggle</div> }));
vi.mock('./MobileStudyEditorView', () => ({
  MobileStudyEditorView: (p: { onBack: () => void }) => <button onClick={p.onBack}>editor-back</button>,
}));

import { MobileStudyWorkspace } from './MobileStudyWorkspace';

afterEach(() => {
  cleanup();
  activeNote = null;
  openNote.mockClear();
});

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <MobileStudyWorkspace />
    </MemoryRouter>,
  );
}

describe('MobileStudyWorkspace', () => {
  it('lands on the Reader tab with the toggle and tab bar visible', () => {
    renderWorkspace();
    expect(screen.getByText('mode-toggle')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /reader/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the Context tab when tapped', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    expect(screen.getByRole('tab', { name: /context/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the full-focus editor (no toggle, no tab bar) when a note is active', () => {
    activeNote = { id: 'n1' };
    renderWorkspace();
    expect(screen.getByText('editor-back')).toBeInTheDocument();
    expect(screen.queryByText('mode-toggle')).toBeNull();
    expect(screen.queryByRole('tab', { name: /reader/i })).toBeNull();
    fireEvent.click(screen.getByText('editor-back'));
    expect(openNote).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/mobile/MobileStudyWorkspace.test.tsx`
Expected: FAIL — cannot resolve `./MobileStudyWorkspace`.

- [ ] **Step 4: Create the workspace**

```tsx
// src/notepad/study/mobile/MobileStudyWorkspace.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useEnsureStudyFolder } from '../useEnsureStudyFolder';
import { StudyReader } from '../panes/StudyReader';
import { StudySidePanel } from '../panes/StudySidePanel';
import { ApparatusRail } from '../panes/ApparatusRail';
import { StudyModeToggle } from '../StudyModeToggle';
import { StudyTabBar } from './StudyTabBar';
import { MobileStudyEditorView } from './MobileStudyEditorView';
import type { MobileStudyTab } from './types';
import { loadEnum, saveEnum, KEY_MOBILE_STUDY_TAB } from '@/notepad/session/session-storage';
import '../study-theme.css';

export function MobileStudyWorkspace() {
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { activeNote, collection } = useNoteCollection();
  useEnsureStudyFolder();

  const [tab, setTab] = useState<MobileStudyTab>(() =>
    loadEnum<MobileStudyTab>(KEY_MOBILE_STUDY_TAB, ['reader', 'study', 'context'], 'reader'),
  );
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });

  useEffect(() => {
    saveEnum(KEY_MOBILE_STUDY_TAB, tab);
  }, [tab]);

  // Stable + guarded so BibleReader's passage effect can't loop (see DesktopStudyWorkspace).
  const handlePassageChange = useCallback((ref: { book: string; chapter: number }) => {
    setPassage((prev) =>
      prev.book === ref.book && prev.chapter === ref.chapter ? prev : { book: ref.book, chapter: ref.chapter },
    );
  }, []);

  // A note being active means the user opened it from the Notes segment: take over
  // full-screen (chosen "full-focus editor" behavior), hiding the toggle + tab bar.
  const editing = !!activeNote;

  return (
    <div
      data-mode="study"
      className="study-workspace fixed inset-x-0 top-0 flex flex-col"
      style={{ height: '100dvh', overflow: 'hidden', background: 'var(--cream, #F4F1EA)' }}
    >
      {!editing && (
        <header
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderBottom: '1px solid var(--pale-stone)',
          }}
        >
          <img
            src="/logo-icon.png"
            alt="LivePsalms"
            className="notepad-nav-logo h-6 w-auto object-contain cursor-pointer"
            onClick={() => navigate('/')}
          />
          <StudyModeToggle />
        </header>
      )}

      <div className="flex-1 min-h-0 relative">
        {editing ? (
          <MobileStudyEditorView onBack={() => collection.openNote(null)} />
        ) : (
          <>
            {/* Panes stay mounted (display toggle) so reader scroll + chat draft survive tab switches. */}
            <div style={{ height: '100%', display: tab === 'reader' ? 'block' : 'none', overflow: 'auto' }}>
              <StudyReader book={passage.book} chapter={passage.chapter} onPassageChange={handlePassageChange} />
            </div>
            <div style={{ height: '100%', display: tab === 'study' ? 'block' : 'none' }}>
              <StudySidePanel book={passage.book} chapter={passage.chapter} userId={userId} />
            </div>
            <div style={{ height: '100%', display: tab === 'context' ? 'block' : 'none', overflow: 'auto' }}>
              <ApparatusRail book={passage.book} chapter={passage.chapter} />
            </div>
          </>
        )}
      </div>

      {!editing && <StudyTabBar active={tab} onSelect={setTab} />}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/mobile/MobileStudyWorkspace.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/session/session-storage.ts src/notepad/study/mobile/MobileStudyWorkspace.tsx src/notepad/study/mobile/MobileStudyWorkspace.test.tsx
git commit -m "feat(study): MobileStudyWorkspace with Reader/Study/Context tabs"
```

---

### Task 4: Split `StudyWorkspace` into a mobile/desktop dispatcher

**Files:**
- Modify: `src/notepad/study/StudyWorkspace.tsx`
- Modify: `src/notepad/study/StudyWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useIsMobile` (`@/hooks/use-mobile`), `MobileStudyWorkspace` (Task 3).
- Produces: `StudyWorkspace()` — dispatcher; `DesktopStudyWorkspace()` — the existing 3-column body (renamed, still exported for direct testing). Route imports of `StudyWorkspace` are unchanged.

- [ ] **Step 1: Update the existing test to control the breakpoint and cover dispatch**

Replace the top of `src/notepad/study/StudyWorkspace.test.tsx` so the mocked `useIsMobile` defaults to desktop, then add a mobile-dispatch case. Add these two mocks alongside the existing `vi.mock(...)` calls (after the `useAuthSession` mock):

```tsx
const isMobile = { value: false };
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => isMobile.value }));
vi.mock('./mobile/MobileStudyWorkspace', () => ({ MobileStudyWorkspace: () => <div>mobile-study</div> }));
```

Change the `afterEach(cleanup);` line to also reset the flag:

```tsx
afterEach(() => {
  cleanup();
  isMobile.value = false;
});
```

Add this test inside the `describe('StudyWorkspace', ...)` block:

```tsx
it('renders the mobile workspace below the breakpoint', () => {
  isMobile.value = true;
  render(
    <ThemeContext.Provider value={themeValue}>
      <MemoryRouter>
        <StudyWorkspace />
      </MemoryRouter>
    </ThemeContext.Provider>,
  );
  expect(screen.getByText('mobile-study')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify the new case fails**

Run: `npx vitest run src/notepad/study/StudyWorkspace.test.tsx`
Expected: FAIL — `getByText('mobile-study')` not found (StudyWorkspace doesn't dispatch yet); the two existing desktop tests still PASS.

- [ ] **Step 3: Rename the body and add the dispatcher**

In `src/notepad/study/StudyWorkspace.tsx`:

1. Add imports near the top (after the existing imports):

```tsx
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileStudyWorkspace } from './mobile/MobileStudyWorkspace';
```

2. Rename the existing exported function from `export function StudyWorkspace() {` to:

```tsx
export function DesktopStudyWorkspace() {
```

(leave its entire body unchanged).

3. Add the dispatcher at the end of the file:

```tsx
export function StudyWorkspace() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileStudyWorkspace /> : <DesktopStudyWorkspace />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/StudyWorkspace.test.tsx`
Expected: PASS (3 tests — two desktop + one mobile dispatch).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/StudyWorkspace.tsx src/notepad/study/StudyWorkspace.test.tsx
git commit -m "feat(study): dispatch StudyWorkspace to mobile/desktop by breakpoint"
```

---

### Task 5: Persistent Journal⇄Study toggle in the mobile Journal workspace

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`

**Interfaces:**
- Consumes: `StudyModeToggle` (`@/notepad/study/StudyModeToggle`). It is route-aware (links to `${base}` and `${base}/study`), so it works unchanged at both `/notepad/notes` and `/notepad/u/:username`.
- No new exports.

- [ ] **Step 1: Add the import**

In `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`, add to the import block:

```tsx
import { StudyModeToggle } from '@/notepad/study/StudyModeToggle';
```

- [ ] **Step 2: Render the toggle bar (hidden during the full-focus editor)**

Immediately **before** the `<div className="flex-1 min-h-0 relative">` line (and after the offline-banner block), insert:

```tsx
{effectiveTab !== 'editor' && (
  <div
    className="shrink-0 flex items-center justify-center"
    style={{ padding: '6px 12px', borderBottom: '1px solid var(--pale-stone)' }}
  >
    <StudyModeToggle />
  </div>
)}
```

- [ ] **Step 3: Typecheck and run the notepad test suite**

Run: `tsc -b && npx vitest run src/components/sections/notepad`
Expected: tsc clean (no new errors); notepad tests PASS (no regressions from the added toggle bar).

- [ ] **Step 4: Commit**

```bash
git add src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx
git commit -m "feat(notepad): persistent Journal/Study toggle on mobile"
```

---

### Task 6: Full verification in the running app

**Files:** none (verification only).

- [ ] **Step 1: Build-check the whole project**

Run: `tsc -b`
Expected: no new errors beyond the pre-existing `force-sphere.test.ts` baseline.

- [ ] **Step 2: Run the full study + notepad test suites**

Run: `npx vitest run src/notepad/study src/components/sections/notepad`
Expected: PASS (new tests green; no regressions).

- [ ] **Step 3: Manually verify on a mobile viewport**

Start the dev server (`npm run dev`), open the app at a <768px viewport (DevTools device toolbar), sign in or use local mode, then:
- Visit `/notepad/notes` (or your vanity URL). Confirm the **Journal · Study** toggle shows above the tabs.
- Tap **Study** → confirm the mobile Study workspace renders (not crushed desktop columns): top toggle + **Reader · Study · Context** bottom tabs, landing on **Reader**.
- Tap **Study** tab → confirm the Notes | Chat panel; open a note → confirm the full-focus editor (toggle + tab bar hidden, bottom toolbar, "‹ Study notes" back); tap back → returns to the notes list.
- Tap **Context** → confirm the apparatus renders.
- Tap **Journal** in the toggle → confirm return to the Journal tabs.
- Resize to ≥768px on `/notepad/notes/study` → confirm the desktop 3-column layout is unchanged.

- [ ] **Step 4: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "test(study): verify mobile study workspace end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Top mode toggle (decision 1) → Task 4 (Study side) + Task 5 (Journal side), reusing route-aware `StudyModeToggle`. ✓
- Study tabs Reader · Study(Notes|Chat) · Context (decision 2) → Task 1 (`StudyTabBar`) + Task 3 (panes wired; `StudySidePanel` provides the Notes|Chat segment). ✓
- Full-focus note editor (decision 3) → Task 2 + Task 3 (`editing` gate hides toggle/tab bar). ✓
- Routes (`/notepad/notes/study` + vanity) → Task 4 dispatcher swaps in mobile for the existing route; `StudyModeToggle` already handles both base paths. ✓
- Default landing = Reader; session persistence → Task 3 (`KEY_MOBILE_STUDY_TAB`, fallback `reader`). ✓
- Desktop unchanged → Task 4 keeps `DesktopStudyWorkspace` body verbatim; ≥768px verification in Task 6. ✓
- Out of scope (verse→note authoring, Study "More" tab) → not introduced. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**Type consistency:** `MobileStudyTab` ('reader'|'study'|'context') is consistent across `types.ts`, `StudyTabBar`, `MobileStudyWorkspace`, and `loadEnum` allow-list. `collection.openNote(null)` matches the existing `StudyNotesTab` usage. `StudySidePanel` is called with `{ book, chapter, userId }` only (expand/collapse omitted ⇒ controls hidden, per its prop guards). ✓
