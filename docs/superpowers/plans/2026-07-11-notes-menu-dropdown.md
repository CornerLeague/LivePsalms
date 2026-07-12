# Notes-page Menu → Top-right Hamburger Dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the `/notebook/notes` notes workspace only (mobile + desktop), relocate the site-nav MENU into a 3-line hamburger dropdown at the top-right, immediately left of the user avatar; suppress the mobile `MobileBottomDock` on that route only.

**Architecture:** One reusable presentational `NotesMenu` component built on the app's shared Radix `DropdownMenu` primitive, inserted at three header sites (desktop `NotepadToolbar`; mobile `MobileNotesView` + `MobileEditorView`). Loading-overlay parity is wired through a new tiny `NavTriggerContext` (both insertion trees mount too deep in the router to receive App's `handleNavTrigger` as a prop). The mobile dock is suppressed by AND-ing a new pure `isNotesWorkspaceIndexPath` predicate into App's `mobileDockMounted`. With the dock gone, `MobileEditorView` flips `showBottomDock` off so the editor's sticky bottom toolbar sits flush above `MobileTabBar`.

**Tech Stack:** React 18 + TypeScript, react-router-dom v6, `@radix-ui/react-dropdown-menu` (via `@/components/ui/dropdown-menu`), lucide-react, Vitest + @testing-library/react (jsdom per-file pragma), Tailwind + CSS custom-property theme tokens.

## Global Constraints

- **Scope = notes workspace index ONLY** — `/notebook/notes` and vanity `/notebook/u/:username` index. Study (`/notebook/notes/study`, `/notebook/u/:username/study`), Waymarks/reflections, the `/notebook` landing, and all marketing pages are **untouched**.
- **`MobileTabBar` (`Notes · Editor · Bible · More`) stays unchanged** — it is not the MENU and is not the dock.
- **Dropdown contents mirror today's MENU exactly:** the four `navItems` (`Purpose /purpose`, `Notebook /notebook`, `Community /community`, `Contact /contact`) + a `Social → Instagram` row. Nothing added, nothing removed.
- **Icon:** plain static 3-line hamburger (lucide `Menu`); soft fade/scale dropdown (the primitive default). No morph-to-X.
- **Placement:** hamburger immediately **left of the avatar** on both platforms.
- **Theme colors MUST be `.dark`-class-scoped, never `@media (prefers-color-scheme)`** (the #84 lesson). The shared `DropdownMenuContent` already uses class-scoped `bg-popover`/`text-popover-foreground`/`border` tokens — reuse it; do not author a new media-query palette.
- **Gates before "done":** `tsc -b` clean (MUST run `tsc -b`, not just eslint+vitest) · vitest green (new + existing) · eslint clean on touched files · browser-verified mobile 375×812 + desktop, light AND dark.
- **Repo hard rules:** never `reset`/`revert`/`pull`/`merge` local `main` @`37be6b7` or `feat/etymology-always-show` @`08a9699`. Work only on `feat/notes-menu-dropdown`. Leave the untracked `docs/superpowers/plans/2026-07-11-waymarks-back-study-notepad-mobile.md` alone.
- **cwd resets to `/Users/newmac/Desktop` each Bash call** → prefix every command with `cd /Users/newmac/Downloads/Psalms_app`.

---

## File Structure

- **Create** `src/hooks/nav-trigger-context.ts` — `NavTriggerContext` + `useNavTrigger()` (mirrors `src/hooks/loading-overlay-context.ts`).
- **Create** `src/hooks/nav-trigger-context.test.tsx` — context default/provided behavior.
- **Create** `src/components/notes-menu/NotesMenu.tsx` — the reusable hamburger dropdown.
- **Create** `src/components/notes-menu/NotesMenu.test.tsx` — TDD unit tests.
- **Create** `src/routing/notes-route.ts` — `isNotesWorkspaceIndexPath(pathname)` predicate.
- **Create** `src/routing/notes-route.test.ts` — predicate table test.
- **Modify** `src/App.tsx` — provide `NavTriggerContext`; AND `!isNotesWorkspaceIndexPath(...)` into `mobileDockMounted`.
- **Modify** `src/notepad/components/NotepadToolbar.tsx` — insert `<NotesMenu>` left of `<NotepadAuthControls/>`, wired to `useNavTrigger()`.
- **Modify** `src/components/sections/notepad/mobile/MobileNotesView.tsx` — insert `<NotesMenu>` left of the avatar; add `onNavTrigger?` prop.
- **Modify** `src/components/sections/notepad/mobile/MobileEditorView.tsx` — insert `<NotesMenu>` left of the avatar; add `onNavTrigger?` prop; flip `showBottomDock` off.
- **Modify** `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` — consume `useNavTrigger()`, pass `onNavTrigger` to both mobile views.

---

## Task 1: Nav-trigger context

**Files:**
- Create: `src/hooks/nav-trigger-context.ts`
- Test: `src/hooks/nav-trigger-context.test.tsx`
- Modify: `src/App.tsx` (provider only — verified in Task 7)

**Interfaces:**
- Produces: `NavTriggerContext: React.Context<() => void>`, `useNavTrigger(): () => void` (defaults to a no-op when no provider is present).
- Consumed later by: `NotepadToolbar` (Task 3) and `MobileNotepadWorkspace` (Task 4).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/hooks/nav-trigger-context.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NavTriggerContext, useNavTrigger } from './nav-trigger-context';

afterEach(cleanup);

function Probe() {
  const trigger = useNavTrigger();
  return <button onClick={trigger}>go</button>;
}

describe('useNavTrigger', () => {
  it('is a no-op (does not throw) when no provider is present', () => {
    render(<Probe />);
    expect(() => fireEvent.click(screen.getByText('go'))).not.toThrow();
  });

  it('returns the provided trigger inside a provider', () => {
    const fn = vi.fn();
    render(
      <NavTriggerContext.Provider value={fn}>
        <Probe />
      </NavTriggerContext.Provider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/hooks/nav-trigger-context.test.tsx`
Expected: FAIL — cannot resolve `./nav-trigger-context`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/nav-trigger-context.ts
import { createContext, useContext } from 'react';

/**
 * Exposes App's loading-overlay nav trigger (handleNavTrigger) to components
 * mounted deep in the router tree that cannot receive it as a prop — the
 * notes-page NotesMenu on both platforms. Mirrors loading-overlay-context.ts.
 * Defaults to a no-op so components rendered without the provider (tests,
 * isolated mounts) navigate normally without firing the overlay.
 */
const noop = (): void => {};

export const NavTriggerContext = createContext<() => void>(noop);

export function useNavTrigger(): () => void {
  return useContext(NavTriggerContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/hooks/nav-trigger-context.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Provide the context in App.tsx**

In `src/App.tsx`:

Add the import near the other hook-context imports (after line 26 `import { LoadingOverlayContext } from '@/hooks/loading-overlay-context';`):

```tsx
import { NavTriggerContext } from '@/hooks/nav-trigger-context';
```

Wrap the app body with the provider. Change the opening (currently line 227):

```tsx
        <LoadingOverlayContext.Provider value={overlayPresent}>
        <div
```

to:

```tsx
        <LoadingOverlayContext.Provider value={overlayPresent}>
        <NavTriggerContext.Provider value={handleNavTrigger}>
        <div
```

And the matching close (currently line 366 `        </LoadingOverlayContext.Provider>`):

```tsx
        </NavTriggerContext.Provider>
        </LoadingOverlayContext.Provider>
```

- [ ] **Step 6: Verify types + commit**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc -b`
Expected: no errors.

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/hooks/nav-trigger-context.ts src/hooks/nav-trigger-context.test.tsx src/App.tsx
git commit -m "feat(notes-menu): add NavTriggerContext for deep-mounted nav-overlay parity"
```

---

## Task 2: NotesMenu component (TDD)

**Files:**
- Create: `src/components/notes-menu/NotesMenu.tsx`
- Test: `src/components/notes-menu/NotesMenu.test.tsx`

**Interfaces:**
- Consumes: `navItems`, `NAV_TRIGGER_LABELS` from `@/data/projects`; `DropdownMenu*` from `@/components/ui/dropdown-menu`; `cn` from `@/lib/utils`; `Link` from `react-router-dom`; `Menu` from `lucide-react`.
- Produces: `NotesMenu(props: NotesMenuProps)` where
  `NotesMenuProps = { onNavTrigger?: () => void; className?: string; align?: 'start' | 'end'; iconSize?: number }`.
  Used by Tasks 3 and 4. Trigger is a `<button aria-label="Menu">`; the primitive supplies `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, `data-state`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/components/notes-menu/NotesMenu.test.tsx
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotesMenu } from './NotesMenu';

// --- jsdom shims for Radix DropdownMenu (same rationale as RecordingsStrip.test.tsx) ---
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// Radix's modal menu installs a document-level focus trap; jsdom's synchronous
// focus events let it interfere. Making programmatic focus a no-op sidesteps it
// (no assertion depends on focus).
let realFocus: typeof HTMLElement.prototype.focus;
beforeAll(() => {
  realFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = () => {};
});
afterAll(() => {
  HTMLElement.prototype.focus = realFocus;
});
afterEach(cleanup);

function renderMenu(props: Partial<React.ComponentProps<typeof NotesMenu>> = {}) {
  return render(
    <MemoryRouter>
      <NotesMenu {...props} />
    </MemoryRouter>,
  );
}

// jsdom lacks PointerEvent, so Radix's trigger never opens from a plain click.
// It DOES open on Enter/Space keydown — a real supported path.
function openMenu(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Menu' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

describe('NotesMenu', () => {
  it('renders a hamburger trigger with menu aria attributes (closed)', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on activation and flips aria-expanded to true', () => {
    renderMenu();
    const trigger = openMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists all four nav links plus the Social/Instagram entry', () => {
    renderMenu();
    openMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Purpose')).toBeInTheDocument();
    expect(within(menu).getByText('Notebook')).toBeInTheDocument();
    expect(within(menu).getByText('Community')).toBeInTheDocument();
    expect(within(menu).getByText('Contact')).toBeInTheDocument();
    expect(within(menu).getByText('Social')).toBeInTheDocument();
    expect(within(menu).getByText(/Instagram/)).toBeInTheDocument();
  });

  it('fires onNavTrigger when a nav label is selected', () => {
    const onNavTrigger = vi.fn();
    renderMenu({ onNavTrigger });
    openMenu();
    fireEvent.click(screen.getByText('Purpose'));
    expect(onNavTrigger).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onNavTrigger when the Instagram (Social) link is selected', () => {
    const onNavTrigger = vi.fn();
    renderMenu({ onNavTrigger });
    openMenu();
    fireEvent.click(screen.getByText(/Instagram/));
    expect(onNavTrigger).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    renderMenu();
    const trigger = openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/components/notes-menu/NotesMenu.test.tsx`
Expected: FAIL — cannot resolve `./NotesMenu`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/notes-menu/NotesMenu.tsx
import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { navItems, NAV_TRIGGER_LABELS } from '@/data/projects';
import { cn } from '@/lib/utils';

export interface NotesMenuProps {
  /** Fired when a nav label in NAV_TRIGGER_LABELS is tapped (loading-overlay parity with MobileBottomDock). */
  onNavTrigger?: () => void;
  /** Classes merged onto the hamburger trigger button (sizing/radius per platform). */
  className?: string;
  /** Dropdown panel alignment relative to the trigger. Defaults to 'end' (right-anchored). */
  align?: 'start' | 'end';
  /** Hamburger icon size in px. Defaults to 18. */
  iconSize?: number;
}

/**
 * Site-navigation menu for the notes workspace (mobile + desktop). A plain
 * 3-line hamburger trigger opens a soft dropdown mirroring the site MENU
 * relocated from MobileBottomDock: the four navItems links + a Social/Instagram
 * row. Built on the shared Radix DropdownMenu primitive, which supplies keyboard
 * navigation, Escape/outside-click dismissal, anchored positioning, and
 * .dark-class-scoped popover tokens (never prefers-color-scheme). Presentational
 * + navigational only — open/close state is owned by the primitive.
 */
export function NotesMenu({ onNavTrigger, className, align = 'end', iconSize = 18 }: NotesMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu"
          className={cn(
            'flex items-center justify-center transition-colors hover:bg-black/5 dark:hover:bg-white/10',
            className,
          )}
          style={{ color: 'var(--deep-umber)' }}
        >
          <Menu size={iconSize} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        style={{ fontFamily: 'Outfit, sans-serif', minWidth: 176 }}
      >
        {navItems.map((item) => (
          <DropdownMenuItem
            key={item.label}
            asChild
            style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}
          >
            <Link
              to={item.href}
              onClick={() => {
                if (NAV_TRIGGER_LABELS.has(item.label)) onNavTrigger?.();
              }}
            >
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel
          style={{
            fontFamily: 'Outfit, sans-serif',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            opacity: 0.6,
          }}
        >
          Social
        </DropdownMenuLabel>
        <DropdownMenuItem asChild style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}>
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer">
            Instagram ↗
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Note: `Social` is realized as a non-interactive `DropdownMenuLabel` (section header) followed by the actionable `Instagram ↗` external link — the faithful flat translation of the dock's two-tier "tap SOCIAL → reveal INSTAGRAM". The nav-trigger `onClick` is placed on the `<Link>` (mirroring `MobileBottomDock.tsx:89-91`); the primitive auto-closes on select.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/components/notes-menu/NotesMenu.test.tsx`
Expected: PASS (6 tests). If the `closes on Escape` case is flaky under Radix/jsdom, fall back to dispatching Escape on `document.body` — do NOT weaken the assertion.

- [ ] **Step 5: Lint + commit**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx eslint src/components/notes-menu/NotesMenu.tsx src/components/notes-menu/NotesMenu.test.tsx`
Expected: clean.

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/components/notes-menu/NotesMenu.tsx src/components/notes-menu/NotesMenu.test.tsx
git commit -m "feat(notes-menu): NotesMenu hamburger dropdown mirroring the site MENU"
```

---

## Task 3: Desktop insertion — NotepadToolbar

**Files:**
- Modify: `src/notepad/components/NotepadToolbar.tsx` (imports; add `useNavTrigger()`; insert `<NotesMenu>` immediately left of `<NotepadAuthControls />` at ~line 226)

**Interfaces:**
- Consumes: `NotesMenu` (Task 2), `useNavTrigger` (Task 1). `NotepadToolbar` is used ONLY by `DesktopNotepadWorkspace`, so this edit is auto-scoped to the desktop notes page (Study has its own `DesktopStudyWorkspace`).

- [ ] **Step 1: Add imports**

After line 22 (`import { ThemeToggle } from '@/notepad/theme/ThemeToggle';`) add:

```tsx
import { NotesMenu } from '@/components/notes-menu/NotesMenu';
import { useNavTrigger } from '@/hooks/nav-trigger-context';
```

- [ ] **Step 2: Read the App trigger in the component body**

Inside `NotepadToolbar`, after line 46 (`const [uploadOpen, setUploadOpen] = useState(false);`) add:

```tsx
  const navTrigger = useNavTrigger();
```

- [ ] **Step 3: Insert NotesMenu left of the auth controls**

Replace the block (currently lines 225-226):

```tsx
          {/* Auth area */}
          <NotepadAuthControls />
```

with:

```tsx
          {/* Site nav */}
          <NotesMenu className="w-8 h-8 rounded" iconSize={18} onNavTrigger={navTrigger} />

          {/* Divider */}
          <div
            className="mx-2 self-stretch"
            style={{
              width: 1,
              background: 'var(--pale-stone)',
              marginTop: 10,
              marginBottom: 10,
            }}
          />

          {/* Auth area */}
          <NotepadAuthControls />
```

Result order in the right cluster: `… Graph toggle · divider · [☰ NotesMenu] · divider · NotepadAuthControls (TierBadge + avatar)`.

- [ ] **Step 4: Verify types + build**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/components/NotepadToolbar.tsx
git commit -m "feat(notes-menu): mount NotesMenu in the desktop notepad toolbar"
```

(Browser verification for placement/theme is done in Task 7.)

---

## Task 4: Mobile insertion — both notes views + workspace threading

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileNotesView.tsx` (add `onNavTrigger?` prop; insert `<NotesMenu>` left of the avatar)
- Modify: `src/components/sections/notepad/mobile/MobileEditorView.tsx` (add `onNavTrigger?` prop; insert `<NotesMenu>` left of the avatar) — the `showBottomDock` flip is Task 6
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` (consume `useNavTrigger()`; pass `onNavTrigger` to both views)

**Interfaces:**
- `MobileNotesViewProps` and `MobileEditorViewProps` each gain `onNavTrigger?: () => void`.
- `MobileNotepadWorkspace` reads `useNavTrigger()` once and passes `onNavTrigger={navTrigger}` to both `<MobileNotesView>` and `<MobileEditorView>`.

- [ ] **Step 1: MobileNotesView — import + prop + insert**

Add import after line 6 (`import { HeaderLamplightFlame } from './HeaderLamplightFlame';`):

```tsx
import { NotesMenu } from '@/components/notes-menu/NotesMenu';
```

Add to `MobileNotesViewProps` (after the `avatarUrl?` field, ~line 26):

```tsx
  /** Fires the loading overlay on site-nav taps (parity with the old dock). */
  onNavTrigger?: () => void;
```

Add `onNavTrigger` to the destructured params (after `avatarUrl,` ~line 40).

Insert `<NotesMenu>` immediately before the Account `<button>` in the right cluster. Change (currently lines 69-70):

```tsx
          <ThemeToggle className="w-9 h-9" />
          <button
            aria-label="Account"
```

to:

```tsx
          <ThemeToggle className="w-9 h-9" />
          <NotesMenu className="w-9 h-9 rounded-full" iconSize={18} onNavTrigger={onNavTrigger} />
          <button
            aria-label="Account"
```

- [ ] **Step 2: MobileEditorView — import + prop + insert**

Add import after line 8 (`import { HeaderLamplightFlame } from './HeaderLamplightFlame';`):

```tsx
import { NotesMenu } from '@/components/notes-menu/NotesMenu';
```

Add to `MobileEditorViewProps` (after the `avatarUrl?` field, ~line 17):

```tsx
  /** Fires the loading overlay on site-nav taps (parity with the old dock). */
  onNavTrigger?: () => void;
```

Add `onNavTrigger` to the destructured params (after `avatarUrl,` ~line 34).

Insert `<NotesMenu>` immediately before the Account `<button>`. Change (currently lines 61-63):

```tsx
          <ThemeToggle className="w-9 h-9" />
        <button
          aria-label="Account"
```

to:

```tsx
          <ThemeToggle className="w-9 h-9" />
          <NotesMenu className="w-9 h-9 rounded-full" iconSize={18} onNavTrigger={onNavTrigger} />
        <button
          aria-label="Account"
```

- [ ] **Step 3: MobileNotepadWorkspace — consume context + thread prop**

Add import (after line 32 `import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';`):

```tsx
import { useNavTrigger } from '@/hooks/nav-trigger-context';
```

In the component body (after line 42 `const { showMigration, dismissMigration } = useNotepadFirstLoad();`) add:

```tsx
  const navTrigger = useNavTrigger();
```

Pass it to `<MobileNotesView>` — add after `avatarUrl={profile?.avatarUrl ?? null}` (line 216):

```tsx
            onNavTrigger={navTrigger}
```

Pass it to `<MobileEditorView>` — add after `avatarUrl={profile?.avatarUrl ?? null}` (line 224):

```tsx
            onNavTrigger={navTrigger}
```

- [ ] **Step 4: Verify types + build**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/components/sections/notepad/mobile/MobileNotesView.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx
git commit -m "feat(notes-menu): mount NotesMenu in the mobile notes + editor headers"
```

(Browser verification for placement/theme is done in Task 7.)

---

## Task 5: Suppress the mobile dock on the notes index (TDD predicate)

**Files:**
- Create: `src/routing/notes-route.ts`
- Test: `src/routing/notes-route.test.ts`
- Modify: `src/App.tsx` (AND the predicate into `mobileDockMounted`, line 206)

**Interfaces:**
- Produces: `isNotesWorkspaceIndexPath(pathname: string): boolean` — true for `/notebook/notes` and vanity `/notebook/u/:username` index; false for `/study` children, `/reflections`, the `/notebook` landing, and everything else.

- [ ] **Step 1: Write the failing test**

```ts
// src/routing/notes-route.test.ts
import { describe, it, expect } from 'vitest';
import { isNotesWorkspaceIndexPath } from './notes-route';

describe('isNotesWorkspaceIndexPath', () => {
  it('matches the local notes index', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/notes')).toBe(true);
  });
  it('matches a vanity notes index', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie')).toBe(true);
  });
  it('does NOT match the notes study child', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/notes/study')).toBe(false);
  });
  it('does NOT match a vanity study child', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/study')).toBe(false);
  });
  it('does NOT match vanity reflections', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/reflections')).toBe(false);
  });
  it('does NOT match vanity reflections detail', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/reflections/2026-07')).toBe(false);
  });
  it('does NOT match the notebook landing', () => {
    expect(isNotesWorkspaceIndexPath('/notebook')).toBe(false);
  });
  it('does NOT match home', () => {
    expect(isNotesWorkspaceIndexPath('/home')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/routing/notes-route.test.ts`
Expected: FAIL — cannot resolve `./notes-route`.

- [ ] **Step 3: Write the implementation**

```ts
// src/routing/notes-route.ts
/**
 * True for the notes *workspace index* routes only — the local `/notebook/notes`
 * and a vanity `/notebook/u/:username` (with no further segment) — where
 * NotepadWorkspace mounts and the relocated NotesMenu now provides site
 * navigation. Deliberately excludes the `/study` children, `/reflections`
 * (+ detail), the `/notebook` landing, and everything else, so the mobile
 * bottom dock is suppressed on exactly (and only) the notes workspace.
 */
export function isNotesWorkspaceIndexPath(pathname: string): boolean {
  return pathname === '/notebook/notes' || /^\/notebook\/u\/[^/]+$/.test(pathname);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/routing/notes-route.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire into App.tsx `mobileDockMounted`**

Add import (after line 30 `import { NotepadCompatRedirect } from '@/routing/NotepadCompatRedirect';`):

```tsx
import { isNotesWorkspaceIndexPath } from '@/routing/notes-route';
```

Change `mobileDockMounted` (currently line 206):

```tsx
  const mobileDockMounted = !isLoginPage && !isProfilePage && !isWelcomePage && !isUpdatePasswordPage;
```

to:

```tsx
  // The mobile bottom dock shows across the notepad editor family (study +
  // waymarks) so users keep a way to navigate — EXCEPT the notes workspace
  // index, where the relocated NotesMenu (top-right hamburger) now owns site
  // nav, so the dock is suppressed there to remove the tab-bar/pill collision.
  const mobileDockMounted =
    !isLoginPage &&
    !isProfilePage &&
    !isWelcomePage &&
    !isUpdatePasswordPage &&
    !isNotesWorkspaceIndexPath(location.pathname);
```

- [ ] **Step 6: Verify types + commit**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc -b`
Expected: no errors.

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/routing/notes-route.ts src/routing/notes-route.test.ts src/App.tsx
git commit -m "feat(notes-menu): suppress MobileBottomDock on the notes workspace index"
```

---

## Task 6: Editor bottom-toolbar clearance fix (#85 follow-through)

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileEditorView.tsx` (flip `showBottomDock` off)

**Interfaces:**
- Consumes: `NotepadEditor`'s `showBottomDock` prop. `false` → sticky bottom toolbar sits at `toolbarBottomOffset px` (flush); `true` → lifted by `--mobile-dock-clearance` (Editor.tsx:271-274). With the dock removed on the notes route (Task 5), `false` is correct so the toolbar sits flush above `MobileTabBar` with no dead gap. Study's `MobileStudyEditorView` is out of scope and keeps `showBottomDock`.

- [ ] **Step 1: Flip the prop**

In `MobileEditorView.tsx`, change the `<NotepadEditor>` block (currently lines 78-83):

```tsx
        <NotepadEditor
          onAfterSave={onAfterSave}
          toolbarPlacement="bottom"
          toolbarBottomOffset={keyboardInset}
          showBottomDock
        />
```

to:

```tsx
        <NotepadEditor
          onAfterSave={onAfterSave}
          toolbarPlacement="bottom"
          toolbarBottomOffset={keyboardInset}
          {/* Notes-route dock is suppressed (NotesMenu replaces it) → no dock to
              clear; the bottom toolbar sits flush above MobileTabBar. */}
          showBottomDock={false}
        />
```

(If the inline JSX comment trips the linter, drop it and keep just `showBottomDock={false}` — the intent is captured in the commit message.)

- [ ] **Step 2: Verify types + build**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc -b`
Expected: no errors.

Run existing editor placement tests (unchanged, must still pass — they test the prop at the Editor level directly):
Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/components/Editor.toolbar-placement.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/components/sections/notepad/mobile/MobileEditorView.tsx
git commit -m "fix(notes-menu): flush editor bottom toolbar now that the notes dock is gone"
```

(The flush-vs-gap result is confirmed in the browser in Task 7.)

---

## Task 7: Full verification & gates

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run`
Expected: all green (including the pre-existing suite; note any pre-existing unrelated failure explicitly rather than assuming it's new).

- [ ] **Step 2: Typecheck (project references — MUST use `tsc -b`)**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Lint touched files**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx eslint src/hooks/nav-trigger-context.ts src/hooks/nav-trigger-context.test.tsx src/components/notes-menu/NotesMenu.tsx src/components/notes-menu/NotesMenu.test.tsx src/routing/notes-route.ts src/routing/notes-route.test.ts src/App.tsx src/notepad/components/NotepadToolbar.tsx src/components/sections/notepad/mobile/MobileNotesView.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`
Expected: clean.

- [ ] **Step 4: Browser verification (chrome-devtools MCP) — REQUIRED before any completion claim**

Start the dev server (`npm run dev`; a server may already be on 5173). Then, logged-out where possible, verify the matrix:

**Desktop** (default viewport) at `/notebook/notes`, in **light** and **dark**:
- Hamburger (☰) sits in the toolbar right cluster, immediately left of the avatar/auth controls.
- Click opens a soft dropdown anchored below-right; it lists `Purpose · Notebook · Community · Contact`, a `Social` label, and `Instagram ↗`.
- Popover background/text/border are correct in BOTH themes (readable, not a white-on-white or dark-on-dark box). Toggle the in-app theme and re-open to confirm `.dark` scoping.
- Escape and outside-click both dismiss it.

**Mobile 375×812** (`emulate` device metrics + touch) at `/notebook/notes`, in **light** and **dark**:
- **Notes tab:** header right cluster reads `[flame] [search] [theme] [☰] [avatar]`; ☰ is immediately left of the avatar. Dropdown opens with the same contents/colors.
- **Editor tab:** header right cluster reads `[flame] [theme] [☰] [avatar]`; dropdown works. The editor's sticky bottom formatting toolbar sits **flush above `MobileTabBar`** — NO dead gap, NO overlap. (This is the Task 6 check.)
- **`MobileBottomDock` is GONE** on `/notebook/notes` (no floating `MENU` pill over the tab bar). The `Notes · Editor · Bible · More` tab bar is still present and unchanged.
- **Control route:** navigate to `/notebook` (landing) and confirm `MobileBottomDock` STILL renders there (dock suppression is scoped to the notes index only).

Capture a screenshot of desktop-light, desktop-dark, mobile-notes-dark, and mobile-editor (showing the flush toolbar) as evidence.

- [ ] **Step 5: Report evidence, then finish the branch**

Summarize the gate results (suite counts, `tsc -b` clean, eslint clean) and attach the browser screenshots. Then invoke `superpowers:finishing-a-development-branch` and present merge/PR options. **Do NOT merge or open a PR without Nat's explicit go-ahead.**

---

## Self-Review

**Spec coverage:**
- Decisions 1 (only MENU moves; tab bar stays) → Task 5 (dock suppressed) + Global Constraints (tab bar untouched). ✅
- Decision 2 (contents mirror MENU exactly) → Task 2 (navItems + Social/Instagram). ✅
- Decision 3 (plain hamburger + soft dropdown, no morph) → Task 2 (lucide `Menu`, primitive fade/scale). ✅
- Decision 4 (left of avatar, both platforms) → Tasks 3 (desktop) + 4 (mobile). ✅
- Decision 5 (desktop is an addition) → Task 3. ✅
- Architecture `NotesMenu` on shared primitive, `.dark`-scoped, `onNavTrigger` parity → Tasks 1 + 2. ✅
- Removing the mobile MENU dock via App route flags → Task 5. ✅
- #85 editor-toolbar clearance re-verify → Task 6 + Task 7 browser check. ✅
- Testing: NotesMenu unit tests (aria, open, list, close, nav-trigger) → Task 2; dock-removal proof → Task 5 predicate test + Task 7 browser control-route check; browser matrix → Task 7. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. ✅

**Type consistency:** `isNotesWorkspaceIndexPath` (Task 5) used identically in App. `useNavTrigger()` (Task 1) consumed in Tasks 3 + 4. `NotesMenuProps` fields (`onNavTrigger`, `className`, `align`, `iconSize`) match every call site. `onNavTrigger?: () => void` added to both mobile view prop interfaces and supplied by the workspace. ✅
