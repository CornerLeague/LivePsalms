# Notes-page menu → top-right hamburger dropdown

**Date:** 2026-07-11
**Branch:** `feat/notes-menu-dropdown` (off `origin/main` @ `a88572d`)
**Status:** Approved design — ready for implementation plan.

## Problem

On the `/notebook/notes` notes workspace, the site-wide navigation is presented
as a floating **MENU** pill at the bottom of the mobile viewport
(`MobileBottomDock`). Nat wants that menu moved to a **3-line (hamburger) icon at
the top-right, next to the user profile avatar, opening as a dropdown** — on
**mobile and desktop**. On the notes page it should no longer be a bottom menu
bar. Colors must be correct in **light and dark** mode.

Two distinct bottom elements exist on the mobile notes page and must not be
confused:

- **`MobileTabBar`** — full-width tabs `Notes · Editor · Bible · More` (the
  notepad's own *workspace* navigation).
- **`MobileBottomDock`** — a centered floating pill `logo + MENU` (the
  *site-wide* nav). This is the element labelled "MENU" and the thing being
  relocated.

They currently overlap: the MENU pill floats over the centre of the tab bar.

## Decisions (from brainstorming)

1. **Scope of "the menu":** only the site-nav **MENU** (`MobileBottomDock`)
   moves. The `Notes · Editor · Bible · More` tab bar **stays unchanged.**
2. **Dropdown contents:** mirror today's MENU exactly — `Purpose · Notebook ·
   Community · Contact` (from `navItems`) + a `Social → Instagram` row. Nothing
   added, nothing removed.
3. **Icon + motion:** plain static 3-line hamburger; soft fade/scale dropdown
   below the trigger. No morph-to-X.
4. **Placement:** hamburger immediately **left of the avatar** on both
   platforms.
5. **Desktop is an *addition*:** the desktop notes page has no site-nav menu
   today (the global `<Header>` is not mounted on `/notebook/notes`). The
   hamburger newly gives desktop notes users access to the same links. Nat
   confirmed this is desired.

## Scope

**In scope — the notes workspace only:**

- Route `/notebook/notes` (index) and its vanity equivalent
  `/notebook/u/:username` (index) — both render `NotepadWorkspace`
  (`src/components/sections/Notepad.tsx`), which branches on `useIsMobile()` to
  `DesktopNotepadWorkspace` / `MobileNotepadWorkspace`.

**Out of scope (untouched):**

- Study (`/notebook/notes/study`, `/notebook/u/:username/study`) — a separate
  `StudyWorkspace` with its own `DesktopStudyWorkspace`; `NotepadToolbar` is not
  used there, so a toolbar edit does not leak onto Study.
- Waymarks/Reflections, the `/notebook` landing, and all marketing pages.
- The `MobileTabBar` and the mobile `Bible`/`Lamplight` sub-tab views.

## Architecture

### New component — `NotesMenu`

A single small, self-contained, reusable component used by both platforms.

- **Location:** `src/components/notes-menu/NotesMenu.tsx` (co-located with a test
  file). Final path may be adjusted during planning to match repo conventions.
- **Trigger:** a hamburger `<button>` (`Menu` icon from `lucide-react`), with
  `aria-haspopup="menu"`, `aria-expanded`, and `aria-controls` pointing at the
  panel. `aria-label="Menu"`.
- **Dropdown:** built on the app's existing shared `DropdownMenu` primitive
  (already imported by `NotepadToolbar`), which provides keyboard navigation,
  focus management, Escape/outside-click dismissal, and anchored positioning
  below the trigger. Opening animation is a soft fade/scale (the primitive's
  default, consistent with the app's understated motion).
- **Contents:** iterate `navItems` from `@/data/projects` for the four links,
  then a `Social` row linking to Instagram — mirroring `MobileBottomDock`'s
  current panel. Reuse `NAV_TRIGGER_LABELS` so nav taps fire the loading overlay
  exactly as the dock does today.
- **Props:**
  - `onNavTrigger?: () => void` — fired on tap of a label in
    `NAV_TRIGGER_LABELS` (loading-overlay parity with the dock).
  - `className?` / alignment prop as needed for the two placements.
- **Theme:** all colors driven by `.dark`-scoped tokens/classes (never
  `@media (prefers-color-scheme)`), per the #84 light-mode lesson. Verified in
  both light and dark.

### Placement

- **Mobile** (`src/components/sections/notepad/mobile/MobileNotesView.tsx` and
  `MobileEditorView.tsx`): insert `<NotesMenu … />` into the header's right
  cluster, immediately **left of the avatar** button →
  `[flame] [search?] [theme] [☰] [avatar]`. Pass the workspace's existing
  `onNavTrigger` down (thread from `MobileNotepadWorkspace` if not already
  available).
- **Desktop** (`src/notepad/components/NotepadToolbar.tsx`): insert
  `<NotesMenu … />` into the right cluster immediately **left of
  `<NotepadAuthControls />`** (mounted ~line 226) — symmetric with mobile.

### Removing the mobile MENU dock

- Suppress the **entire `MobileBottomDock`** on the mobile notes route. It only
  holds a redundant logo (already present in the header top-left) plus the MENU
  being relocated. This also removes the current tab-bar/pill visual collision.
- Mechanism: extend App.tsx's existing route flags so `mobileDockMounted`
  excludes the notes workspace route(s). `MobileBottomDock` continues to mount
  everywhere else (home, purpose, `/notebook` landing, study, waymarks, …).
- The `MobileTabBar` is **not** affected — it is rendered inside
  `MobileNotepadWorkspace`, independent of the dock.

### #85 interaction (editor toolbar clearance)

PR #85 mounted `MobileBottomDock` on the editor route and lifted the editor's
sticky bottom toolbar to clear it (`showBottomDock` /
`--mobile-dock-clearance`, referenced in `App.tsx`, `src/index.css`,
`MobileEditorView.tsx`, `Editor.tsx`, `MobileStudyEditorView.tsx`). With the dock
removed on `/notebook/notes`, the editor's bottom toolbar must sit flush above
the `MobileTabBar` with **no leftover clearance gap** on this route. The
implementation will re-verify this in the browser and adjust the
`showBottomDock`/`--mobile-dock-clearance` wiring for the notes route as needed.
(Study's `MobileStudyEditorView` is out of scope and keeps its current
behavior.)

## Data flow

`NotesMenu` is presentational + navigational only. It reads the static
`navItems` / `NAV_TRIGGER_LABELS` constants and renders `<Link>`s; the dropdown
primitive owns open/close state internally. The only external wire is the
optional `onNavTrigger` callback (already threaded to `MobileBottomDock` and to
`NotepadToolbar`'s tree) for loading-overlay parity. No new global state, no new
context, no data fetching.

## Error / edge handling

- **Viewport resize across the 768px breakpoint:** desktop/mobile is a hard
  conditional render (`useIsMobile`), so only one `NotesMenu` instance mounts at
  a time; nothing special required beyond stable hook usage inside `NotesMenu`.
- **Route change while open:** the shared dropdown primitive closes on
  navigation/outside interaction; a `<Link>` tap dismisses it. No manual
  route-change effect needed (unlike the dock's bespoke panel).
- **Signed-out state:** unaffected — the menu contents are static site nav, not
  account-gated.

## Testing

**TDD unit tests** (`NotesMenu.test.tsx`):

- Renders the hamburger trigger with correct aria attributes.
- Opens on click; `aria-expanded` flips to `true`.
- Lists all four `navItems` labels + the Social/Instagram entry.
- Closes on item select, Escape, and outside click.
- Tapping a `NAV_TRIGGER_LABELS` link calls `onNavTrigger`; tapping Social does
  not.

**Integration test:**

- `MobileBottomDock` is **not** rendered on `/notebook/notes` (mobile), and
  **is** still rendered on a control route (e.g. `/notebook` landing).

**Browser verification (chrome-devtools MCP)** — before any completion claim:

- Mobile 375×812 and desktop, in **light and dark**, logged-out where possible.
- Confirm hamburger placement (left of avatar), dropdown open/close, correct
  colors in both themes, all links present, and no toolbar/tab-bar gap on the
  editor tab.

## Gates

`tsc -b` clean · vitest green (new + existing) · eslint clean on touched files ·
browser-verified in light + dark, mobile + desktop.

## Rejected alternatives

- **B — re-anchor the existing bottom-up `.menu-panel` markup to a top-right
  trigger:** less new code but the panel is styled to expand upward from the
  dock; re-purposing it means fighting that CSS. Rejected.
- **C — full consolidation** (fold the tab bar / theme toggle / account into one
  top-right dropdown): contradicts the Q1/Q2 decisions (tab bar stays; contents
  mirror today's MENU). Rejected.
