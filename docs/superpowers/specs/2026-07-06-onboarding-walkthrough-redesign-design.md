# Onboarding Walkthrough Redesign — Design Spec

**Date:** 2026-07-06 · **Status:** Design complete (all 6 sections approved section-by-section), ready for implementation planning · **Feature:** Onboarding tour rebuild — accurate spotlight anchoring on desktop and 375px mobile, Framer Motion polish, rewritten copy, reduced-motion support
**Repo:** `/Users/newmac/Downloads/Psalms_app` · **Provenance:** compiled from a `superpowers:brainstorming` chain (7 locked decisions, 6 approved design sections) grounded in a 4-agent codebase audit of the desktop/mobile workspaces, onboarding lifecycle, and voice guide.

> **This spec is design, not a plan.** It records *what* to build and *why*, at implementation-ready fidelity. The step-by-step build order is produced next by `superpowers:writing-plans`. **No implementation follows from this document directly.**

---

## 0. Summary

The current onboarding tour points at the wrong things — or at nothing. All 5 existing `data-tour` anchors are desktop-only; the mobile tree has **zero** `data-tour` attributes (the root bug), so at 375px the spotlight strands users on a dark scrim. The old tour also narrates a workspace it never touches: it spotlights an empty editor and asks the user to imagine what would be there.

The redesign inverts that: **the tour drives the app**. Each step runs an async *prepare* action that puts the workspace into the state being described — creating and opening a real sample study note, opening the Bible pane, switching mobile tabs — then spotlights the real thing. Nine moments, identical on desktop and 375px mobile, with per-viewport anchors and prepare actions. A new Framer Motion overlay replaces the old SpotlightTour rendering: one persistent cutout that morphs between targets, a step card that travels with it, calm ink-and-paper motion, full `prefers-reduced-motion` support.

**Done when:** every step points at the correct element on every screen, transitions are jank-free, the flow completes/skips/re-triggers cleanly, and it verifies clean at 375×812 in the **visible chrome-devtools browser** (never the hidden Claude_Preview tab).

---

## 1. Product decisions (the locked ledger)

All 7 decisions below are **locked** (brainstorming design-approval gate passed). **Do not re-litigate.** If implementation surfaces a *genuinely new* fork, it is numbered from **8** and raised with the user — not decided silently.

1. **The tour drives the app.** Per-step async prepare actions set up the workspace before the spotlight lands. The tour never points at hypothetical UI.
2. **9-step sequence approved** as storyboarded — all 9 kept, including the graph step (§3 table).
3. **Desktop/mobile parity.** The same 9 moments on both viewports; only anchors and prepare actions differ per viewport.
4. **Trigger/replay unchanged.** Auto-start on first anonymous visit (existing `decideOnboardingActions` flow) + the existing Get Started panel "Replay tour" entry.
5. **Advance model: Next-only.** The tour performs every action itself; the user only clicks Next/Back/arrows. No "do the action to advance" steps.
6. **Sample note is kept after the tour**, clearly titled with an explicit sample marker (e.g. **"A guided study (sample)"**).
7. **Approach A: custom Framer Motion tour engine** (`framer-motion` ^12.38.0, already installed) — not driver.js/react-joyride, not patching the old SpotlightTour.

---

## 2. Architecture (approved — Section 1)

Four units:

### 2.1 `TourEngine` (new)

A small state machine in `src/notepad/onboarding/tour/` owning the step index and a per-step lifecycle: `preparing → anchoring → showing`. Steps are pure data in a rewritten `tour-steps.ts`:

```ts
{ id, copy, placement, anchor(viewport), prepare(workspace) }
```

Handles Next/Back/Skip and keyboard arrows. **Never touches the DOM directly.**

### 2.2 `WorkspaceController` registry (new)

Workspaces register imperative controls on mount. This registry exists because the workspaces are **siblings** of `OnboardingSurfaces` (both mounted at `src/components/sections/Notepad.tsx:344`), and their state is local `useState` — context alone cannot reach it.

- **Desktop registers:** `activeTab` / `graphOpen` (Notepad.tsx:35–37), StudyWindow tab (StudyWindow.tsx:24).
- **Mobile registers:** `setTab` / `moreOpen` (MobileNotepadWorkspace.tsx:43–46).
- **Shared:** `createSampleNote()` — wraps the existing `buildGuidedNote()` template (guided-note-template.ts:3) + `collection.createNote` (note-collection.ts:43) + `openNote` (note-collection.ts:38) — and `scrollTo(anchor)`.

Prepare actions call **only** this interface — no synthetic DOM clicks, ever.

### 2.3 `SpotlightOverlay` (rewrite of SpotlightTour rendering)

One persistent portal overlay: a Framer-Motion-animated mask whose cutout morphs between anchor rects, a step card with fade+slide, a progress indicator, and Skip. Measures targets via `getBoundingClientRect` + `ResizeObserver`; re-measures on scroll and resize.

### 2.4 Kept as-is

- OnboardingProvider lifecycle: `decideOnboardingActions` (onboarding-state.ts:18), `markTourDone` (OnboardingProvider.tsx:249), `replayTour` (OnboardingProvider.tsx:240).
- The onboarding event bus (`emitOnboardingEvent`, onboarding-events.ts:19).
- The anchors contract test (`src/notepad/onboarding/tour/anchors.contract.test.ts`), **extended** to the new mobile tokens.

### 2.5 Flow per step

```
await prepare(workspace)
→ resolve the viewport's anchor token (retry up to ~2s)
→ auto-scroll the owning scroll container
→ overlay morphs to the measured rect
```

A resize across the 768px breakpoint (`useIsMobile`, hooks/use-mobile.ts — matchMedia-reactive; **remounts the whole workspace**, branch at Notepad.tsx:350–353) re-runs the current step's prepare+anchor for the new viewport.

---

## 3. Steps, anchors, prepare actions (approved — Section 2)

| # | Moment | Desktop anchor | Mobile anchor (375px) | Prepare via WorkspaceController |
|---|--------|----------------|----------------------|-------------------------------|
| 0 | Welcome | centered card | centered card | none |
| 1 | Every study starts here | `new-note-sidebar-button` (exists) | `mobile-new-note-fab` **new** | mobile: `setTab('notes')` |
| 2 | The page is yours | `editor-page` **new** | same token **new** | `createSampleNote()` + open; mobile: `setTab('editor')` |
| 3 | Verses become living links | `verse-chip` **new** (template content is ours → chip guaranteed) | same | scroll editor container to chip |
| 4 | Scripture beside your page | `editor-bible-panel` (exists) | `mobile-bible-reader` **new** | desktop: `graphOpen=true` + StudyWindow `'bible'`; mobile: `setTab('bible')` |
| 5 | Mark what speaks to you | `highlight-toolbar` (exists) | shared toolbar token — **VERIFY visible at 375px** at impl | return to editor |
| 6 | Your notebook becomes a map | `studywindow-graph-tab` **new** | `more-sheet-graph` **new** | desktop: StudyWindow `'graph'`; mobile: open More sheet |
| 7 | Meet Lamplight 🕯 | `lamplight-panel-entry` (exists) | `header-flame` **new** | none |
| 8 | Make it yours (finale) | centered card | centered card | none; CTA wires real auth open (fixes existing `onSignUp` no-op TODO) |

**Contract rules:**

- Every token above lands in the anchors contract test — **both viewports**; step↔token drift fails CI.
- Prepare actions are **idempotent** — Back or a viewport switch can never create a second sample note or stack sheets.

**Anchor-placement grounding (from the audit):**

- Mobile bottom tab order is **Notes | Editor | Bible | More** (MobileTabBar.tsx:10–15; buttons at :36).
- Mobile Lamplight is **not** a bottom tab — it's the `HeaderLamplightFlame` icon in the Notes/Editor headers (MobileNotesView.tsx:56/191) → hence the `header-flame` token.
- More is a **modal bottom sheet** (MobileMoreSheet, Backlinks|Info|Graph segments; scroll container at :84), not a tab.
- Mobile new-note is the gold 52px FAB (MobileFabMenu.tsx:132); `effectiveTab` guard at MobileNotepadWorkspace.tsx:56 renders the notes view on the editor tab unless a note is active — step 2's `createSampleNote()` satisfies that guard before the spotlight lands.
- Desktop Decorate button renders only when a note is active (Editor.tsx:431) — step 5 is safe because the sample note is open from step 2 onward.
- Step 5's "return to editor" prepare, made explicit: mobile = `setTab('editor')`; desktop = no-op (the editor is always visible and the sample note is still active from step 2).
- Desktop editor scroll container is `[data-testid="editor-scroll"]` (Editor.tsx:454) — the owning container for step 3's scroll.
- Bible tab defaults to John 1 (BibleStudyPane.tsx:44) — step 4 mobile shows real content with no extra prepare.
- Desktop StudyWindow pane can be zero-width/opacity-0 until `graphOpen` — step 4/6's prepare (`graphOpen=true`) makes the audit's default-state ambiguity moot.

---

## 4. Motion & polish spec (approved — Section 3)

**Personality:** calm, unhurried but crisp — ink-and-paper warmth, not SaaS bounce. Low-bounce springs, custom curves, no overshoot. The delight budget is spent in **one** place.

- **Tour entrance:** scrim fades in ~400ms `ease`; welcome card enters `scale(0.96)` + `opacity 0` + `translateY(8px)` → settled, ~300ms `cubic-bezier(0.23, 1, 0.32, 1)`. Never from `scale(0)`.
- **Spotlight morph:** one persistent cutout (mask rect + radius) animated as a spring `{ type: 'spring', duration: 0.6, bounce: 0.15 }`; **interruptible** — rapid Next retargets mid-flight. The step card travels on the **same spring** — spotlight and card move as one object.
- **Step sequencing:** await prepare → let app panels settle (their own animations finish before measuring) → auto-scroll the owning container ~350ms ease-in-out → then morph. **Never scroll and morph simultaneously.** Total step-transition budget ≤ 800ms.
- **Card content swap:** asymmetric — old copy exits in 150ms (opacity + 2px blur), new copy enters in 250ms ease-out with an 8px rise. The blur masks the crossfade seam.
- **Progress:** 9 dots; the active dot stretches to a pill (200ms ease-out). Next/Skip get `scale(0.97)` on press (160ms).
- **One delight moment:** the Lamplight step's 🕯 flame in the card gets a subtle 2-frame flicker loop. This is the only decoration in the tour.
- **Exit:** complete/skip fades scrim + card in 200ms — exits are always faster than entrances.
- **Reduced motion (`useReducedMotion`):** no travel — the spotlight cross-fades between positions (150ms opacity), the card fades without slide/scale, scrolling jumps instantly, the flicker is off. Opacity transitions stay; movement goes.
- **Performance:** animate only transform/opacity/mask; measured rects drive a hardware-accelerated **full transform string** (NOT Framer Motion `x`/`y` shorthands).

---

## 5. Step copy (approved — Section 4)

Voice: LivePsalms — warm, faith-forward, 2nd person, short sentences, no exclamations, no corporate "we".

| # | Title | Body |
|---|-------|------|
| 0 | The first page is open. | A one-minute walk through your study space. Skip anytime — it will keep. *(Buttons: "Take the walk" / "Skip for now")* |
| 1 | Every study starts here. | Notes, devotions, sermons — each one begins behind this button. |
| 2 | The page is yours. | Here's a sample study, opened so you can see the page at work. Write the way you think — the page keeps up. |
| 3 | Verses become living links. | Type /verse and the passage drops right into your note. Tap one to read it in place. |
| 4 | Scripture beside your page. | **Desktop:** Read and write side by side. The Bible stays open next to your note. / **Mobile:** The whole Bible, one tab away from your note. |
| 5 | Mark what speaks to you. | Highlight in textures that read like real ink. |
| 6 | Your notebook becomes a map. | As notes link to verses and to each other, a map takes shape — of what God keeps drawing you toward. |
| 7 | Meet Lamplight. 🕯 | A companion for the mid-reading question. Ask what a verse means, where a thread leads, what to study next. |
| 8 | Make it yours. | A free account keeps your notes on every device — and lights Lamplight for the road ahead. *(CTA: "Create free account" / secondary: "Not yet — keep exploring")* |

- Step 4 is the **only** per-viewport body variant.
- The sample note's title carries an explicit sample marker, e.g. **"A guided study (sample)"** (locked decision 6).

---

## 6. Error handling & edge cases (approved — Section 5)

- **Missing anchor / failed prepare:** retry for ~2s → skip the step forward and emit a warning via the onboarding event bus. **Never strand the user on a dark scrim.** Skip and Escape always work instantly, regardless of engine state.
- **Idempotent prepare:** the engine caches the sample-note id per run; Back / replay / viewport-switch **reuses** the existing sample note (detected by its template marker) — no duplicates.
- **Viewport switch mid-tour:** the 768px remount unregisters controllers; the engine holds on the scrim, waits for re-registration, then re-runs the current step's prepare+anchor for the new viewport.
- **Layering:** the tour portal is topmost — above the More sheet and above any panel its own prepare opens.
- **Reload mid-tour:** the done-flag is only set on complete/skip (`markTourDone`), so a reload restarts from step 0; the sample-note reuse rule prevents orphan duplicates.

---

## 7. Testing & verification (approved — Section 6)

- **Contract test:** extend `src/notepad/onboarding/tour/anchors.contract.test.ts` to every step token, **both viewports**; drift fails CI.
- **Unit tests:**
  - Engine state machine — `prepare → anchor → show`, skip-on-missing-anchor, idempotency.
  - Controller registry — register/unregister/proxy.
- **Final verification** in the **visible chrome-devtools browser**: every step on desktop and at 375×812 mobile emulation (emulate 375x812x2, mobile, touch, ~1s settle post-reload); complete/skip/replay flows; reduced-motion via emulation. Never the hidden Claude_Preview tab (it auto-pauses media and lies about visibility).
- **Repo conventions:** lint before commit; commit to main. Root `tsc` is a no-op; the deno type-noise class exists — neither is a signal.

---

## 8. Codebase context (audit digest — for the implementation plan)

Facts the plan will lean on, verified during the audit:

- **Entry:** anonymous users land at `/notebook/notes` (App.tsx:293–295; gate NotepadRoutes.tsx:88–105) with zero notes; the editor placeholder already reads "The page is yours." (Editor.tsx:218–234).
- **Tour lifecycle today:** on anon first load, OnboardingProvider reads localStorage `onboarding_anon_tour_done` → `decideOnboardingActions` returns `[start-tour, show-get-started]` (onboarding-state.ts:18); OnboardingSurfaces waits for the loading overlay (OnboardingSurfaces.tsx:135), then portals the tour to `document.body`.
- **Direct APIs available today (🟢):** `collection.createNote(folderId, type)` + `openNote` via `useNoteCollection`; `buildGuidedNote()` sample template exists (guided-note-template.ts:3, already used at Notepad.tsx:334); `markTourDone` / `replayTour`; `emitOnboardingEvent`.
- **State needing the controller registry (🟠, all local `useState`, no context):** desktop `activeTab`+`graphOpen` (Notepad.tsx:35–37), StudyWindow tab (StudyWindow.tsx:24), mobile tab+`moreOpen` (MobileNotepadWorkspace.tsx:43–46; tab state also mirrors to sessionStorage at :43–45/:59–61). The audit also flagged Editor `trayOpen` (Editor.tsx:100), but no step's prepare uses it — it stays **out** of the registry surface (§2.2) unless a future step needs it.
- **Mobile tree has zero `data-tour` attributes** (confirmed) — every mobile token in §3 is net-new.
- **Step 8 CTA** fixes the existing `onSignUp` no-op TODO by wiring the real auth-open action.

## 9. Out of scope

- No changes to the Get Started panel/checklist beyond the existing "Replay tour" entry.
- No changes to the onboarding event bus contract.
- No new dependencies (framer-motion ^12.38.0 is already installed; animejs/gsap stay untouched).
- PR #74 (Waymarks) is unrelated — untouched.
