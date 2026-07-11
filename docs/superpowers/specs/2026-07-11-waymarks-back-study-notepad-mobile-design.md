# Design — Waymarks back button + Study-notes mobile editor fixes (4 changes)

**Date:** 2026-07-11
**Branch:** `feat/waymarks-back-study-notepad-mobile` (based off `origin/main` = `e09177a`)
**Author:** brainstormed with Nat (approved 2026-07-11)
**Related memory:** `project_reflection_timeline.md` (Waymarks baseline, PR #81 `.wm-root` scroll pattern), `project_psalms_preview_autoplay.md` (use VISIBLE chrome-devtools, not hidden preview tab), `feedback_psalms_workflow.md` (skills pipeline, `tsc -b` mandatory)

## Context

Nat reported 4 mobile UI issues from two iPhone screenshots (Study-notes editor, light; Waymarks list, dark). A parallel read-only code investigation (workflow `wf_ae4bad79-7c0`) mapped all four areas and **found that two of the four are already fixed in the deployed code** — reshaping the task. Nat's decisions: verify #2/#4 live and fix only real gaps; back label "← Notebook"; show the dock on all editor screens (study + journal).

Key facts established (git-confirmed):
- The mobile editor toolbar horizontal-scroll fix (commit `2960aa4`, 2026-06-11) **is an ancestor of `origin/main`** and present in `Editor.tsx:269-270`, with a passing regression test `Editor.mobile-scroll.test.tsx`.
- The study-notes editor and journal editor are the **same component** — `NotepadEditor` in `src/notepad/components/Editor.tsx`. On mobile **both** mount with `toolbarPlacement="bottom"` (study: `MobileStudyEditorView.tsx:30`; journal: `MobileEditorView.tsx:78-82`), so both already get the scroll fix. The only place the toolbar genuinely can't scroll is the **desktop** study side-panel (360px, `top` placement — out of scope).
- The editor body already scrolls vertically: `editor-scroll` container at `Editor.tsx:459-469` has `flex:1; overflowY:'auto'` with a `min-h-0` parent chain, regression-tested.

## Change 1 — Waymarks LIST page back button (REAL WORK)

**Problem:** `WaymarksReflections.tsx` (the "The months you've walked" list) has no back affordance. First element inside the `.wm-root` scroll container is a bare `<header>` (eyebrow `<p class="wm-label">Waymarks</p>` + `<h1 class="wm-title">`).

**Design:** Insert, as the FIRST child inside `.wm-root` (above `<header>`):
```tsx
<Link to=".." className="wm-back wm-label">← Notebook</Link>
```
- Mirrors the detail page's back control exactly (`WaymarksPeriodDetail.tsx:108-110` uses `<Link to=".." className="wm-back wm-label">← Waymarks</Link>`). Same classes → uppercase, silica-grey, `1.5rem` bottom margin, no underline, darkens to umber on hover (`waymarks.css:58, 90-91`). Those classes are NOT detail-scoped, so they apply on the list page unchanged.
- `Link` is already imported in `WaymarksReflections.tsx:2`. No new hook/import needed.
- Label is **"← Notebook"** (not "← Waymarks" — you're already on Waymarks). `to=".."` resolves from `/notebook/u/:username/reflections` → `/notebook/u/:username` = the Notebook/Lamplight workspace, which is exactly where users arrive from (the "Your Reflections" CTA in `LamplightTabPanel`). Mirrors the detail page's own `to=".."` idiom.
- Add the back link to the **ready state** (the main list, JSX ~line 109-124) and the **loading state** (early return ~line 77-83, "Finding your path…") for consistency. The locked state renders `<WaymarksLockedPreview />` (its own component — leave as-is unless it visibly lacks a way back; check during implementation).

**Testing:** TDD unit test — render `WaymarksReflections` (ready state) inside a `MemoryRouter` and assert a link with accessible text "← Notebook" (or the `.wm-back` element) exists and points to the parent route. This is a real render assertion jsdom CAN test.

## Change 2 — Study-notes toolbar horizontal scroll (VERIFY-ONLY)

**Expectation:** already fixed on current main (see Context). A horizontally-scrollable toolbar AT REST looks identical to a clipped one in a static screenshot — the "cut-off S" in Nat's screenshot is the right edge of the visible scroll window; Code/Underline/Sparkles are scrolled off.

**Plan:** Reproduce the mobile study-notes editor in a VISIBLE chrome-devtools browser (mobile emulation). Swipe/drag the bottom toolbar horizontally. If it scrolls to reveal the off-screen buttons → **no code**; capture proof (screenshot before/after scroll, or `scrollLeft` change via evaluate_script). Only if a genuine gap appears (toolbar clips and cannot scroll) do we investigate an ancestor `min-width` issue and fix it in `Editor.tsx`. **Do NOT re-add the fix that's already there.**

## Change 3 — Show the bottom nav dock on ALL editor screens (REAL WORK + stacking)

**Problem:** `MobileBottomDock` (`src/components/layout/MobileBottomDock.tsx`) is hidden on all notepad editor routes. `App.tsx:201`:
```js
const dockMounted = !isNotepadEditor && !isLoginPage && !isProfilePage && !isWelcomePage && !isUpdatePasswordPage;
```
`isNotepadEditor` (App.tsx:183-185) = pathname starts with `/notebook/notes` OR `/notebook/u/` — true for both journal AND study routes. The study-notes "editor" is not a distinct route; it's an in-component toggle (`MobileStudyWorkspace.tsx:52` `editing = !!activeNote`).

**Design:**
1. **Mount the dock on editor routes.** Widen `dockMounted` so it is NOT excluded by `isNotepadEditor` (show on the notepad editor route family). **Critically, leave `isAppShell` (App.tsx:191-196) UNCHANGED** — the app-shell scroll lock (`useAppShellLock(isAppShell)`, `index.css .app-shell-locked`) must stay engaged so the fixed dock overlay has no draggable surface beneath it. Decouple the two booleans; only `dockMounted` changes.
2. **Stacking / clearance.** The dock is `fixed bottom-0 z-40` (`MobileBottomDock.tsx:65-74`, `h-11`=44px pills, `pb-[max(0.75rem,env(safe-area-inset-bottom))]`). The editor's formatting toolbar is `sticky bottom:<keyboardInset>px z-20 height:40` (`Editor.tsx:256-274`) inside the study/journal workspace's own `fixed` stacking context — so the dock (`z-40`, sibling of the workspace under the App wrapper) paints ABOVE the whole workspace and would cover the toolbar. Fix: when the dock is visible and the keyboard is DOWN, lift the editor's sticky toolbar's resting `bottom` and pad the `editor-scroll` bottom by `var(--mobile-dock-clearance)` (`index.css:86-90` = `calc(44px + 0.75rem + env(safe-area-inset-bottom,0px) + 1rem)`) so the toolbar sits ABOVE the dock and content isn't hidden behind either bar.
3. **Keyboard behavior.** Hide the dock while the keyboard is up (`keyboardInset > 0` / `toolbarBottomOffset > 0`), so the lifted toolbar (which rises with the keyboard) doesn't fight a fixed-bottom dock that would be behind the keyboard anyway. The dock already auto-hides on scroll-down and reveals on scroll-up (`useScrollDirection`), which keeps it non-intrusive while writing.

**Implementation seams to resolve in-browser (exact px/mechanism tuned during verification):**
- Where to read `keyboardInset` for the dock's hide condition (the editor already tracks it as `toolbarBottomOffset`/`keyboardInset`; the dock is mounted separately in `App.tsx` — may need a shared signal, a CSS var, or a visualViewport listener in the dock itself).
- Whether to lift the toolbar via `toolbarBottomOffset` default (currently `keyboardInset`, 0 at rest) → make its resting value `var(--mobile-dock-clearance)` when the dock is shown, or add bottom padding on the editor root. Decide by observing overlap in the browser.

**Testing:** mostly CSS/layout → **browser-verified** (jsdom can't do layout/stacking). The `dockMounted` boolean widening can get a light unit/logic test if cleanly extractable.

## Change 4 — Editor body vertical scroll (VERIFY-ONLY)

**Expectation:** already implemented (see Context) — `editor-scroll` has `flex:1; overflowY:'auto'`, parent chain has `min-h-0`, under the app-shell lock the editor supplies its own scroll.

**Plan:** In the same mobile browser session, type/paste a long note into the study-notes editor and confirm the body scrolls vertically to reveal later content (toolbar stays pinned). If it works → **no code**; capture proof. Only fix if it genuinely can't scroll.

## Out of scope (flagged, not doing)
- Desktop study side-panel toolbar (360px, `top` placement, `StudySidePanel.tsx:89`) genuinely clips and can't scroll. Real but separate; Nat didn't ask for it. Leave unless Nat opts in.

## Gates (ALL must pass before "done")
- `npx tsc -b` — exit 0 (MANDATORY; root `tsc --noEmit` is a references no-op).
- `npx vitest run <touched dirs>` — including the new Waymarks back-link test + existing `Editor.mobile-scroll.test.tsx`.
- `npx eslint <touched files>` — repo has ~100 pre-existing lint errors + 1 pre-existing failing test `garden-scene.test.tsx`; don't be alarmed by those.
- Browser verification in a VISIBLE chrome-devtools browser (mobile emulation, both themes). Auth to the study/Waymarks routes needs a Plus user (test-user A `mmagee12@gmail.com`, slug `true_vineyard_5536`); may be OAuth-blocked — if so, verify pure-CSS via harness/local dev and state plainly what wasn't observed live.

## Ship
Commit → push → PR against `main`. **Nat/CornerLeague squash-merges — do NOT self-merge without explicit OK.** Then confirm Vercel prod success + www 200, update memory `project_reflection_timeline.md`, and run `superpowers:finishing-a-development-branch`.

**HARD RULES:** never touch local `main` @ `37be6b7` or `feat/etymology-always-show` @ `08a9699` (no reset/revert/pull). Prefix every Bash call with `cd /Users/newmac/Downloads/Psalms_app`.
