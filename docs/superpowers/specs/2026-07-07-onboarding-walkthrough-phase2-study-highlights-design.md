# Onboarding Walkthrough — Phase 2: Study pointer + Highlights/Decorations

**Date:** 2026-07-07
**Status:** Design approved (brainstormed with user). Ready for implementation plan.
**Builds on:** the shipped 9-step tour (`docs/superpowers/plans/2026-07-07-onboarding-walkthrough-redesign.md`, live on local `main`). This spec adds two capabilities to that tour.

## Context & scope

The user wants the anonymous onboarding tour to also showcase **Study mode** (deep reading / original languages / etymology) and **highlights + decorations**. A feasibility recon established:

- **None of these features is auth-gated** for anonymous users (unlike Lamplight, which is gated and was therefore dropped). Study mode, the Original-Language lexicon (public-read RLS), highlighting, and the decorations tray all work signed-out.
- **Structural constraint:** the tour host (`OnboardingProvider` + `OnboardingSurfaces`) lives **only in the Journal workspace** (`src/components/sections/Notepad.tsx`). Study is a sibling route (`/notebook/notes/study`) swapped by React Router `<Outlet>`, so **navigating into Study unmounts and kills the tour**. Re-architecting the tour host to survive the route swap was considered and **rejected** (too risky for the just-shipped tour).

**Decisions locked in brainstorming:**
1. Study + Original Language + Etymology are conveyed by a **single "point + describe" step** that spotlights the header **"Study" toggle** and describes what's inside — the tour does **not** enter Study mode. (No `OriginalLanguagePanel` anchor; no route change.)
2. **Lamplight chat demo is dropped** this round — the reworded "Meet Lamplight" step covers it.
3. **Highlights** are shown by **pre-seeding** the sample note with a real highlighted run (robust; no fragile runtime text-selection). We do **not** force-open the selection swatch popover.
4. **Decorations** get their **own new step** that opens the decorations tray and describes it.

**Out of scope:** entering Study mode; the `OriginalLanguagePanel`/lexicon; a signed-out Lamplight chat demo; any Get-Started/checklist changes; PR-#74 (Waymarks) files.

## Resulting tour (11 steps; was 9)

| # | id | change | anchor (desktop / mobile) |
|---|----|--------|---------------------------|
| 0 | welcome | — | centered |
| 1 | create-note | — | new-note-sidebar-button / mobile-new-note-fab |
| 2 | sample-page | — | editor-page |
| 3 | verse-links | — | verse-chip |
| 4 | bible-beside | — | editor-bible-panel / mobile-bible-reader |
| 5 | highlights | **reworded anchor** → `editor-page` (was `highlight-toolbar`); shows the pre-seeded highlight | editor-page |
| 6 | **decorations** | **NEW** — opens the decorations tray | decoration-tray |
| 7 | graph-map | — | studywindow-graph-tab / more-sheet-graph |
| 8 | **study** | **NEW** — point + describe the Study toggle | study-toggle |
| 9 | lamplight | — (already reworded in phase-1) | lamplight-panel-entry / header-flame |
| 10 | make-it-yours | — | centered |

## Design detail

### A. Pre-seed a highlighted run in the sample note
`buildTourSampleNote()` (`src/notepad/onboarding/guided-note/guided-note-template.ts`) builds a stringified TipTap doc. Split the first paragraph's single text node into a **highlighted run + a plain run**, so a real highlight is visibly present when the tour opens the note:

```ts
{ type: 'paragraph', content: [
  { type: 'text', text: 'Grace shows up before we ask.',
    marks: [{ type: 'styleHighlight', attrs: { swatchId: 'highlight-01' } }] },
  { type: 'text', text: ' This page keeps coming back to one verse:' },
]}
```
- Mark schema is authoritative (recon): `styleHighlight` mark, single attr `swatchId`; `'highlight-01'` is a valid bundled static swatch (`src/notepad/styles/manifest.ts`, `category:'highlight'`, ids `highlight-01`…`highlight-125`) served offline from `/styles/highlight/*.webp`. No auth, no network.
- **Idempotency note:** the tour reuses an existing sample note by title, so a *returning* anon user who already has the old (un-highlighted) note won't see the highlight; only newly-created sample notes get it. Acceptable — not worth a migration.

### B. Highlights step (rework, id `highlights`)
- **Anchor:** change from `highlight-toolbar` to **`editor-page`** (existing token on the editor scroll container). Rationale: the recon found the `highlight-toolbar` token sits on the **"Decorate" button, which opens the *decorations* tray — not text highlighting**. Text highlighting is selection-driven and has no toolbar button, so the honest anchor for a highlights step is the editor where the pre-seeded highlight is visible. This frees `highlight-toolbar`/the Decorate button for the decorations step.
- **Copy:** unchanged (`title: 'Mark what speaks to you.'`, `body: 'Highlight in textures that read like real ink.'`). The pre-seeded highlight is the visible example.
- **Prepare:** unchanged — `ensureSampleNoteOpen` (already opens the note; desktop content tab / mobile editor tab).

### C. Decorations step (NEW, id `decorations`, after highlights)
- **Copy:**
  > **Decorate the page.**
  > Drop in stickers, shapes, and marks to make a page feel like yours.
- **Placement/type:** `placement: { desktop: 'top', mobile: 'top' }` (tray sits at the bottom of the editor; card above it). Confirm exact placement against the tray's on-screen position in the plan.
- **Anchor:** new token **`decoration-tray`** on the `DecorationTray` root (`src/notepad/decorations/DecorationTray.tsx`). Same element both viewports (the `Editor` is shared).
- **Prepare:** `ensureSampleNoteOpen` (note open + editor visible: desktop content tab / mobile editor tab) **then** `controls.openDecorationTray?.(true)` — opens the tray so the anchor exists and the decorations are shown.
- **New workspace control:** add `openDecorationTray?: (open: boolean) => void` to `WorkspaceControls` (`workspace-controller.ts`). `Editor.tsx` registers it in an effect → `setTrayOpen(open)` (the `trayOpen` state at `Editor.tsx:100` that the Decorate button toggles). Only one `Editor` is mounted at a time (desktop content tab OR mobile editor tab), so no registry contention.
- **Tray teardown:** subsequent steps (graph-map/study) navigate away from the editor, so the open tray is not visible; leaving it open is acceptable. Optionally the graph-map prepare may call `openDecorationTray?.(false)` for tidiness — plan's call, non-blocking.

### D. Study step (NEW, id `study`, after graph-map — "point + describe")
- **Copy:**
  > **Go deeper in Study.**
  > Flip to Study for close reading — the original Hebrew and Greek behind each verse, word-by-word meanings, and the roots underneath.
  (Covers Study/deep-reading + Original Language + Etymology in one line.)
- **Anchor:** new token **`study-toggle`** on the `StudyModeToggle` root (`<div role="tablist" aria-label="Notepad mode">`, `src/notepad/study/StudyModeToggle.tsx`). One component, rendered in the desktop Journal toolbar (`NotepadToolbar.tsx:92`) and mobile Journal header (`MobileNotepadWorkspace.tsx:199`) — so one token covers both viewports.
- **Placement:** `placement: { desktop: 'bottom', mobile: 'bottom' }` (toggle is in the top header; card below it). Confirm against header position in the plan.
- **Prepare:** desktop — no-op (toggle is always in the header). Mobile — ensure a tab where the header toggle is visible (`mobileSetTab('editor')` expected; confirm the mobile header shows the toggle on that tab in the plan). The tour does **not** click the toggle or enter Study.

### E. New anchor tokens (summary)
- `study-toggle` → `StudyModeToggle.tsx` root div.
- `decoration-tray` → `DecorationTray.tsx` root.
(`highlight-toolbar` remains in `Editor.tsx` on the Decorate button but is no longer referenced by any step; it stays in the source-contract token map.)

## Files to touch

| Action | File | What |
|---|---|---|
| Modify | `src/notepad/onboarding/tour/tour-steps.ts` | +2 steps (decorations, study); highlights anchor → editor-page; `TOUR_ANCHOR_TOKENS` regenerates to 11 |
| Modify | `src/notepad/onboarding/tour/tour-steps.test.ts` | step-id list (11), copy spot-checks (new steps), anchor-token lists (11), prepare-action tests (decorations opens tray; study mobile tab) |
| Modify | `src/notepad/onboarding/tour/anchors.contract.test.ts` | `TOUR_ANCHOR_TOKENS` desktop/mobile lists (11); add `study-toggle`→StudyModeToggle.tsx and `decoration-tray`→DecorationTray.tsx to `TOKEN_SOURCES` |
| Modify | `src/notepad/onboarding/tour/workspace-controller.ts` | add `openDecorationTray?: (open: boolean) => void` |
| Modify | `src/notepad/onboarding/guided-note/guided-note-template.ts` | pre-seed styleHighlight run in `buildTourSampleNote()` |
| Modify | `src/notepad/onboarding/guided-note/tour-sample-note.test.ts` | update doc assertion for the highlighted run |
| Modify | `src/notepad/study/StudyModeToggle.tsx` | `data-tour="study-toggle"` on root div |
| Modify | `src/notepad/decorations/DecorationTray.tsx` | `data-tour="decoration-tray"` on root |
| Modify | `src/notepad/components/Editor.tsx` | register `openDecorationTray` control (effect → setTrayOpen) |

## Global constraints (inherited from the tour)

- No new dependencies; framer-motion only; `animejs` must not appear.
- **Lint must stay at the 124 baseline.** If plan-authored code trips a benign rule, resolve with a targeted `// eslint-disable-next-line` per the established precedent (the user's standing "targeted disable" decision), or fix — do not grow the count.
- **`npx tsc -b` MUST pass (0 errors).** This is the prod build (`tsc -b && vite build`); eslint + vitest do NOT type-check. This gate is mandatory before every commit (the phase-1 build-breaker lesson).
- Test env: pure-data tests (tour-steps, anchors.contract, tour-sample-note) run under the `node` global env — **no jsdom docblock**, do not touch `vitest.config.ts`. Any React/RTL test needs the `// @vitest-environment jsdom` docblock.
- Copy is exact as written above. Commit each task to `main`; do **not** push (origin/main is diverged — reconcile separately).
- Full-suite baseline: only the pre-existing, unrelated `garden-scene.test.tsx` may fail; no new failures.

## Risks / open items (resolve in plan or implementation)

1. **`decoration-tray` anchor resolution:** the tray only exists in the DOM when `trayOpen` is true, and it renders at the bottom of the editor. The decorations prepare must open it *before* anchoring; verify it has a non-zero, settled rect for the anchor-resolver (runtime check in the verification pass).
2. **Mobile Study-toggle visibility:** confirm the mobile Journal header shows `StudyModeToggle` on the tab the study step selects (`mobileSetTab('editor')` assumed).
3. **Decoration-step placement math:** the card must not overlap the tray; confirm `placement` at 375px and desktop in the runtime pass.
4. **Runtime verification** (visible chrome-devtools browser, desktop + 375×812 mobile): the pre-seeded highlight is visible on the highlights step; the decorations step opens + spotlights the tray; the study step spotlights the toggle; both new steps resolve their anchors on both viewports; no skip-forwards; `tsc -b` + full suite + lint gates green.
