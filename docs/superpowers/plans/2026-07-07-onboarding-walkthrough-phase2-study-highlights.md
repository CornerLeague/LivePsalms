# Onboarding Walkthrough Phase 2 — Study pointer + Highlights/Decorations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the anonymous onboarding tour from 9 to 11 steps — pre-seed a real highlight and add a Decorations step (opens the decorations tray), plus a Study "point + describe" step spotlighting the header Study toggle.

**Architecture:** Pure-data tour steps (`tour-steps.ts`) drive the app through the module-singleton `WorkspaceControls` registry and resolve `data-tour` anchor tokens in the DOM. This phase adds one new control (`openDecorationTray`), two new anchor tokens (`decoration-tray`, `study-toggle`), a pre-seeded `styleHighlight` mark in the sample note, and two new step objects. The tour never leaves the Journal view (entering Study would unmount the tour host).

**Tech Stack:** React, TypeScript, TipTap (editor + marks), Framer Motion (overlay — untouched here), Vitest (node env for pure-data tests).

**Spec:** `docs/superpowers/specs/2026-07-07-onboarding-walkthrough-phase2-study-highlights-design.md`

## Global Constraints

- Working dir: `/Users/newmac/Downloads/Psalms_app`. Bash cwd drifts to `~/Desktop` — always `cd /Users/newmac/Downloads/Psalms_app &&` or absolute paths.
- Commit each task to `main`. Do **NOT** push (origin/main is diverged — reconcile separately). Before each commit run `git branch --show-current` — it MUST print `main`; if not, STOP.
- **Lint must stay at the 124 baseline.** Verify `npm run lint 2>&1 | grep -cE "^\s+[0-9]+:[0-9]+\s+error"` → `124`. If plan-authored code trips a benign rule, add a targeted `// eslint-disable-next-line <rule>` (established precedent) — do not grow the count.
- **`npx tsc -b` MUST print 0 errors before every commit.** This is the prod build (`tsc -b && vite build`); eslint + vitest do NOT type-check. MANDATORY gate.
- `npm test` = `vitest run`. Pure-data tests (`tour-steps.test.ts`, `anchors.contract.test.ts`, `tour-sample-note.test.ts`) run under the **node** global env — do NOT add a jsdom docblock, do NOT touch `vitest.config.ts`.
- Full-suite baseline: only the pre-existing, unrelated `garden-scene.test.tsx` may fail; no NEW failures.
- No new dependencies; `animejs` must not appear. Copy strings are EXACT as written below.

---

### Task 1: Pre-seed a highlighted run in the sample note

**Files:**
- Modify: `src/notepad/onboarding/guided-note/guided-note-template.ts` (inside `buildTourSampleNote()`, the first paragraph's text node)
- Test: `src/notepad/onboarding/guided-note/tour-sample-note.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildTourSampleNote()` return unchanged in shape (`{ title, content }`); `content` now contains a `styleHighlight` mark (`{ swatchId: 'highlight-01' }`) on the first sentence.

- [ ] **Step 1: Add the failing test**

In `src/notepad/onboarding/guided-note/tour-sample-note.test.ts`, extend the `DocNode` interface to include marks and add a new `it(...)` inside the existing `describe('buildTourSampleNote', ...)`:

```ts
// extend the existing DocNode interface (add the marks field):
interface DocNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: DocNode[];
}

// add this test inside the describe block:
it('pre-seeds exactly one styleHighlight run (swatch highlight-01) for the highlights step', () => {
  const doc = JSON.parse(buildTourSampleNote().content) as DocNode;
  const marks = (doc.content ?? [])
    .flatMap((p) => p.content ?? [])
    .flatMap((node) => node.marks ?? []);
  const highlights = marks.filter((m) => m.type === 'styleHighlight');
  expect(highlights).toHaveLength(1);
  expect(highlights[0].attrs).toEqual({ swatchId: 'highlight-01' });
});
```

(If the file's existing `DocNode` interface already lacks `text`/`marks`, replace it with the version above. Keep the existing scriptureRef test unchanged.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/guided-note/tour-sample-note.test.ts`
Expected: FAIL — the new test finds 0 styleHighlight marks.

- [ ] **Step 3: Pre-seed the highlight in the builder**

In `src/notepad/onboarding/guided-note/guided-note-template.ts`, inside `buildTourSampleNote()`, the first paragraph is currently a single text node:

```ts
{
  type: 'paragraph',
  content: [
    {
      type: 'text',
      text: 'Grace shows up before we ask. This page keeps coming back to one verse:',
    },
  ],
},
```

Replace that first paragraph's `content` array with a highlighted run + a plain run:

```ts
{
  type: 'paragraph',
  content: [
    {
      type: 'text',
      text: 'Grace shows up before we ask.',
      marks: [{ type: 'styleHighlight', attrs: { swatchId: 'highlight-01' } }],
    },
    {
      type: 'text',
      text: ' This page keeps coming back to one verse:',
    },
  ],
},
```

Leave the scriptureRef paragraph and the closing paragraph exactly as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/guided-note/`
Expected: PASS — both the existing scriptureRef test and the new highlight test.

- [ ] **Step 5: Gates + commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && npx tsc -b 2>&1 | grep -cE "error TS"   # must be 0
npm run lint 2>&1 | grep -cE "^\s+[0-9]+:[0-9]+\s+error"                          # must be 124
git branch --show-current                                                        # must be main
git add src/notepad/onboarding/guided-note/guided-note-template.ts src/notepad/onboarding/guided-note/tour-sample-note.test.ts && git commit -m "feat(tour): pre-seed a styleHighlight run in the sample note for the highlights step"
```

---

### Task 2: New anchors + `openDecorationTray` control

**Files:**
- Modify: `src/notepad/onboarding/tour/workspace-controller.ts` (add `openDecorationTray` to `WorkspaceControls`)
- Modify: `src/notepad/study/StudyModeToggle.tsx` (`data-tour="study-toggle"`)
- Modify: `src/notepad/decorations/DecorationTray.tsx` (`data-tour="decoration-tray"`)
- Modify: `src/notepad/components/Editor.tsx` (register `openDecorationTray`)
- Test: `src/notepad/onboarding/tour/anchors.contract.test.ts` (source-contract for the two new tokens)

**Interfaces:**
- Consumes: `registerWorkspaceControls` (existing).
- Produces: `WorkspaceControls.openDecorationTray?: (open: boolean) => void`; DOM tokens `study-toggle`, `decoration-tray`.

- [ ] **Step 1: Add the failing source-contract assertions**

In `src/notepad/onboarding/tour/anchors.contract.test.ts`, add two entries to the existing `TOKEN_SOURCES` map (the `Record<string,string>` used by the `it.each` source-contract test):

```ts
  'study-toggle': 'src/notepad/study/StudyModeToggle.tsx',
  'decoration-tray': 'src/notepad/decorations/DecorationTray.tsx',
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/anchors.contract.test.ts`
Expected: FAIL — the two new tokens are not yet present in their source files.

- [ ] **Step 3: Add the `openDecorationTray` control to the interface**

In `src/notepad/onboarding/tour/workspace-controller.ts`, add to the `WorkspaceControls` interface (in the desktop/shared area, alongside the other editor-facing controls):

```ts
  /** Opens/closes the decorations tray in the active editor (both viewports). */
  openDecorationTray?: (open: boolean) => void;
```

- [ ] **Step 4: Add the two `data-tour` anchors**

In `src/notepad/study/StudyModeToggle.tsx`, add `data-tour="study-toggle"` to the root `<div role="tablist" ...>`:

```tsx
    <div role="tablist" aria-label="Notepad mode" data-tour="study-toggle" style={{ display: 'flex', gap: 2 }}>
```

In `src/notepad/decorations/DecorationTray.tsx`, add `data-tour="decoration-tray"` to the tray's root element (the outermost element of the returned JSX — it carries `role="dialog"`). Add only the attribute; keep every existing prop:

```tsx
    <div ... role="dialog" data-tour="decoration-tray" ...>
```
(Locate the root element by reading the file; add the attribute to the outermost returned element, nothing else.)

- [ ] **Step 5: Register the control in the Editor**

In `src/notepad/components/Editor.tsx`, ensure `useEffect` and `registerWorkspaceControls` are imported:

```ts
import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';
```

Then, inside the editor component next to the other effects (after the `const [trayOpen, setTrayOpen] = useState(false)` declaration, ~:100), add:

```tsx
  useEffect(() => {
    return registerWorkspaceControls({
      openDecorationTray: (open) => setTrayOpen(open),
    });
  }, []);
```

(`setTrayOpen` is a stable state setter, so the empty dependency array is exhaustive-deps-clean. The effect body only registers a callback — no synchronous setState — so `react-hooks/set-state-in-effect` does not apply.)

- [ ] **Step 6: Run the contract test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/anchors.contract.test.ts`
Expected: PASS — the two new tokens resolve in their source files (plus the existing token/step assertions unchanged for now).

- [ ] **Step 7: Full suite + gates + commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && npm test 2>&1 | grep -E "Test Files|Tests "   # only garden-scene fails
npx tsc -b 2>&1 | grep -cE "error TS"                                                    # must be 0
npm run lint 2>&1 | grep -cE "^\s+[0-9]+:[0-9]+\s+error"                                  # must be 124 (if a new error appears on Editor.tsx from the effect, STOP and report it — do not guess-fix)
git branch --show-current                                                                 # must be main
git add src/notepad/onboarding/tour/workspace-controller.ts src/notepad/study/StudyModeToggle.tsx src/notepad/decorations/DecorationTray.tsx src/notepad/components/Editor.tsx src/notepad/onboarding/tour/anchors.contract.test.ts && git commit -m "feat(tour): add study-toggle + decoration-tray anchors and openDecorationTray control"
```

---

### Task 3: Add the decorations + study steps (tour-steps cutover)

**Files:**
- Modify: `src/notepad/onboarding/tour/tour-steps.ts` (insert 2 steps; change highlights anchor)
- Test (replace): `src/notepad/onboarding/tour/tour-steps.test.ts`
- Test (extend): `src/notepad/onboarding/tour/anchors.contract.test.ts` (the two `TOUR_ANCHOR_TOKENS` step↔token list assertions → 11 entries)

**Interfaces:**
- Consumes: `openDecorationTray` (Task 2); the pre-seeded highlight (Task 1); `ensureSampleNoteOpen` (existing helper in tour-steps.ts); tokens `decoration-tray`, `study-toggle` (Task 2).
- Produces: `TOUR_STEPS` (11 entries); `TOUR_ANCHOR_TOKENS` regenerates automatically (it is `TOUR_STEPS.map((s) => s.anchor(viewport))`).

- [ ] **Step 1: Replace the steps test (fails against the current 9-step module)**

Replace the ENTIRE contents of `src/notepad/onboarding/tour/tour-steps.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { TourRunContext } from './tour-engine';
import { TOUR_ANCHOR_TOKENS, TOUR_STEPS } from './tour-steps';

function makeCtx(viewport: 'desktop' | 'mobile', sampleNoteId: string | null = null): TourRunContext {
  return { viewport, sampleNoteId };
}

describe('TOUR_STEPS', () => {
  it('has the eleven approved moments in order', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      'welcome',
      'create-note',
      'sample-page',
      'verse-links',
      'bible-beside',
      'highlights',
      'decorations',
      'graph-map',
      'study',
      'lamplight',
      'make-it-yours',
    ]);
  });

  it('uses the approved copy verbatim (spot checks)', () => {
    expect(TOUR_STEPS[0].copy.title).toBe('The first page is open.');
    expect(TOUR_STEPS[0].copy.body).toBe(
      'A one-minute walk through your study space. Skip anytime — it will keep.',
    );
    expect(TOUR_STEPS[3].copy.body).toBe(
      'Type /verse to drop in a passage by reference, or /lookup to find one by the words you remember. Tap any verse to read it in place.',
    );
    expect(TOUR_STEPS[6].copy.title).toBe('Decorate the page.');
    expect(TOUR_STEPS[6].copy.body).toBe(
      'Drop in stickers, shapes, and marks to make a page feel like yours.',
    );
    expect(TOUR_STEPS[7].copy.body).toBe(
      'As notes link to verses and to each other, a map takes shape — showing how God pieces your story together.',
    );
    expect(TOUR_STEPS[8].copy.title).toBe('Go deeper in Study.');
    expect(TOUR_STEPS[8].copy.body).toBe(
      'Flip to Study for close reading — the original Hebrew and Greek behind each verse, word-by-word meanings, and the roots underneath.',
    );
    expect(TOUR_STEPS[9].copy.title).toBe('Meet Lamplight. 🕯');
    expect(TOUR_STEPS[9].copy.body).toBe(
      'A companion for the mid-reading questions, your journey reflections, scripture study plans, and much more.',
    );
    expect(TOUR_STEPS[10].copy.body).toBe(
      'A free account keeps your notes on every device — and lights Lamplight for the road ahead.',
    );
  });

  it('bible-beside is the only step with per-viewport body copy', () => {
    const dual = TOUR_STEPS.filter((step) => typeof step.copy.body !== 'string');
    expect(dual.map((step) => step.id)).toEqual(['bible-beside']);
  });

  it('exposes the per-viewport anchor token lists', () => {
    expect(TOUR_ANCHOR_TOKENS.desktop).toEqual([
      null,
      'new-note-sidebar-button',
      'editor-page',
      'verse-chip',
      'editor-bible-panel',
      'editor-page',
      'decoration-tray',
      'studywindow-graph-tab',
      'study-toggle',
      'lamplight-panel-entry',
      null,
    ]);
    expect(TOUR_ANCHOR_TOKENS.mobile).toEqual([
      null,
      'mobile-new-note-fab',
      'editor-page',
      'verse-chip',
      'mobile-bible-reader',
      'editor-page',
      'decoration-tray',
      'more-sheet-graph',
      'study-toggle',
      'header-flame',
      null,
    ]);
  });

  describe('prepare actions (registry-only, idempotent)', () => {
    it('step 1 mobile switches to the notes tab; desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[1].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('notes');
      mobileSetTab.mockClear();
      await TOUR_STEPS[1].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('step 2 creates the sample note once, caches the id, and reuses it after', async () => {
      const createSampleNote = vi.fn(async () => 'sample-1');
      const openNote = vi.fn();
      const ctx = makeCtx('desktop');
      await TOUR_STEPS[2].prepare?.({ createSampleNote, openNote }, ctx);
      expect(createSampleNote).toHaveBeenCalledTimes(1);
      expect(ctx.sampleNoteId).toBe('sample-1');
      await TOUR_STEPS[2].prepare?.({ createSampleNote, openNote }, ctx);
      expect(createSampleNote).toHaveBeenCalledTimes(1);
      expect(openNote).toHaveBeenCalledWith('sample-1');
    });

    it('steps 2, 3, 5 activate the desktop content tab so the editor anchors mount', async () => {
      for (const index of [2, 3, 5]) {
        const openNote = vi.fn();
        const desktopSetActiveTab = vi.fn();
        await TOUR_STEPS[index].prepare?.({ openNote, desktopSetActiveTab }, makeCtx('desktop', 'sample-1'));
        expect(desktopSetActiveTab).toHaveBeenCalledWith('content');
      }
    });

    it('steps 3 and 5 ensure the sample note on mobile (openNote + editor tab)', async () => {
      for (const index of [3, 5]) {
        const openNote = vi.fn();
        const mobileSetTab = vi.fn();
        await TOUR_STEPS[index].prepare?.({ openNote, mobileSetTab }, makeCtx('mobile', 'sample-1'));
        expect(openNote).toHaveBeenCalledWith('sample-1');
        expect(mobileSetTab).toHaveBeenCalledWith('editor');
      }
    });

    it('step 4 desktop opens the study pane on Bible; mobile switches tabs', async () => {
      const desktopSetGraphOpen = vi.fn();
      const desktopSetStudyTab = vi.fn();
      await TOUR_STEPS[4].prepare?.({ desktopSetGraphOpen, desktopSetStudyTab }, makeCtx('desktop'));
      expect(desktopSetGraphOpen).toHaveBeenCalledWith(true);
      expect(desktopSetStudyTab).toHaveBeenCalledWith('bible');
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[4].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('bible');
    });

    it('step 6 (decorations) ensures the note then opens the decoration tray', async () => {
      const openNote = vi.fn();
      const desktopSetActiveTab = vi.fn();
      const openDecorationTray = vi.fn();
      await TOUR_STEPS[6].prepare?.(
        { openNote, desktopSetActiveTab, openDecorationTray },
        makeCtx('desktop', 'sample-1'),
      );
      expect(desktopSetActiveTab).toHaveBeenCalledWith('content');
      expect(openDecorationTray).toHaveBeenCalledWith(true);
      const mobileSetTab = vi.fn();
      const openDecorationTray2 = vi.fn();
      await TOUR_STEPS[6].prepare?.(
        { openNote: vi.fn(), mobileSetTab, openDecorationTray: openDecorationTray2 },
        makeCtx('mobile', 'sample-1'),
      );
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      expect(openDecorationTray2).toHaveBeenCalledWith(true);
    });

    it('step 7 desktop shows the Graph tab; mobile opens the More sheet on Graph', async () => {
      const desktopSetGraphOpen = vi.fn();
      const desktopSetStudyTab = vi.fn();
      await TOUR_STEPS[7].prepare?.({ desktopSetGraphOpen, desktopSetStudyTab }, makeCtx('desktop'));
      expect(desktopSetGraphOpen).toHaveBeenCalledWith(true);
      expect(desktopSetStudyTab).toHaveBeenCalledWith('graph');
      const mobileOpenMoreSheet = vi.fn();
      await TOUR_STEPS[7].prepare?.({ mobileOpenMoreSheet }, makeCtx('mobile'));
      expect(mobileOpenMoreSheet).toHaveBeenCalledWith('graph');
    });

    it('step 8 (study) switches to the editor tab on mobile so the header toggle shows; desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[8].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      mobileSetTab.mockClear();
      await TOUR_STEPS[8].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('step 9 mobile returns to the editor tab (closes the More sheet); desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[9].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      mobileSetTab.mockClear();
      await TOUR_STEPS[9].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('steps 0 and 10 are centered with no prepare', () => {
      expect(TOUR_STEPS[0].anchor('desktop')).toBeNull();
      expect(TOUR_STEPS[0].prepare).toBeUndefined();
      expect(TOUR_STEPS[10].anchor('mobile')).toBeNull();
      expect(TOUR_STEPS[10].prepare).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/tour-steps.test.ts`
Expected: FAIL — current module has 9 steps, no `decorations`/`study`, and `highlights` still anchors `highlight-toolbar`.

- [ ] **Step 3: Edit `tour-steps.ts` — change the highlights anchor**

In `src/notepad/onboarding/tour/tour-steps.ts`, in the `highlights` step object, change the anchor line from:

```ts
    anchor: () => 'highlight-toolbar',
```
to:
```ts
    anchor: () => 'editor-page',
```
Leave the `highlights` step's copy and `prepare: ensureSampleNoteOpen` unchanged.

- [ ] **Step 4: Edit `tour-steps.ts` — insert the `decorations` step**

Immediately AFTER the `highlights` step object (and before the `graph-map` step object) in the `TOUR_STEPS` array, insert:

```ts
  {
    id: 'decorations',
    placement: { desktop: 'top', mobile: 'top' },
    copy: {
      title: 'Decorate the page.',
      body: 'Drop in stickers, shapes, and marks to make a page feel like yours.',
    },
    anchor: () => 'decoration-tray',
    // Open the decorations tray (idempotent note-ensure first, so the editor is
    // mounted and the tray has a note to attach to), then reveal it.
    prepare: async (controls, ctx) => {
      await ensureSampleNoteOpen(controls, ctx);
      controls.openDecorationTray?.(true);
    },
  },
```

- [ ] **Step 5: Edit `tour-steps.ts` — insert the `study` step**

Immediately AFTER the `graph-map` step object (and before the `lamplight` step object), insert:

```ts
  {
    id: 'study',
    placement: { desktop: 'bottom', mobile: 'bottom' },
    copy: {
      title: 'Go deeper in Study.',
      body: 'Flip to Study for close reading — the original Hebrew and Greek behind each verse, word-by-word meanings, and the roots underneath.',
    },
    anchor: () => 'study-toggle',
    // Point + describe only — the tour never enters Study (that route unmounts
    // the tour host). Mobile switches to the editor tab so the header toggle is
    // on-screen; desktop toggle is always in the header.
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
    },
  },
```

(`TOUR_ANCHOR_TOKENS` at the bottom of the file is `TOUR_STEPS.map((step) => step.anchor(...))` — it regenerates automatically; do NOT hand-edit it.)

- [ ] **Step 6: Run the steps test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/tour-steps.test.ts`
Expected: PASS (all assertions, 11 steps).

- [ ] **Step 7: Update the anchors-contract step↔token lists**

In `src/notepad/onboarding/tour/anchors.contract.test.ts`, the `describe('tour anchors contract — step ↔ token lists ...')` block asserts `TOUR_ANCHOR_TOKENS.desktop` / `.mobile` (currently 9 entries each). Replace BOTH arrays with the 11-entry versions (identical to Task 3 Step 1's `exposes the per-viewport anchor token lists` arrays):

```ts
  // desktop:
  [ null, 'new-note-sidebar-button', 'editor-page', 'verse-chip', 'editor-bible-panel',
    'editor-page', 'decoration-tray', 'studywindow-graph-tab', 'study-toggle',
    'lamplight-panel-entry', null ]
  // mobile:
  [ null, 'mobile-new-note-fab', 'editor-page', 'verse-chip', 'mobile-bible-reader',
    'editor-page', 'decoration-tray', 'more-sheet-graph', 'study-toggle',
    'header-flame', null ]
```

- [ ] **Step 8: Run the full suite + gates + commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && npm test 2>&1 | grep -E "Test Files|Tests "   # only garden-scene fails
npx tsc -b 2>&1 | grep -cE "error TS"                                                    # must be 0
npm run lint 2>&1 | grep -cE "^\s+[0-9]+:[0-9]+\s+error"                                  # must be 124
git branch --show-current                                                                 # must be main
git add src/notepad/onboarding/tour/tour-steps.ts src/notepad/onboarding/tour/tour-steps.test.ts src/notepad/onboarding/tour/anchors.contract.test.ts && git commit -m "feat(tour): add decorations + study steps (11-step tour)"
```

---

### Task 4: Runtime verification (visible chrome-devtools browser)

**Files:** none (verification; fixes route back to the owning task).

This runs in the **visible chrome-devtools browser** (or the preview tab if already open), NEVER assumed from unit tests alone. Dev server: `npm run dev` (background) → `http://localhost:5173/notebook/notes` (anonymous notebook). Reset the tour between passes: in the console, `localStorage.removeItem('onboarding_anon_tour_done'); localStorage.removeItem('onboarding_anon_checklist'); location.reload();`

- [ ] **Step 1: Gate check** — `npm test` (only garden-scene fails), `npm run lint` → 124, `npx tsc -b` → 0, `npm run build` → succeeds.

- [ ] **Step 2: Desktop pass (resize ≥ 768px wide)** — reset + reload; step through:
  - [ ] Step 6 (highlights) shows the sample note with **"Grace shows up before we ask." visibly highlighted**; card copy "Mark what speaks to you."
  - [ ] Step 7 (decorations) — the **decorations tray opens** and is spotlighted; card "Decorate the page."
  - [ ] Step 9 (study) — the **"Study" toggle in the header is spotlighted**; card "Go deeper in Study." The tour does NOT navigate to /study.
  - [ ] The other 8 steps still resolve their anchors; no skip-forwards; finale CTA → /login.

- [ ] **Step 3: Mobile pass (emulate 375×812×2, mobile, touch; ~1s settle)** — reset + reload:
  - [ ] Highlights step shows the highlighted line on the editor tab.
  - [ ] Decorations step opens the tray on the editor tab and spotlights it (visible at 375px).
  - [ ] Study step switches to the editor tab and spotlights the header Study toggle.

- [ ] **Step 4: If any check fails**, route the fix back to the owning task's files, re-run `npm test` + `tsc -b` + lint, and commit with a `fix(tour): …` message. Do NOT push.

---

## Self-review

- **Spec coverage:** Study pointer step → Task 3 (study step + study-toggle anchor Task 2). Highlights pre-seed → Task 1. Highlights re-anchor → Task 3. Decorations step + tray control/anchor → Tasks 2+3. All 9 spec files covered across Tasks 1–3; runtime → Task 4. Original Language/Etymology is folded into the study step's copy (no separate step, per the "point + describe" decision) — covered. Lamplight chat demo — correctly absent (dropped).
- **Placeholder scan:** every code step has complete code; the two DecorationTray/Editor landmark edits name the exact attribute/effect to add and where. No TBDs.
- **Type consistency:** `openDecorationTray?: (open: boolean) => void` defined in Task 2, consumed in Task 3's decorations prepare and the test. `ensureSampleNoteOpen` reused (existing). Step indices in the Task-3 test match the 11-step order (welcome 0 … make-it-yours 10; decorations 6, graph-map 7, study 8, lamplight 9). `TOUR_ANCHOR_TOKENS` is derived, not hand-edited. Anchor token lists identical between `tour-steps.test.ts` and `anchors.contract.test.ts`.
