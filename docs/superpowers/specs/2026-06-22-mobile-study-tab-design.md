# Mobile Journal/Study Tab — Design

**Date:** 2026-06-22
**Branch:** feat/notepad-dark-mode
**Status:** Approved (design); pending implementation plan

## Problem

The notepad app has two co-equal modes on desktop — **Journal** (`/notepad/notes`) and
**Study** (`/notepad/notes/study`) — switched by a header `StudyModeToggle`. The Journal
mode has a polished mobile experience (`MobileNotepadWorkspace`, bottom tabs
Notes/Editor/Lamplight/More). **Study mode has no mobile implementation**: the route renders
the desktop-only 3-column `StudyWorkspace` directly for every viewport, so on a phone the
fixed columns (280px apparatus + 360px side panel) crush/overflow the reader. There is also
**no path for a mobile user to cross from Journal into Study at all.**

This design adds a mobile-only Study experience and a mobile bridge between the two modes.
Desktop is untouched.

## Decisions (validated via visual brainstorming)

1. **Entry point — persistent top mode toggle.** A `Journal · Study` pill at the top of the
   notepad mobile app, mirroring desktop's two-mode model. (Rejected: a 5th bottom tab; a
   switch buried in the More sheet.)
2. **Study mode bottom tabs — `Reader · Study · Context`**, where the **Study** tab holds
   **Notes + Chat** behind a segment, mirroring the desktop `StudySidePanel`. (Rejected: four
   flat tabs; an apparatus drawer instead of a tab.)
3. **Opening a note — full-focus editor.** Edge-to-edge, bottom formatting toolbar, back
   chevron; tab bar and top toggle hide while editing. Identical to Journal's
   `MobileEditorView`. (Rejected: keeping the tab bar pinned while editing.)

## Navigation model

- **Top toggle** is a mobile variant of `StudyModeToggle`. It navigates between routes
  (`<Link>`-based, same as desktop): `/notepad/notes` ⇄ `/notepad/notes/study`, and the vanity
  equivalents `/notepad/u/:username` ⇄ `/notepad/u/:username/study`. Mounted at the top of
  **both** the Journal mobile workspace and the new Study mobile workspace. Hidden when the
  full-focus editor is open.
- **Journal mode** — existing `MobileNotepadWorkspace` and its tabs (Notes/Editor/Lamplight/More)
  are **unchanged**, except for mounting the top toggle in its header.
- **Study mode** — new `MobileStudyWorkspace` with a 3-slot bottom `StudyTabBar`:
  - **Reader** — reuses `BibleReader` (already responsive, container-agnostic). Default landing tab.
  - **Study** — a `Notes | Chat` segment (reuse the `Segmented` control pattern):
    - *Notes* — the Study-folder tree (the `StudyNotesTab` / `FolderItem` + `buildFolderTreeView`
      browser rooted at the per-user system "Study" folder via `useEnsureStudyFolder`). Tapping a
      note opens the full-focus editor.
    - *Chat* — `LamplightStudyPanel` (the study chat thread).
  - **Context** — `ApparatusRail` content rendered as a full-screen tab.
- **Full-focus editor** (either mode) — reuse the existing `MobileEditorView` (`NotepadEditor`
  with `toolbarPlacement="bottom"`, `useKeyboardInset`), with a back chevron returning to the
  originating list (Journal Notes tab, or Study → Notes segment).

## Components

**New (all under `src/notepad/study/mobile/`):**
- `MobileStudyWorkspace.tsx` — full-screen `fixed inset-0` column: top toggle + active tab body +
  bottom `StudyTabBar`. Mirrors `MobileNotepadWorkspace` structure.
- `StudyTabBar.tsx` — 3 slots (Reader / Study / Context). Tab union type
  `'reader' | 'study' | 'context'`.
- `StudyReaderView.tsx` — header + `BibleReader`.
- `StudyPanelView.tsx` — `Notes | Chat` segment wrapping the Study-folder tree and
  `LamplightStudyPanel`; opens the full-focus editor on note tap.
- `StudyContextView.tsx` — header + `ApparatusRail` content.
- `MobileStudyModeToggle.tsx` (or extend `StudyModeToggle` with a mobile variant) — the top
  `Journal · Study` pill.

**Modified:**
- `src/notepad/study/StudyWorkspace.tsx` — branch on `useIsMobile()` to render
  `MobileStudyWorkspace` on phones, keeping the existing desktop 3-column layout otherwise
  (same pattern as `NotepadWorkspace` in `src/components/sections/Notepad.tsx:321`).
- `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` — mount the top toggle in
  its header.

**Reused as-is:** `BibleReader`, `ApparatusRail`, `StudyNotesTab` / folder-tree internals,
`LamplightStudyPanel`, `NotepadEditor` / `MobileEditorView`, `Segmented`, `NotepadProvider`
(the layout route already wraps both routes so toggling does not remount the notes data layer),
`useEnsureStudyFolder`, `useKeyboardInset`.

## State & behavior

- Default Study tab = **Reader**; Study panel segment defaults to **Notes**.
- Persist active Study tab + panel segment to session storage (mirror the existing
  `KEY_MOBILE_TAB` approach in `MobileNotepadWorkspace`). Each mode remembers its last-active tab
  across toggles.
- The App-shell `Header` and `MobileBottomDock` are already not mounted on `/notepad/notes*` and
  `/notepad/u/*` routes (`dockMounted` flag in `App.tsx`), and `useAppShellLock` is already active
  there — no conflict; the new workspace supplies its own chrome.
- Top toggle hidden whenever the full-focus editor is active (consistent in both modes).

## Out of scope

- Any change to the desktop Study or Journal layouts.
- New verse→note authoring affordances in the mobile reader (reader is reused as-is).
- A "More" tab in Study mode (Graph/Backlinks remain Journal-side concepts).

## Acceptance criteria

- On a <768px viewport, visiting `/notepad/notes/study` (and the vanity equivalent) renders the
  mobile Study workspace, not the crushed desktop columns.
- The top `Journal · Study` toggle is reachable from both modes and navigates between routes
  without remounting the notes data layer.
- Study mode exposes Reader, a Notes|Chat segment, and Context (apparatus); opening a note shows
  the full-focus editor with a working back path.
- Desktop behavior at ≥768px is unchanged.
- No new lint/tsc/test failures beyond the documented pre-existing red baseline.
