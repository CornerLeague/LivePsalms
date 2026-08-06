# Waymarks back button + Study-notes mobile editor fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a "← Notebook" back link to the Waymarks list page and show the mobile bottom dock on the notepad editor routes (study + journal) without breaking the editor toolbar; verify two already-fixed items live.

**Architecture:** #1 is a pure JSX addition mirroring the detail page (TDD). #3 decouples the dock's mount gate from the Header's shared boolean, hides the dock while the keyboard is up, and lifts the editor's sticky toolbar above the fixed dock via a `max(offset, --mobile-dock-clearance)` CSS expression. #2 and #4 are verify-only (already fixed in `origin/main`).

**Tech Stack:** React 18 + react-router-dom, TipTap editor, Tailwind + CSS custom props, Vitest + Testing Library (jsdom), chrome-devtools MCP for browser verification.

## Global Constraints
- Branch `feat/waymarks-back-study-notepad-mobile` (off `origin/main` = `e09177a`); HEAD `fb1ee30`.
- Back label text is exactly `← Notebook` (not "← Waymarks").
- NEVER touch local `main` @ `37be6b7` or `feat/etymology-always-show` @ `08a9699`.
- Gates before done: `npx tsc -b` exit 0; `npx vitest run <touched dirs>`; `npx eslint <touched files>`. Pre-existing noise (NOT ours): ~100 repo lint errors + failing `garden-scene.test.tsx`.
- Do NOT self-merge; Nat/CornerLeague squash-merges.

---

### Task 1: Waymarks LIST back button (REAL WORK, TDD)

**Files:**
- Modify: `src/notepad/components/waymarks/WaymarksReflections.tsx` (ready state ~L110; loading state ~L78)
- Test: `src/notepad/components/waymarks/WaymarksReflections.back-link.test.tsx` (new)

**Interfaces:**
- Consumes: `<Link>` (already imported `WaymarksReflections.tsx:2`); CSS `.wm-back .wm-label` (already in `waymarks.css:58,90-91`, not detail-scoped).
- Produces: a `<a href="/..">← Notebook</a>` as first child inside `.wm-root` in both the ready and loading branches. `to=".."` from `/notebook/u/:username/reflections` → `/notebook/u/:username`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WaymarksReflections } from './WaymarksReflections';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import type { ReflectionArtifact } from '../../storage/lamplight-artifacts';

const art: ReflectionArtifact = { title: 'T', letter: 'L', markers: [] };
function seed(a: FakeLamplightAdapter, userId: string, periodKey: string) {
  a.__seedReflection(userId, {
    periodKey, title: `t-${periodKey}`, artifact: art,
    createdAt: `${periodKey}-01T12:00:00.000Z`, savedToNotes: false,
  });
}

describe('WaymarksReflections back link', () => {
  it('renders a "← Notebook" link to the parent route in the ready state', async () => {
    const a = new FakeLamplightAdapter();
    seed(a, 'u', '2026-05');
    render(
      <MemoryRouter>
        <WaymarksReflections adapter={a} userId="u" canAccess={true} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('May 2026')).toBeInTheDocument());
    const back = screen.getByRole('link', { name: '← Notebook' });
    expect(back).toHaveClass('wm-back');
    // to=".." from the default MemoryRouter route ("/") resolves to "/"
    expect(back.getAttribute('href')).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/components/waymarks/WaymarksReflections.back-link.test.tsx`
Expected: FAIL — no link with name "← Notebook".

- [ ] **Step 3: Add the back link to the ready state**

In `WaymarksReflections.tsx`, inside the ready-state `return`, make the `<Link>` the FIRST child of `.wm-root` (before `<header>`):

```tsx
  return (
    <div className="wm-root">
      <Link to=".." className="wm-back wm-label">← Notebook</Link>
      <header>
```

- [ ] **Step 4: Add the back link to the loading state**

Update the early loading return so the affordance is consistent:

```tsx
  if (items === null) {
    return (
      <div className="wm-root">
        <Link to=".." className="wm-back wm-label">← Notebook</Link>
        <p className="wm-caption">Finding your path…</p>
      </div>
    );
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/components/waymarks/WaymarksReflections.back-link.test.tsx`
Expected: PASS. Also run existing `WaymarksReflections.test.tsx` to confirm no regression.

- [ ] **Step 6: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/notepad/components/waymarks/WaymarksReflections.tsx src/notepad/components/waymarks/WaymarksReflections.back-link.test.tsx && git commit -m "feat(waymarks): add ← Notebook back link to the reflections list"
```

---

### Task 2: Show the mobile dock on editor routes (REAL WORK, browser-verified)

**Files:**
- Modify: `src/App.tsx:201` (add a separate wider gate for the dock; keep `dockMounted` for Header + wrapper pb) and `:247` (use the new gate).
- Modify: `src/components/layout/MobileBottomDock.tsx` (hide while keyboard up via `useKeyboardInset`).
- Modify: `src/notepad/components/Editor.tsx` (add `showBottomDock` prop; lift toolbar + pad content).
- Modify: `src/components/sections/notepad/mobile/MobileEditorView.tsx` and `src/notepad/study/mobile/MobileStudyEditorView.tsx` (pass `showBottomDock`).
- Test: extend `src/notepad/components/Editor.toolbar-placement.test.tsx` with a `showBottomDock` assertion.

**Interfaces:**
- `NotepadEditor` gains `showBottomDock?: boolean` (default `false`). When `true` AND `toolbarPlacement="bottom"`: toolbar `bottom` = `max(${toolbarBottomOffset}px, var(--mobile-dock-clearance))`, and `editor-scroll` gets `paddingBottom: var(--mobile-dock-clearance)`.
- `MobileBottomDock` internally reads `useKeyboardInset()` and hides (`visible=false`) when inset > 0.

**CRITICAL:** `dockMounted` in App.tsx currently gates BOTH the marketing `<Header>` (L246) and the dock (L247). Widening `dockMounted` itself would wrongly render `<Header>` on editor routes. Introduce a SEPARATE `mobileDockMounted` for the dock only.

- [ ] **Step 1: Decouple the dock gate in App.tsx**

Replace L201:
```js
  const dockMounted = !isNotepadEditor && !isLoginPage && !isProfilePage && !isWelcomePage && !isUpdatePasswordPage;
```
with:
```js
  // Header + wrapper chrome stay off the notepad editor family (unchanged).
  const dockMounted = !isNotepadEditor && !isLoginPage && !isProfilePage && !isWelcomePage && !isUpdatePasswordPage;
  // The mobile bottom dock ALSO shows on the notepad editor family (study + journal
  // + waymarks) so users keep a way to navigate. isAppShell / the scroll lock are
  // intentionally left unchanged.
  const mobileDockMounted = !isLoginPage && !isProfilePage && !isWelcomePage && !isUpdatePasswordPage;
```

- [ ] **Step 2: Use the new gate for the dock (App.tsx:247)**

Change:
```jsx
          {dockMounted && <MobileBottomDock onNavTrigger={handleNavTrigger} />}
```
to:
```jsx
          {mobileDockMounted && <MobileBottomDock onNavTrigger={handleNavTrigger} />}
```
(Leave L246 `{dockMounted && <Header ... />}` and L232 wrapper `pb` unchanged.)

- [ ] **Step 3: Hide the dock while the keyboard is up (MobileBottomDock.tsx)**

Add import:
```tsx
import { useKeyboardInset } from '@/components/sections/notepad/mobile/useKeyboardInset';
```
Add the hook call alongside the others (BEFORE the `if (!isMobile) return null` early return, to keep hook order stable):
```tsx
  const keyboardInset = useKeyboardInset();
```
Change the `visible` computation:
```tsx
  const visible = panelOpen ? true : (dir !== 'down' && keyboardInset === 0);
```

- [ ] **Step 4: Add `showBottomDock` to NotepadEditor (Editor.tsx)**

Extend props (after `toolbarBottomOffset`):
```tsx
  /** When true (mobile editor routes), reserve room for the fixed MobileBottomDock:
   *  lift the sticky bottom toolbar above the dock and pad the content bottom. */
  showBottomDock?: boolean;
```
Destructure with default:
```tsx
  toolbarBottomOffset = 0,
  showBottomDock = false,
```
Toolbar `bottom` (currently `bottom: isBottomToolbar ? \`${toolbarBottomOffset}px\` : undefined,`):
```tsx
            bottom: isBottomToolbar
              ? (showBottomDock
                  ? `max(${toolbarBottomOffset}px, var(--mobile-dock-clearance))`
                  : `${toolbarBottomOffset}px`)
              : undefined,
```
`editor-scroll` style — add a bottom-padding override after the `padding` line:
```tsx
          padding: isBottomToolbar ? '2rem 1.25rem' : '2rem 2.5rem',
          ...(isBottomToolbar && showBottomDock
            ? { paddingBottom: 'var(--mobile-dock-clearance)' }
            : {}),
```

- [ ] **Step 5: Pass `showBottomDock` from both mobile editor wrappers**

`MobileEditorView.tsx` (~L78):
```tsx
        <NotepadEditor
          onAfterSave={onAfterSave}
          toolbarPlacement="bottom"
          toolbarBottomOffset={keyboardInset}
          showBottomDock
        />
```
`MobileStudyEditorView.tsx` (L30):
```tsx
        <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={keyboardInset} showBottomDock />
```

- [ ] **Step 6: Add a unit assertion for the lifted toolbar**

In `Editor.toolbar-placement.test.tsx`, add:
```tsx
  it('lifts the bottom toolbar above the dock clearance when showBottomDock is set', () => {
    const { container } = render(
      <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={0} showBottomDock />,
    );
    const toolbar = container.querySelector('[data-toolbar-placement="bottom"]') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.bottom).toContain('--mobile-dock-clearance');
    expect(toolbar.style.bottom).toContain('max(');
  });
```

- [ ] **Step 7: Run the touched test suites**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/components/Editor.toolbar-placement.test.tsx src/notepad/components/Editor.mobile-scroll.test.tsx src/components/sections/notepad/mobile/MobileEditorView.test.tsx`
Expected: PASS (existing tests unaffected — `showBottomDock` defaults false).

- [ ] **Step 8: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/App.tsx src/components/layout/MobileBottomDock.tsx src/notepad/components/Editor.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx src/notepad/study/mobile/MobileStudyEditorView.tsx src/notepad/components/Editor.toolbar-placement.test.tsx && git commit -m "feat(notepad): show mobile bottom dock on editor routes, lift toolbar above it"
```

---

### Task 3: Gates + browser verification (#2, #3 visual, #4)

- [ ] `npx tsc -b` → exit 0.
- [ ] `npx eslint` on all touched files → no NEW errors.
- [ ] Browser (VISIBLE chrome-devtools, mobile emulation 375×812, `.dark` toggle both themes), authed Plus user A `mmagee12@gmail.com` slug `true_vineyard_5536`:
  - #1: Waymarks list shows "← Notebook", tapping returns to `/notebook/u/:username`.
  - #3: dock visible on study + journal editors; toolbar sits ABOVE the dock (not covered); dock hides when keyboard opens; content not hidden behind dock.
  - #2: swipe the bottom toolbar horizontally → it scrolls to reveal Code/Underline/Sparkles → no code, capture proof.
  - #4: long note body scrolls vertically, toolbar stays pinned → no code, capture proof.
  - If Google OAuth blocks auth, verify pure-CSS bits via local `npm run dev`/harness and state plainly what was NOT observed live.

## Ship
Push → PR against `main`. Do NOT self-merge. After merge: confirm Vercel prod success + www 200, update memory `project_reflection_timeline.md`, run `superpowers:finishing-a-development-branch`.
