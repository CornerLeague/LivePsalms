# Onboarding Walkthrough Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken onboarding tour with a 9-step, dual-viewport (desktop + 375px mobile) walkthrough that drives the app via prepare actions and renders through a new Framer Motion spotlight overlay.

**Architecture:** Four units per the spec: a DOM-free `TourEngine` state machine, a `WorkspaceController` module-singleton registry (workspaces register imperative controls on mount), a rewritten pure-data `tour-steps.ts`, and a Framer Motion `SpotlightOverlay` (one persistent morphing cutout + travelling card). The existing OnboardingProvider lifecycle, event bus, and trigger/replay flow are kept as-is.

**Tech Stack:** React 18 + TypeScript + Vite, framer-motion ^12.38.0 (already installed), vitest 4 + @testing-library/react ^16.3.2 (colocated `*.test.ts(x)`), TipTap (scriptureRef node).

**Spec (single source of truth):** `docs/superpowers/specs/2026-07-06-onboarding-walkthrough-redesign-design.md` (main @ 7de6f24). All 7 decisions are locked; genuinely new forks are numbered from 8 and raised with the user.

## Global Constraints

- Working dir: `/Users/newmac/Downloads/Psalms_app`. Bash cwd can revert to `~/Desktop` — always `cd /Users/newmac/Downloads/Psalms_app &&` or use absolute paths.
- Commit each task to `main`. Do **NOT** push. Lint before every commit.
- `npm run lint` has **124 pre-existing errors in src/ (known noise)** — introduce ZERO new ones. Verify with `npm run lint 2>&1 | grep -cE "^\s+[0-9]+:[0-9]+\s+error"` (baseline the count once before Task 1; it must not grow, and no error may reference a file you touched).
- `npm test` = `vitest run`. Root `tsc` is a no-op and deno type-noise exists — neither is a signal.
- **No new dependencies.** New tour code uses framer-motion only; `animejs` must NOT appear in any new file (old tour used it; it stays installed for other uses).
- Copy is **verbatim from spec §5**. Sample note title is exactly `A guided study (sample)` (locked decision 6).
- Reduced motion: use the repo hook `usePrefersReducedMotion` from `@/hooks/use-prefers-reduced-motion` (defaults to `true` when matchMedia is absent, i.e. jsdom). This is the chosen option where spec §4 said "either works".
- Theme constants (CSS vars with fallbacks): `--marigold #e8a93a`, `--alabaster #f7f3ec`, `--pale-stone #e5ded3`, `--deep-umber #3a2f24`, `--silica #8a8175`, `--plaster #f7f3ec`; body font `'Outfit, sans-serif'`, headings `'Cormorant Garamond', serif`. Scrim `rgba(38,30,22,0.55)`.
- Layering: tour root is `fixed inset-0 z-[100]` — above the More sheet (`z-50`) and the onboarding shell (`z-[90]`).
- Performance (spec §4): animate only transform/opacity. The cutout morph uses Framer Motion **layout projection** (transform-driven FLIP with automatic borderRadius/boxShadow correction); the card travels on a **full transform template string** (`translate3d(...) scale(...)`), never Framer `x`/`y` shorthands for measured-rect movement.
- Out of scope (spec §9): Get Started panel/checklist changes (beyond the existing Replay entry), structural event-bus changes, PR #74 files (`feat/reflection-timeline-waymarks`).
- Final runtime verification happens in the **visible chrome-devtools browser** (emulate 375x812x2, mobile, touch, ~1s settle post-reload) — never the hidden Claude_Preview tab.

## Resolved open items & judgment ledger

Decisions made while writing this plan (evidence-based, none re-opens a locked decision):

1. **Desktop `openAuth()` = `navigate('/login')`.** There is no desktop auth modal: `MobileAuthModal` is mobile-mounted only. The `/login` route (App.tsx:322 → `LoginPage` → `AuthCard` with a built-in signup mode) is the existing desktop auth entry; `useNotepadFirstLoad.tsx:46` already uses the navigate-to-auth-route idiom. Mobile `openAuth()` = `setAuthOpen(true)` (existing `MobileAuthModal` at MobileNotepadWorkspace.tsx:247).
2. **scriptureRef template attrs** (validated shape from `scripture-ref.editor.test.ts`): keys exactly `book, chapter, osis, text, translation, verseEnd, verseStart`; `osis: 'jhn.3.16'`, `translation: 'BSB'` (node default).
3. **MobileMoreSheet** gets an optional `initialSegment?: DetailSegment` prop applied when `open` flips false→true.
4. **Step 7 mobile prepare = `mobileSetTab('editor')`** (spec §3 says "none"): the More sheet opened by step 6 covers the header flame; switching tabs (which closes the sheet, mirroring `handleSelectTab`) is a mechanical necessity under spec §6's "never point at hypothetical UI", not a product fork.
5. **New `buildTourSampleNote()`** export beside `buildGuidedNote()` (not a mutation of it): the guided-note flow keeps its own title `'Your first study note'` (Get Started panel is out of scope, spec §9); the tour needs the distinct locked title.
6. **`usePrefersReducedMotion`** chosen over Framer's `useReducedMotion` (jsdom-safe default, repo idiom).
7. **Cutout morph = Framer `layout` projection** (satisfies the transform-only budget; Framer auto-corrects borderRadius and boxShadow during FLIP). Reduced motion: cutout repositions instantly (no travel); opacity fades on card/copy remain.

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/notepad/onboarding/tour/workspace-controller.ts` (+ `.test.ts`) | Imperative-controls registry singleton (mirrors onboarding-events pattern) |
| Create | `src/notepad/onboarding/tour/tour-engine.ts` (+ `.test.ts`) | DOM-free step state machine (`preparing → anchoring → showing`) + shared types |
| Create | `src/notepad/onboarding/tour/anchor-resolver.ts` (+ `.test.ts`) | Poll `[data-tour]` token → visible, settled element (~2s budget) |
| Create | `src/notepad/onboarding/tour/SpotlightOverlay.tsx` (+ `.test.tsx`) | Framer Motion overlay: scrim/cutout, card, progress, buttons, keyboard, exit choreography |
| Create | `src/notepad/onboarding/guided-note/tour-sample-note.test.ts` | Tests for the tour sample builder (new file; `guided-note-template.test.ts` already exists and is untouched) |
| Modify | `src/notepad/onboarding/guided-note/guided-note-template.ts` | Add `TOUR_SAMPLE_NOTE_TITLE` + `buildTourSampleNote()` |
| Modify | `src/notepad/onboarding/onboarding-types.ts` | Additive event id `'tour-step-skipped'` |
| Rewrite | `src/notepad/onboarding/tour/tour-steps.ts` (+ `.test.ts`) | 9 pure-data steps: copy, placement, per-viewport anchors, prepare actions |
| Rewrite | `src/notepad/onboarding/tour/anchors.contract.test.ts` | Per-viewport token lists + token↔source-file contract |
| Modify | `src/notepad/extensions/ScriptureRefView.tsx` | `data-tour="verse-chip"` on NodeViewWrapper (:100) |
| Modify | `src/notepad/components/Editor.tsx` | `data-tour="editor-page"` on the scroll container (:453) |
| Modify | `src/components/sections/notepad/StudyWindow.tsx` | `data-tour="studywindow-graph-tab"` on graph tab (:62); register `desktopSetStudyTab` |
| Modify | `src/components/sections/notepad/mobile/MobileFabMenu.tsx` | `data-tour="mobile-new-note-fab"` on the FAB (:132) |
| Modify | `src/components/sections/notepad/mobile/HeaderLamplightFlame.tsx` | `data-tour="header-flame"` on the root button |
| Modify | `src/notepad/bible/BibleStudyPane.tsx` | Optional `dataTour?: string` prop on the root div |
| Modify | `src/components/sections/notepad/mobile/MobileMoreSheet.tsx` | Export `DetailSegment`; `initialSegment` prop; `data-tour="more-sheet-graph"` wrapper |
| Modify | `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` | Register mobile controls + auth; pass `dataTour`/`initialSegment` |
| Modify | `src/components/sections/Notepad.tsx` | Desktop registration (`graphOpen`, auth); shared `createSampleNote`/`openNote` in NotepadOnboardingOverlay |
| Modify | `src/notepad/onboarding/OnboardingSurfaces.tsx` | Swap SpotlightTour → SpotlightOverlay; real `onSignUp` |
| Delete | `src/notepad/onboarding/tour/SpotlightTour.tsx` + `SpotlightTour.test.tsx` | Superseded |

Kept as-is (spec §2.4): OnboardingProvider lifecycle (`markTourDone`/`replayTour`), `decideOnboardingActions`, the event bus (`emitOnboardingEvent` — additive id only), Editor `trayOpen` stays out of the registry.

---

### Task 1: WorkspaceController registry

**Files:**
- Create: `src/notepad/onboarding/tour/workspace-controller.ts`
- Test: `src/notepad/onboarding/tour/workspace-controller.test.ts`

**Interfaces:**
- Consumes: nothing (module-level singleton, mirrors `onboarding-events.ts`).
- Produces: `WorkspaceControls` (all-optional methods: `createSampleNote(): Promise<string>`, `openNote(id: string)`, `openAuth()`, `desktopSetGraphOpen(open: boolean)`, `desktopSetStudyTab(tab: 'bible'|'graph')`, `mobileSetTab(tab: 'notes'|'editor'|'lamplight'|'bible')`, `mobileOpenMoreSheet(segment: 'backlinks'|'info'|'graph')`); `registerWorkspaceControls(controls): () => void`; `getWorkspaceControls(): Readonly<WorkspaceControls>`; `subscribeWorkspaceControls(listener): () => void`; types `MobileWorkspaceTab`, `StudyWindowTab`, `MoreSheetSegment`.

- [ ] **Step 0: Baseline the lint noise (once, before any change)**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm run lint 2>&1 | tail -3`
Expected: summary line reporting the pre-existing problem count (124 errors). Record it — every later lint step compares against it.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/onboarding/tour/workspace-controller.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  getWorkspaceControls,
  registerWorkspaceControls,
  subscribeWorkspaceControls,
} from './workspace-controller';

describe('workspace-controller registry', () => {
  it('merges registered controls and removes them on unregister', () => {
    const setTab = vi.fn();
    const unregister = registerWorkspaceControls({ mobileSetTab: setTab });
    expect(getWorkspaceControls().mobileSetTab).toBe(setTab);
    unregister();
    expect(getWorkspaceControls().mobileSetTab).toBeUndefined();
  });

  it('merges controls from independent registrations', () => {
    const openNote = vi.fn();
    const setGraphOpen = vi.fn();
    const unregisterShared = registerWorkspaceControls({ openNote });
    const unregisterDesktop = registerWorkspaceControls({ desktopSetGraphOpen: setGraphOpen });
    expect(getWorkspaceControls().openNote).toBe(openNote);
    expect(getWorkspaceControls().desktopSetGraphOpen).toBe(setGraphOpen);
    unregisterShared();
    expect(getWorkspaceControls().openNote).toBeUndefined();
    expect(getWorkspaceControls().desktopSetGraphOpen).toBe(setGraphOpen);
    unregisterDesktop();
  });

  it('a stale unregister never clobbers a newer registration for the same key', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerWorkspaceControls({ openAuth: first });
    const unregisterSecond = registerWorkspaceControls({ openAuth: second });
    unregisterFirst(); // stale cleanup arriving after re-registration
    expect(getWorkspaceControls().openAuth).toBe(second);
    unregisterSecond();
    expect(getWorkspaceControls().openAuth).toBeUndefined();
  });

  it('notifies subscribers on register and unregister', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceControls(listener);
    const unregister = registerWorkspaceControls({ openNote: vi.fn() });
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerWorkspaceControls({ openNote: vi.fn() })();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/workspace-controller.test.ts`
Expected: FAIL — cannot resolve `./workspace-controller`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/onboarding/tour/workspace-controller.ts`:

```ts
// Imperative controls the workspaces register on mount so the tour can drive
// the app (spec §2.2). Module-level singleton mirroring onboarding-events.ts:
// the workspaces are siblings of OnboardingSurfaces (Notepad.tsx), so context
// cannot reach their local useState.

export type MobileWorkspaceTab = 'notes' | 'editor' | 'lamplight' | 'bible';
export type StudyWindowTab = 'bible' | 'graph';
export type MoreSheetSegment = 'backlinks' | 'info' | 'graph';

export interface WorkspaceControls {
  /** Shared — registered by NotepadOnboardingOverlay (mounted on both viewports). */
  createSampleNote?: () => Promise<string>;
  openNote?: (id: string) => void;
  /** Viewport-specific auth entry: desktop navigates to /login, mobile opens MobileAuthModal. */
  openAuth?: () => void;
  /** Desktop workspace. */
  desktopSetGraphOpen?: (open: boolean) => void;
  desktopSetStudyTab?: (tab: StudyWindowTab) => void;
  /** Mobile workspace. */
  mobileSetTab?: (tab: MobileWorkspaceTab) => void;
  mobileOpenMoreSheet?: (segment: MoreSheetSegment) => void;
}

const registry: WorkspaceControls = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Merge `controls` into the registry. Returns an unregister function that
 * removes exactly the keys registered here (identity-checked, so a stale
 * cleanup never clobbers a newer registration for the same key — matters
 * across the 768px workspace remount).
 */
export function registerWorkspaceControls(controls: WorkspaceControls): () => void {
  Object.assign(registry, controls);
  notify();
  return () => {
    for (const key of Object.keys(controls) as Array<keyof WorkspaceControls>) {
      if (registry[key] === controls[key]) delete registry[key];
    }
    notify();
  };
}

export function getWorkspaceControls(): Readonly<WorkspaceControls> {
  return registry;
}

export function subscribeWorkspaceControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/workspace-controller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm run lint 2>&1 | tail -3` — same count as baseline, nothing referencing `workspace-controller`.

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/notepad/onboarding/tour/workspace-controller.ts src/notepad/onboarding/tour/workspace-controller.test.ts && git commit -m "feat(tour): add WorkspaceController registry for tour prepare actions"
```

---

### Task 2: Tour sample-note builder

**Files:**
- Modify: `src/notepad/onboarding/guided-note/guided-note-template.ts` (additive — `buildGuidedNote()` untouched)
- Test: `src/notepad/onboarding/guided-note/tour-sample-note.test.ts` (new file; do NOT touch the existing `guided-note-template.test.ts`)

**Interfaces:**
- Consumes: nothing.
- Produces: `TOUR_SAMPLE_NOTE_TITLE: string` (= `'A guided study (sample)'`), `buildTourSampleNote(): { title: string; content: string }` (content = stringified TipTap doc containing one `scriptureRef` node).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/onboarding/guided-note/tour-sample-note.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TOUR_SAMPLE_NOTE_TITLE, buildTourSampleNote } from './guided-note-template';

interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

describe('buildTourSampleNote', () => {
  it('titles the note with the exact sample marker (locked decision 6)', () => {
    expect(TOUR_SAMPLE_NOTE_TITLE).toBe('A guided study (sample)');
    expect(buildTourSampleNote().title).toBe('A guided study (sample)');
  });

  it('embeds one scriptureRef node with complete, valid attrs', () => {
    const doc = JSON.parse(buildTourSampleNote().content) as DocNode;
    expect(doc.type).toBe('doc');
    const chips = (doc.content ?? [])
      .flatMap((paragraph) => paragraph.content ?? [])
      .filter((node) => node.type === 'scriptureRef');
    expect(chips).toHaveLength(1);
    expect(chips[0].attrs).toEqual({
      osis: 'jhn.3.16',
      book: 'John',
      chapter: 3,
      verseStart: 16,
      verseEnd: null,
      translation: 'BSB',
      text: 'For God so loved the world…',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/guided-note/tour-sample-note.test.ts`
Expected: FAIL — `TOUR_SAMPLE_NOTE_TITLE` / `buildTourSampleNote` not exported.

- [ ] **Step 3: Implement**

Append to `src/notepad/onboarding/guided-note/guided-note-template.ts` (leave `buildGuidedNote()` exactly as it is):

```ts
export const TOUR_SAMPLE_NOTE_TITLE = 'A guided study (sample)';

/**
 * The sample study note the tour creates and drives (locked decision 6: kept
 * after the tour, explicit sample marker in the title — idempotent reuse
 * detects it by this exact title). The scriptureRef node makes step 3's
 * verse-chip anchor guaranteed-present. `content` is a stringified TipTap doc,
 * same contract as buildGuidedNote().
 */
export function buildTourSampleNote(): { title: string; content: string } {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Grace shows up before we ask. This page keeps coming back to one verse:',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'scriptureRef',
            attrs: {
              osis: 'jhn.3.16',
              book: 'John',
              chapter: 3,
              verseStart: 16,
              verseEnd: null,
              translation: 'BSB',
              text: 'For God so loved the world…',
            },
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Love that gives first. What would it look like to trust that this week?',
          },
        ],
      },
    ],
  };
  return { title: TOUR_SAMPLE_NOTE_TITLE, content: JSON.stringify(doc) };
}
```

- [ ] **Step 4: Run tests to verify they pass (including the existing template test)**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/guided-note/`
Expected: PASS — both `tour-sample-note.test.ts` and the pre-existing `guided-note-template.test.ts`.

- [ ] **Step 5: Lint and commit**

Run lint (baseline unchanged), then:

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/notepad/onboarding/guided-note/guided-note-template.ts src/notepad/onboarding/guided-note/tour-sample-note.test.ts && git commit -m "feat(tour): add buildTourSampleNote with embedded scriptureRef"
```

---

### Task 3: TourEngine state machine + anchor resolver

**Files:**
- Create: `src/notepad/onboarding/tour/tour-engine.ts`
- Create: `src/notepad/onboarding/tour/anchor-resolver.ts`
- Test: `src/notepad/onboarding/tour/tour-engine.test.ts`, `src/notepad/onboarding/tour/anchor-resolver.test.ts`

**Interfaces:**
- Consumes: `WorkspaceControls` from Task 1.
- Produces (from `tour-engine.ts`): types `TourViewport = 'desktop'|'mobile'`, `TourPlacement = 'top'|'bottom'|'left'|'right'|'center'`, `TourStepCopy { title: string; body: string | { desktop: string; mobile: string } }`, `TourRunContext { viewport: TourViewport; sampleNoteId: string | null }`, `TourStep { id, placement: TourPlacement | { desktop; mobile }, copy, anchor(viewport): string | null, prepare?(controls, ctx): void | Promise<void> }`, `TourPhase = 'preparing'|'anchoring'|'showing'`, `TourEngineState { stepIndex, phase, anchorEl: Element | null, viewport }`, `TourEngineDeps`, `TourEngine { start, next, back, skip, setViewport, getState, subscribe, dispose }`, `createTourEngine(deps): TourEngine`.
- Produces (from `anchor-resolver.ts`): `resolveAnchor(token: string, signal: AbortSignal): Promise<Element | null>`.

- [ ] **Step 1: Write the failing engine test**

Create `src/notepad/onboarding/tour/tour-engine.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTourEngine, type TourEngineDeps, type TourStep } from './tour-engine';

function makeStep(overrides: Partial<TourStep> & { id: string }): TourStep {
  return {
    placement: 'bottom',
    copy: { title: overrides.id, body: 'body' },
    anchor: () => null,
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeDeps(steps: TourStep[], overrides: Partial<TourEngineDeps> = {}): TourEngineDeps {
  return {
    steps,
    initialViewport: 'desktop',
    getControls: () => ({}),
    resolveAnchor: vi.fn(async () => document.createElement('div')),
    onComplete: vi.fn(),
    onSkip: vi.fn(),
    onStepSkipped: vi.fn(),
    ...overrides,
  };
}

describe('createTourEngine', () => {
  it('runs prepare then shows a centered step immediately (null anchor)', async () => {
    const prepare = vi.fn();
    const deps = makeDeps([makeStep({ id: 'welcome', prepare })]);
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toMatchObject({ stepIndex: 0, phase: 'showing', anchorEl: null });
  });

  it('resolves the anchor token for the current viewport and stores the element', async () => {
    const el = document.createElement('button');
    const resolveAnchor = vi.fn(async () => el);
    const deps = makeDeps(
      [makeStep({ id: 'step', anchor: (v) => (v === 'desktop' ? 'desktop-token' : 'mobile-token') })],
      { resolveAnchor },
    );
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(resolveAnchor).toHaveBeenCalledWith('desktop-token', expect.any(AbortSignal));
    expect(engine.getState()).toMatchObject({ phase: 'showing', anchorEl: el });
  });

  it('skips forward and reports the step when the anchor never resolves', async () => {
    const resolveAnchor = vi.fn(async (token: string) =>
      token === 'missing' ? null : document.createElement('div'),
    );
    const deps = makeDeps(
      [
        makeStep({ id: 'broken', anchor: () => 'missing' }),
        makeStep({ id: 'next-step', anchor: () => 'present' }),
      ],
      { resolveAnchor },
    );
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(deps.onStepSkipped).toHaveBeenCalledWith('broken');
    expect(engine.getState()).toMatchObject({ stepIndex: 1, phase: 'showing' });
  });

  it('skips forward when prepare throws', async () => {
    const deps = makeDeps([
      makeStep({
        id: 'explodes',
        prepare: () => {
          throw new Error('nope');
        },
      }),
      makeStep({ id: 'after' }),
    ]);
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(deps.onStepSkipped).toHaveBeenCalledWith('explodes');
    expect(engine.getState().stepIndex).toBe(1);
  });

  it('completes when skipping forward past the last step', async () => {
    const deps = makeDeps([makeStep({ id: 'only', anchor: () => 'missing' })], {
      resolveAnchor: vi.fn(async () => null),
    });
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    expect(deps.onComplete).toHaveBeenCalledTimes(1);
  });

  it('next() past the last step completes; back() below zero is a no-op', async () => {
    const deps = makeDeps([makeStep({ id: 'a' }), makeStep({ id: 'b' })]);
    const engine = createTourEngine(deps);
    engine.start();
    await flush();
    engine.back();
    await flush();
    expect(engine.getState().stepIndex).toBe(0);
    engine.next();
    await flush();
    expect(engine.getState().stepIndex).toBe(1);
    engine.next();
    await flush();
    expect(deps.onComplete).toHaveBeenCalledTimes(1);
  });

  it('skip() fires onSkip immediately, even mid-prepare', async () => {
    let release: () => void = () => {};
    const deps = makeDeps([
      makeStep({
        id: 'slow',
        prepare: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }),
    ]);
    const engine = createTourEngine(deps);
    engine.start();
    engine.skip();
    expect(deps.onSkip).toHaveBeenCalledTimes(1);
    release();
    await flush();
    expect(deps.onComplete).not.toHaveBeenCalled();
  });

  it('caches the sample note id in ctx across steps within a run', async () => {
    const createSampleNote = vi.fn(async () => 'note-1');
    const seen: Array<string | null> = [];
    const steps = [
      makeStep({
        id: 'creates',
        prepare: async (controls, ctx) => {
          ctx.sampleNoteId = (await controls.createSampleNote?.()) ?? null;
        },
      }),
      makeStep({
        id: 'reads',
        prepare: (_controls, ctx) => {
          seen.push(ctx.sampleNoteId);
        },
      }),
    ];
    const engine = createTourEngine(makeDeps(steps, { getControls: () => ({ createSampleNote }) }));
    engine.start();
    await flush();
    engine.next();
    await flush();
    expect(seen).toEqual(['note-1']);
  });

  it('re-runs the current step prepare when the viewport changes', async () => {
    const viewports: string[] = [];
    const steps = [
      makeStep({
        id: 'step',
        prepare: (_controls, ctx) => {
          viewports.push(ctx.viewport);
        },
      }),
    ];
    const engine = createTourEngine(makeDeps(steps));
    engine.start();
    await flush();
    engine.setViewport('mobile');
    await flush();
    expect(viewports).toEqual(['desktop', 'mobile']);
    expect(engine.getState().viewport).toBe('mobile');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/tour-engine.test.ts`
Expected: FAIL — cannot resolve `./tour-engine`.

- [ ] **Step 3: Implement the engine**

Create `src/notepad/onboarding/tour/tour-engine.ts`:

```ts
import type { WorkspaceControls } from './workspace-controller';

export type TourViewport = 'desktop' | 'mobile';
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStepCopy {
  title: string;
  body: string | { desktop: string; mobile: string };
}

export interface TourRunContext {
  viewport: TourViewport;
  /** Cached per run so Back / replay / viewport switch reuses one sample note (spec §6). */
  sampleNoteId: string | null;
}

export interface TourStep {
  id: string;
  placement: TourPlacement | { desktop: TourPlacement; mobile: TourPlacement };
  copy: TourStepCopy;
  /** data-tour token for the viewport, or null for a centered card. */
  anchor: (viewport: TourViewport) => string | null;
  /** Drives the app exclusively through the registry — no DOM (spec §2.2). */
  prepare?: (controls: Readonly<WorkspaceControls>, ctx: TourRunContext) => void | Promise<void>;
}

export type TourPhase = 'preparing' | 'anchoring' | 'showing';

export interface TourEngineState {
  stepIndex: number;
  phase: TourPhase;
  anchorEl: Element | null;
  viewport: TourViewport;
}

export interface TourEngineDeps {
  steps: TourStep[];
  initialViewport: TourViewport;
  getControls: () => Readonly<WorkspaceControls>;
  /**
   * Resolve a data-tour token to a visible, settled element. Owns the ~2s
   * retry budget; resolves null on timeout/abort. Injected so the engine
   * never touches the DOM (spec §2.1) and tests stay synchronous.
   */
  resolveAnchor: (token: string, signal: AbortSignal) => Promise<Element | null>;
  onComplete: () => void;
  onSkip: () => void;
  /** Fired when a step is skipped forward after prepare/anchor failure (spec §6). */
  onStepSkipped?: (stepId: string) => void;
}

export interface TourEngine {
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  setViewport: (viewport: TourViewport) => void;
  getState: () => TourEngineState;
  subscribe: (listener: () => void) => () => void;
  /** Abort in-flight work (unmount cleanup). */
  dispose: () => void;
}

export function createTourEngine(deps: TourEngineDeps): TourEngine {
  const { steps } = deps;
  const ctx: TourRunContext = { viewport: deps.initialViewport, sampleNoteId: null };
  let state: TourEngineState = {
    stepIndex: 0,
    phase: 'preparing',
    anchorEl: null,
    viewport: deps.initialViewport,
  };
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let finished = false;

  function setState(patch: Partial<TourEngineState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function cancelInFlight(): void {
    abort?.abort();
    abort = null;
  }

  function finish(callback: () => void): void {
    if (finished) return;
    finished = true;
    cancelInFlight();
    callback();
  }

  function skipForward(index: number, stepId: string): void {
    deps.onStepSkipped?.(stepId);
    if (index >= steps.length - 1) {
      finish(deps.onComplete);
      return;
    }
    void runStep(index + 1);
  }

  async function runStep(index: number): Promise<void> {
    cancelInFlight();
    const controller = new AbortController();
    abort = controller;
    const step = steps[index];
    setState({ stepIndex: index, phase: 'preparing', anchorEl: null });

    try {
      await step.prepare?.(deps.getControls(), ctx);
    } catch {
      // Failed prepare is handled like a missing anchor: skip forward (spec §6).
      if (controller.signal.aborted) return;
      skipForward(index, step.id);
      return;
    }
    if (controller.signal.aborted) return;

    const token = step.anchor(ctx.viewport);
    if (token === null) {
      setState({ phase: 'showing', anchorEl: null });
      return;
    }

    setState({ phase: 'anchoring' });
    const el = await deps.resolveAnchor(token, controller.signal);
    if (controller.signal.aborted) return;
    if (el === null) {
      skipForward(index, step.id);
      return;
    }
    setState({ phase: 'showing', anchorEl: el });
  }

  return {
    start: () => {
      void runStep(0);
    },
    next: () => {
      if (finished) return;
      if (state.stepIndex >= steps.length - 1) {
        finish(deps.onComplete);
        return;
      }
      void runStep(state.stepIndex + 1);
    },
    back: () => {
      if (finished || state.stepIndex === 0) return;
      void runStep(state.stepIndex - 1);
    },
    // Skip and Escape always work instantly, regardless of engine state (spec §6).
    skip: () => finish(deps.onSkip),
    setViewport: (viewport) => {
      if (finished || viewport === ctx.viewport) return;
      ctx.viewport = viewport;
      setState({ viewport });
      // Re-run the current step for the new viewport (spec §2.5/§6). The
      // resolver's retry budget covers the workspace remount + re-registration.
      void runStep(state.stepIndex);
    },
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => cancelInFlight(),
  };
}
```

- [ ] **Step 4: Run the engine test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/tour-engine.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write the failing resolver test**

Create `src/notepad/onboarding/tour/anchor-resolver.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAnchor } from './anchor-resolver';

function mountAnchor(
  token: string,
  rect: { x: number; y: number; width: number; height: number },
): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-tour', token);
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('resolveAnchor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('resolves an element once its rect is non-zero and stable across two polls', async () => {
    const el = mountAnchor('present', { x: 10, y: 20, width: 100, height: 40 });
    const pending = resolveAnchor('present', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(el);
  });

  it('resolves null when the token never appears within the ~2s budget', async () => {
    const pending = resolveAnchor('never', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeNull();
  });

  it('treats an all-zero rect as missing (jsdom-safe guard, like the old readRect)', async () => {
    mountAnchor('zero', { x: 0, y: 0, width: 0, height: 0 });
    const pending = resolveAnchor('zero', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeNull();
  });

  it('resolves null immediately on abort', async () => {
    const controller = new AbortController();
    const pending = resolveAnchor('whatever', controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});
```

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/anchor-resolver.test.ts`
Expected: FAIL — cannot resolve `./anchor-resolver`.

- [ ] **Step 6: Implement the resolver**

Create `src/notepad/onboarding/tour/anchor-resolver.ts`:

```ts
const POLL_INTERVAL_MS = 120;
const MAX_POLLS = 17; // ~2s budget (spec §6), counted in polls so fake timers stay deterministic

interface SimpleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(el: Element): SimpleRect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function isZero(rect: SimpleRect): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0;
}

function isStable(a: SimpleRect, b: SimpleRect): boolean {
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

/**
 * Poll for `[data-tour="<token>"]` until it exists, has a non-zero rect
 * (all-zero = jsdom/undisplayed — same guard as the old tour's readRect), and
 * the rect is stable across two consecutive polls (lets panels a prepare
 * opened finish their own animations before we measure — spec §4). Resolves
 * null when the ~2s budget runs out or `signal` aborts.
 */
export function resolveAnchor(token: string, signal: AbortSignal): Promise<Element | null> {
  return new Promise((resolve) => {
    let lastRect: SimpleRect | null = null;
    let lastEl: Element | null = null;
    let polls = 0;
    let settled = false;

    const finish = (value: Element | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    if (signal.aborted) {
      resolve(null);
      return;
    }
    signal.addEventListener('abort', onAbort);

    const poll = () => {
      if (settled) return;
      const el = document.querySelector(`[data-tour="${token}"]`);
      if (el) {
        const rect = rectOf(el);
        if (!isZero(rect)) {
          if (el === lastEl && lastRect && isStable(rect, lastRect)) {
            finish(el);
            return;
          }
          lastEl = el;
          lastRect = rect;
        } else {
          lastEl = null;
          lastRect = null;
        }
      } else {
        lastEl = null;
        lastRect = null;
      }
      polls += 1;
      if (polls >= MAX_POLLS) {
        finish(null);
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
  });
}
```

- [ ] **Step 7: Run the resolver test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/anchor-resolver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Lint and commit**

Run lint (baseline unchanged), then:

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/notepad/onboarding/tour/tour-engine.ts src/notepad/onboarding/tour/tour-engine.test.ts src/notepad/onboarding/tour/anchor-resolver.ts src/notepad/onboarding/tour/anchor-resolver.test.ts && git commit -m "feat(tour): add DOM-free TourEngine and polling anchor resolver"
```

---

### Task 4: SpotlightOverlay (Framer Motion) + additive event id

**Files:**
- Create: `src/notepad/onboarding/tour/SpotlightOverlay.tsx`
- Modify: `src/notepad/onboarding/onboarding-types.ts` (add `'tour-step-skipped'` to the `OnboardingEvent` union — additive only; `ANON_EVENT_TO_ITEM`/`JOURNEY_EVENT_TO_ITEM` are `Partial<Record<…>>` so no mapping entries are needed)
- Test: `src/notepad/onboarding/tour/SpotlightOverlay.test.tsx`

**Interfaces:**
- Consumes: `createTourEngine`, `TourStep`, `TourViewport`, `TourPlacement`, `TourEngineDeps` (Task 3); `getWorkspaceControls` (Task 1); `resolveAnchor` (Task 3); `emitOnboardingEvent` (existing); `usePrefersReducedMotion` (existing).
- Produces: `SpotlightOverlay({ steps, onComplete, onSkip, onSignUp, resolveAnchor? })` — the complete tour UI (no portal; OnboardingSurfaces portals it), and exported pure helper `computeCardPosition(rect, placement, card, viewportSize)`.

- [ ] **Step 1: Add the event id**

In `src/notepad/onboarding/onboarding-types.ts:2`, extend the union:

```ts
export type OnboardingEvent =
  | 'note-created'
  | 'verse-linked'
  | 'highlight-created'
  | 'scan-completed'
  | 'folder-created'
  | 'graph-visited'
  | 'lamplight-connection'
  | 'search-used'
  | 'tour-step-skipped';
```

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/onboarding-types.test.ts`
Expected: PASS (the test checks specific mappings, not an exhaustive list — additive id is safe).

- [ ] **Step 2: Write the failing overlay test**

Create `src/notepad/onboarding/tour/SpotlightOverlay.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpotlightOverlay, computeCardPosition } from './SpotlightOverlay';
import type { TourStep } from './tour-engine';

const FIXTURE_STEPS: TourStep[] = [
  {
    id: 'welcome',
    placement: 'center',
    copy: { title: 'The first page is open.', body: 'A short walk.' },
    anchor: () => null,
  },
  {
    id: 'middle',
    placement: 'center',
    copy: { title: 'Middle moment.', body: { desktop: 'Desktop body.', mobile: 'Mobile body.' } },
    anchor: () => null,
  },
  {
    id: 'finale',
    placement: 'center',
    copy: { title: 'Make it yours.', body: 'Closing.' },
    anchor: () => null,
  },
];

function renderOverlay(overrides: Partial<Parameters<typeof SpotlightOverlay>[0]> = {}) {
  const props = {
    steps: FIXTURE_STEPS,
    onComplete: vi.fn(),
    onSkip: vi.fn(),
    onSignUp: vi.fn(),
    ...overrides,
  };
  render(<SpotlightOverlay {...props} />);
  return props;
}

describe('computeCardPosition', () => {
  const card = { width: 300, height: 200 };
  const viewportSize = { width: 1000, height: 800 };

  it('centers the card when there is no target rect', () => {
    expect(computeCardPosition(null, 'center', card, viewportSize)).toEqual({ x: 350, y: 300 });
  });

  it('places the card below a bottom-placed target, horizontally centered', () => {
    const rect = { x: 400, y: 100, width: 200, height: 50 };
    expect(computeCardPosition(rect, 'bottom', card, viewportSize)).toEqual({ x: 350, y: 166 });
  });

  it('clamps to the viewport edge padding', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const pos = computeCardPosition(rect, 'left', card, viewportSize);
    expect(pos.x).toBe(16);
    expect(pos.y).toBe(16);
  });
});

describe('SpotlightOverlay', () => {
  it('shows the welcome step with its entry buttons and progress', async () => {
    renderOverlay();
    expect(await screen.findByText('The first page is open.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take the walk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument();
    expect(screen.getByLabelText('Step 1 of 3')).toBeInTheDocument();
  });

  it('advances with the primary button and resolves per-viewport copy (desktop default)', async () => {
    renderOverlay();
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    expect(await screen.findByText('Middle moment.')).toBeInTheDocument();
    expect(screen.getByText('Desktop body.')).toBeInTheDocument();
  });

  it('Escape skips: plays the exit then calls onSkip exactly once', async () => {
    const props = renderOverlay();
    await screen.findByText('The first page is open.');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(props.onSkip).toHaveBeenCalledTimes(1));
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it('arrow keys navigate back and forward', async () => {
    renderOverlay();
    await screen.findByText('The first page is open.');
    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByText('Middle moment.')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByText('The first page is open.')).toBeInTheDocument();
  });

  it('final step: CTA fires onSignUp after the exit', async () => {
    const props = renderOverlay();
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create free account' }));
    await waitFor(() => expect(props.onSignUp).toHaveBeenCalledTimes(1));
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it('final step: the secondary button completes the tour', async () => {
    const props = renderOverlay();
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Not yet — keep exploring' }));
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
  });

  it('skips a step forward when its anchor cannot resolve', async () => {
    const steps: TourStep[] = [
      FIXTURE_STEPS[0],
      { id: 'broken', placement: 'bottom', copy: { title: 'Broken.', body: 'x' }, anchor: () => 'missing-token' },
      FIXTURE_STEPS[2],
    ];
    renderOverlay({ steps, resolveAnchor: async () => null });
    await userEvent.click(await screen.findByRole('button', { name: 'Take the walk' }));
    expect(await screen.findByText('Make it yours.')).toBeInTheDocument();
  });
});
```

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/SpotlightOverlay.test.tsx`
Expected: FAIL — cannot resolve `./SpotlightOverlay`.

- [ ] **Step 3: Implement the overlay**

Create `src/notepad/onboarding/tour/SpotlightOverlay.tsx`:

```tsx
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { emitOnboardingEvent } from '../onboarding-events';
import { resolveAnchor as defaultResolveAnchor } from './anchor-resolver';
import {
  createTourEngine,
  type TourEngineDeps,
  type TourPlacement,
  type TourStep,
  type TourViewport,
} from './tour-engine';
import { getWorkspaceControls } from './workspace-controller';

// Motion constants (spec §4): calm ink-and-paper, low-bounce, no overshoot.
const SPOTLIGHT_SPRING = { type: 'spring', duration: 0.6, bounce: 0.15 } as const;
const ENTRANCE = { duration: 0.3, ease: [0.23, 1, 0.32, 1] } as const;
const CARD_WIDTH = 300;
const GAP = 16;
const EDGE_PAD = 16;
const CUTOUT_PAD = 6;
const SCRIM = 'rgba(38, 30, 22, 0.55)';
const SCROLL_SETTLE_MS = 350;

export interface SpotlightOverlayProps {
  steps: TourStep[];
  onComplete: () => void;
  onSkip: () => void;
  onSignUp: () => void;
  /** Injectable for tests; defaults to the DOM polling resolver. */
  resolveAnchor?: TourEngineDeps['resolveAnchor'];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function resolvePlacement(step: TourStep, viewport: TourViewport): TourPlacement {
  return typeof step.placement === 'string' ? step.placement : step.placement[viewport];
}

function resolveBody(step: TourStep, viewport: TourViewport): string {
  return typeof step.copy.body === 'string' ? step.copy.body : step.copy.body[viewport];
}

export function computeCardPosition(
  rect: Rect | null,
  placement: TourPlacement,
  card: { width: number; height: number },
  viewportSize: { width: number; height: number },
): { x: number; y: number } {
  if (rect === null || placement === 'center') {
    return {
      x: (viewportSize.width - card.width) / 2,
      y: (viewportSize.height - card.height) / 2,
    };
  }
  let x: number;
  let y: number;
  switch (placement) {
    case 'bottom':
      x = rect.x + rect.width / 2 - card.width / 2;
      y = rect.y + rect.height + GAP;
      break;
    case 'top':
      x = rect.x + rect.width / 2 - card.width / 2;
      y = rect.y - GAP - card.height;
      break;
    case 'left':
      x = rect.x - GAP - card.width;
      y = rect.y + rect.height / 2 - card.height / 2;
      break;
    case 'right':
      x = rect.x + rect.width + GAP;
      y = rect.y + rect.height / 2 - card.height / 2;
      break;
  }
  x = Math.min(Math.max(x, EDGE_PAD), Math.max(EDGE_PAD, viewportSize.width - card.width - EDGE_PAD));
  y = Math.min(Math.max(y, EDGE_PAD), Math.max(EDGE_PAD, viewportSize.height - card.height - EDGE_PAD));
  return { x, y };
}

/**
 * Same 768px breakpoint as use-mobile.ts, but guarded for environments
 * without matchMedia (jsdom) so the tour never crashes in tests.
 */
function useTourViewport(): TourViewport {
  const [viewport, setViewport] = useState<TourViewport>(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches
      ? 'mobile'
      : 'desktop',
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = () => setViewport(mql.matches ? 'mobile' : 'desktop');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return viewport;
}

function FlickerFlame() {
  // The one delight moment (spec §4): the Lamplight step's 🕯 flickers.
  return (
    <motion.span
      style={{ display: 'inline-block' }}
      animate={{ opacity: [1, 0.72, 1] }}
      transition={{ duration: 1.8, times: [0, 0.5, 1], repeat: Infinity, ease: 'linear' }}
      aria-hidden="true"
    >
      🕯
    </motion.span>
  );
}

function StepTitle({ step, reduceMotion }: { step: TourStep; reduceMotion: boolean }) {
  const { title } = step.copy;
  if (reduceMotion || !title.includes('🕯')) return <>{title}</>;
  const [before, after] = title.split('🕯');
  return (
    <>
      {before}
      <FlickerFlame />
      {after}
    </>
  );
}

type ExitReason = 'complete' | 'skip' | 'signup';

export function SpotlightOverlay({
  steps,
  onComplete,
  onSkip,
  onSignUp,
  resolveAnchor = defaultResolveAnchor,
}: SpotlightOverlayProps) {
  const reduceMotion = usePrefersReducedMotion();
  const viewport = useTourViewport();

  // Exit choreography (spec §4): play the 200ms fade first, then fire the
  // real callback from onExitComplete. Exits are faster than entrances.
  const [exitReason, setExitReason] = useState<ExitReason | null>(null);
  const callbacksRef = useRef({ onComplete, onSkip, onSignUp });
  callbacksRef.current = { onComplete, onSkip, onSignUp };

  const [engine] = useState(() =>
    createTourEngine({
      steps,
      initialViewport:
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 767px)').matches
          ? 'mobile'
          : 'desktop',
      getControls: getWorkspaceControls,
      resolveAnchor,
      onComplete: () => setExitReason((prev) => prev ?? 'complete'),
      onSkip: () => setExitReason((prev) => prev ?? 'skip'),
      onStepSkipped: () => emitOnboardingEvent('tour-step-skipped'),
    }),
  );

  useEffect(() => {
    engine.start();
    return () => engine.dispose();
  }, [engine]);

  useEffect(() => {
    engine.setViewport(viewport);
  }, [engine, viewport]);

  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const step = steps[state.stepIndex];
  const isFirst = state.stepIndex === 0;
  const isLast = state.stepIndex === steps.length - 1;

  // Keyboard: Escape skips instantly (spec §6); arrows navigate (decision 5).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') engine.skip();
      else if (event.key === 'ArrowRight') engine.next();
      else if (event.key === 'ArrowLeft') engine.back();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  // Scroll the resolved anchor into view, wait for the scroll to finish, then
  // measure and (only then) start listening for drift. Never scroll and morph
  // simultaneously (spec §4). inline:'nearest' also fixes the mobile bottom
  // toolbar's horizontal overflow for step 5 (spec §3 "VERIFY at 375px").
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (state.phase !== 'showing') return; // hold the previous cutout while preparing
    const el = state.anchorEl;
    if (el === null) {
      setTargetRect(null);
      return;
    }
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    const remeasure = () => {
      if (!cancelled) setTargetRect(measure(el));
    };
    el.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
    const timer = window.setTimeout(
      () => {
        if (cancelled) return;
        setTargetRect(measure(el));
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(remeasure);
          observer.observe(el);
        }
        window.addEventListener('resize', remeasure);
        window.addEventListener('scroll', remeasure, true);
      },
      reduceMotion ? 0 : SCROLL_SETTLE_MS,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [state.phase, state.anchorEl, reduceMotion]);

  // Card + viewport measurements for placement math.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const update = () => setCardHeight(node.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const placement = resolvePlacement(step, state.viewport);
  const cardWidth = Math.min(CARD_WIDTH, viewportSize.width - EDGE_PAD * 2);
  const cardPos = computeCardPosition(
    targetRect,
    placement,
    { width: cardWidth, height: cardHeight },
    viewportSize,
  );
  // Full transform string, not x/y shorthands (spec §4 performance rule).
  const cardTransform = `translate3d(${Math.round(cardPos.x)}px, ${Math.round(cardPos.y)}px, 0) scale(1)`;
  const cardEnterTransform = `translate3d(${Math.round(cardPos.x)}px, ${Math.round(cardPos.y + 8)}px, 0) scale(0.96)`;
  const [entered, setEntered] = useState(false);

  const hasTarget = targetRect !== null;
  const spotRect: Rect = hasTarget
    ? {
        x: targetRect.x - CUTOUT_PAD,
        y: targetRect.y - CUTOUT_PAD,
        width: targetRect.width + CUTOUT_PAD * 2,
        height: targetRect.height + CUTOUT_PAD * 2,
      }
    : { x: viewportSize.width / 2, y: viewportSize.height / 2, width: 0, height: 0 };

  const handleExitComplete = () => {
    if (exitReason === 'skip') callbacksRef.current.onSkip();
    else if (exitReason === 'complete') callbacksRef.current.onComplete();
    else if (exitReason === 'signup') callbacksRef.current.onSignUp();
  };
  const beginSignUp = () => {
    engine.dispose();
    setExitReason((prev) => prev ?? 'signup');
  };

  const tap = reduceMotion ? undefined : { scale: 0.97, transition: { duration: 0.16 } };
  const primaryStyle: CSSProperties = {
    background: 'var(--deep-umber, #3a2f24)',
    color: 'var(--plaster, #f7f3ec)',
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 14,
    fontFamily: 'Outfit, sans-serif',
    cursor: 'pointer',
  };
  const ghostStyle: CSSProperties = {
    background: 'transparent',
    color: 'var(--silica, #8a8175)',
    border: 'none',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 14,
    fontFamily: 'Outfit, sans-serif',
    cursor: 'pointer',
  };
  const cardBaseStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: cardWidth,
    background: 'var(--alabaster, #f7f3ec)',
    border: '1px solid var(--pale-stone, #e5ded3)',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 12px 32px rgba(38, 30, 22, 0.18)',
    willChange: 'transform',
  };

  const copyInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 };
  const copyAnimate = reduceMotion
    ? { opacity: 1, transition: { duration: 0.15 } }
    : { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } };
  const copyExit = reduceMotion
    ? { opacity: 0, transition: { duration: 0.15 } }
    : { opacity: 0, filter: 'blur(2px)', transition: { duration: 0.15 } };

  const cardContent = (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step.id} initial={copyInitial} animate={copyAnimate} exit={copyExit}>
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              color: 'var(--deep-umber, #3a2f24)',
              fontSize: 22,
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            <StepTitle step={step} reduceMotion={reduceMotion} />
          </h2>
          <p
            style={{
              color: 'var(--silica, #8a8175)',
              fontSize: 14,
              lineHeight: 1.5,
              margin: '8px 0 16px',
            }}
          >
            {resolveBody(step, state.viewport)}
          </p>
        </motion.div>
      </AnimatePresence>
      <div
        aria-label={`Step ${state.stepIndex + 1} of ${steps.length}`}
        style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14 }}
      >
        {steps.map((s, i) => (
          <span
            key={s.id}
            style={{
              height: 6,
              width: i === state.stepIndex ? 18 : 6,
              borderRadius: 999,
              background:
                i === state.stepIndex ? 'var(--marigold, #e8a93a)' : 'var(--pale-stone, #e5ded3)',
              transition: reduceMotion ? 'none' : 'width 200ms ease-out, background 200ms ease-out',
            }}
          />
        ))}
      </div>
      {isFirst ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.skip()}>
            Skip for now
          </motion.button>
          <motion.button whileTap={tap} style={primaryStyle} onClick={() => engine.next()}>
            Take the walk
          </motion.button>
        </div>
      ) : isLast ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.next()}>
            Not yet — keep exploring
          </motion.button>
          <motion.button whileTap={tap} style={primaryStyle} onClick={beginSignUp}>
            Create free account
          </motion.button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.skip()}>
            Skip
          </motion.button>
          <div style={{ flex: 1 }} />
          <motion.button whileTap={tap} style={ghostStyle} onClick={() => engine.back()}>
            Back
          </motion.button>
          <motion.button whileTap={tap} style={primaryStyle} onClick={() => engine.next()}>
            Next
          </motion.button>
        </div>
      )}
    </>
  );

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {exitReason === null && (
        <motion.div
          key="tour"
          role="dialog"
          aria-modal="true"
          aria-label="Onboarding walkthrough"
          className="fixed inset-0 z-[100]"
          style={{ fontFamily: 'Outfit, sans-serif', overflow: 'hidden' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.4, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          {/* Scrim-with-cutout: the 9999px spread paints the scrim; the inner
              ring is the marigold spotlight border (old-tour technique). The
              morph runs on Framer layout projection = transforms only, with
              automatic borderRadius/boxShadow correction (spec §4). Under
              reduced motion the cutout repositions instantly (no travel). */}
          <motion.div
            layout
            transition={reduceMotion ? { duration: 0 } : SPOTLIGHT_SPRING}
            style={{
              position: 'absolute',
              top: spotRect.y,
              left: spotRect.x,
              width: spotRect.width,
              height: spotRect.height,
              borderRadius: 12,
              pointerEvents: 'none',
              boxShadow: hasTarget
                ? `0 0 0 2px var(--marigold, #e8a93a), 0 0 0 9999px ${SCRIM}`
                : `0 0 0 9999px ${SCRIM}`,
            }}
          />
          {reduceMotion ? (
            <motion.div
              ref={cardRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              style={{ ...cardBaseStyle, transform: cardTransform }}
            >
              {cardContent}
            </motion.div>
          ) : (
            <motion.div
              ref={cardRef}
              initial={{ opacity: 0, transform: cardEnterTransform }}
              animate={{ opacity: 1, transform: cardTransform }}
              transition={entered ? SPOTLIGHT_SPRING : ENTRANCE}
              onAnimationComplete={() => setEntered(true)}
              style={cardBaseStyle}
            >
              {cardContent}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Run the overlay test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/SpotlightOverlay.test.tsx`
Expected: PASS (10 tests). jsdom notes baked into the design: `usePrefersReducedMotion` defaults true (reduced paths run), `useTourViewport` falls back to `'desktop'` without matchMedia, `scrollIntoView?.()` is optional-called, ResizeObserver is guarded.

- [ ] **Step 5: Lint and commit**

Run lint (baseline unchanged), then:

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/notepad/onboarding/tour/SpotlightOverlay.tsx src/notepad/onboarding/tour/SpotlightOverlay.test.tsx src/notepad/onboarding/onboarding-types.ts && git commit -m "feat(tour): add Framer Motion SpotlightOverlay and tour-step-skipped event"
```

---

### Task 5: Anchor token sweep + source contract

**Files:**
- Modify: `src/notepad/extensions/ScriptureRefView.tsx:100`
- Modify: `src/notepad/components/Editor.tsx:453`
- Modify: `src/components/sections/notepad/StudyWindow.tsx:62`
- Modify: `src/components/sections/notepad/mobile/MobileFabMenu.tsx:132`
- Modify: `src/components/sections/notepad/mobile/HeaderLamplightFlame.tsx` (root button, ~:16)
- Modify: `src/notepad/bible/BibleStudyPane.tsx` (props + root div)
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx:229` (pass `dataTour`)
- Modify: `src/components/sections/notepad/mobile/MobileMoreSheet.tsx` (graph wrapper token only — `initialSegment` comes in Task 6)
- Modify (extend): `src/notepad/onboarding/tour/anchors.contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (attribute-only edits).
- Produces: DOM tokens `verse-chip`, `editor-page`, `studywindow-graph-tab`, `mobile-new-note-fab`, `header-flame`, `mobile-bible-reader`, `more-sheet-graph`; `BibleStudyPane` gains optional prop `dataTour?: string`.

Line numbers are landmarks from the audited tree (main @ 7de6f24) — read each file at the landmark before editing.

- [ ] **Step 1: Write the failing source-contract test**

In `src/notepad/onboarding/tour/anchors.contract.test.ts`, ADD the following (keep the existing old-token assertion untouched for now — old `tour-steps.ts` still exists until Task 8; add the new imports at the top of the file):

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');

/** Which component source carries each data-tour token (both viewports, all 9 steps). */
const TOKEN_SOURCES: Record<string, string> = {
  'new-note-sidebar-button': 'src/notepad/components/NotepadToolbar.tsx',
  'editor-page': 'src/notepad/components/Editor.tsx',
  'verse-chip': 'src/notepad/extensions/ScriptureRefView.tsx',
  'editor-bible-panel': 'src/components/sections/notepad/StudyWindow.tsx',
  'highlight-toolbar': 'src/notepad/components/Editor.tsx',
  'studywindow-graph-tab': 'src/components/sections/notepad/StudyWindow.tsx',
  'lamplight-panel-entry': 'src/components/sections/Notepad.tsx',
  'mobile-new-note-fab': 'src/components/sections/notepad/mobile/MobileFabMenu.tsx',
  'mobile-bible-reader': 'src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx',
  'more-sheet-graph': 'src/components/sections/notepad/mobile/MobileMoreSheet.tsx',
  'header-flame': 'src/components/sections/notepad/mobile/HeaderLamplightFlame.tsx',
};

describe('tour anchor tokens exist in their owning component source', () => {
  it.each(Object.entries(TOKEN_SOURCES))('%s → %s', (token, file) => {
    const source = readFileSync(resolve(REPO_ROOT, file), 'utf8');
    expect(source, `${file} must carry the ${token} token`).toContain(token);
  });
});
```

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/anchors.contract.test.ts`
Expected: FAIL for the 7 net-new tokens; PASS for the 4 pre-existing desktop tokens and the old assertion.

- [ ] **Step 2: Add the tokens (one edit per file)**

1. `src/notepad/extensions/ScriptureRefView.tsx:100` — the NodeView root:
```tsx
<NodeViewWrapper as="span" className="scripture-ref" data-tour="verse-chip">
```
2. `src/notepad/components/Editor.tsx:453` — the editor scroll container (keep the existing testid and style):
```tsx
<div data-testid="editor-scroll" data-tour="editor-page" style={{ flex: 1, overflowY: 'auto', /* …existing style unchanged… */ }}>
```
3. `src/components/sections/notepad/StudyWindow.tsx:62` — the GRAPH tab button, mirroring the bible button at :59:
```tsx
<button data-tour="studywindow-graph-tab" role="tab" aria-selected={tab === 'graph'} onClick={() => setTab('graph')} style={tabStyle(tab === 'graph')}>
```
(Only add the `data-tour` attribute; keep every existing prop exactly as found.)
4. `src/components/sections/notepad/mobile/MobileFabMenu.tsx:132` — the gold 52px FAB button: add `data-tour="mobile-new-note-fab"` to its attributes (the `<button type="button" aria-label={open ? 'Close menu' : 'New note menu'} …>` element).
5. `src/components/sections/notepad/mobile/HeaderLamplightFlame.tsx` — the root `<button aria-label="Lamplight" …>` (~:16): add `data-tour="header-flame"`. This single edit covers both the Notes and Editor header usages.
6. `src/notepad/bible/BibleStudyPane.tsx` — add an optional prop and render it on the root div (desktop StudyWindow usage stays untouched):
```tsx
// props interface / signature gains:
dataTour?: string;
// root element (currently <div className="flex flex-col h-full">):
<div data-tour={dataTour} className="flex flex-col h-full">
```
(React omits the attribute when `dataTour` is undefined.)
7. `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx:229` — the bible tab render:
```tsx
<BibleStudyPane
  dataTour="mobile-bible-reader"
  lamplightAdapter={model.lamplightAdapter}
  invoke={model.invoke}
  streamInvoke={model.streamInvoke}
/>
```
8. `src/components/sections/notepad/mobile/MobileMoreSheet.tsx` — inside the scroll container (`<div className="flex-1 min-h-0 overflow-y-auto">`, ~:84), wrap the **graph segment's non-peek GraphPane render** in a token wrapper:
```tsx
<div data-tour="more-sheet-graph" className="h-full min-h-0">
  <GraphPane graphOpen embedded />
</div>
```
(Keep the NodePeek branch and all other segments exactly as found.)

- [ ] **Step 3: Run the contract test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/anchors.contract.test.ts`
Expected: PASS — all 11 token→source pairs plus the untouched old assertion.

- [ ] **Step 4: Run the full suite (attribute edits must not regress anything)**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm test`
Expected: all green.

- [ ] **Step 5: Lint and commit**

Run lint (baseline unchanged), then:

```bash
cd /Users/newmac/Downloads/Psalms_app && git add -A src/notepad/extensions/ScriptureRefView.tsx src/notepad/components/Editor.tsx src/components/sections/notepad/StudyWindow.tsx src/components/sections/notepad/mobile/MobileFabMenu.tsx src/components/sections/notepad/mobile/HeaderLamplightFlame.tsx src/notepad/bible/BibleStudyPane.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx src/components/sections/notepad/mobile/MobileMoreSheet.tsx src/notepad/onboarding/tour/anchors.contract.test.ts && git commit -m "feat(tour): add per-viewport data-tour anchor tokens + source contract"
```

---

### Task 6: Mobile workspace registration

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileMoreSheet.tsx` (export `DetailSegment`, add `initialSegment` prop)
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` (register controls; wire `initialSegment`)

**Interfaces:**
- Consumes: `registerWorkspaceControls` (Task 1); existing state `tab`/`setTab` (:43–45), `moreOpen`/`setMoreOpen` (:46), `authOpen`/`setAuthOpen` (:47), `handleSelectTab` (:100), `MobileMoreSheet` render (:241–245).
- Produces: registry entries `mobileSetTab`, `mobileOpenMoreSheet`, `openAuth` (mobile); `MobileMoreSheet` prop `initialSegment?: DetailSegment` and exported type `DetailSegment`.

No new unit test in this task: mounting `MobileNotepadWorkspace`/`MobileMoreSheet` requires the full workspace-model/provider stack (jsdom-infeasible). The registry mechanics are covered by Task 1's tests; this wiring is exercised end-to-end in Task 9's runtime checklist.

- [ ] **Step 1: MobileMoreSheet — export the segment type and apply `initialSegment` on open-flip**

In `src/components/sections/notepad/mobile/MobileMoreSheet.tsx`:

a. Export the existing segment type (~:14): `export type DetailSegment = 'backlinks' | 'info' | 'graph';`
b. Add the prop to the existing props type (~:16–20), keeping `open`/`onClose`/`onOpenNote` exactly as found:
```ts
initialSegment?: DetailSegment;
```
c. Destructure `initialSegment` in the component signature, then add this effect near the existing state (after `handleSegment`, ~:47). It runs every render but acts only on the open flip, so no dependency-array lint issues:
```tsx
const wasOpen = useRef(false);
useEffect(() => {
  if (open && !wasOpen.current && initialSegment) handleSegment(initialSegment);
  wasOpen.current = open;
});
```
(Add `useEffect`/`useRef` to the existing react import if missing. `handleSegment` is the existing handler that resets the peek and sets the segment — reusing it keeps the two open paths identical.)

- [ ] **Step 2: MobileNotepadWorkspace — register the mobile controls**

In `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`:

a. Imports:
```ts
import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';
import type { DetailSegment } from './MobileMoreSheet';
```
(Merge with the existing `MobileMoreSheet` import; add `useEffect` to the react import if missing.)

b. New state next to `moreOpen` (:46):
```ts
const [moreSheetSegment, setMoreSheetSegment] = useState<DetailSegment | undefined>(undefined);
```

c. Registration effect (place after the state declarations). `mobileSetTab` mirrors `handleSelectTab` semantics — closing the sheet on any tab switch — and both paths clear the tour's segment override so a later manual open starts fresh:
```tsx
useEffect(() => {
  return registerWorkspaceControls({
    mobileSetTab: (nextTab) => {
      setMoreOpen(false);
      setMoreSheetSegment(undefined);
      setTab(nextTab);
    },
    mobileOpenMoreSheet: (segment) => {
      setMoreSheetSegment(segment);
      setMoreOpen(true);
    },
    openAuth: () => setAuthOpen(true),
  });
}, []);
```
(useState setters are stable — the empty dependency array is exhaustive-deps-clean.)

d. Wire the sheet render (:241–245): add `initialSegment={moreSheetSegment}` and clear the override on close:
```tsx
<MobileMoreSheet
  open={moreOpen}
  onClose={() => {
    setMoreOpen(false);
    setMoreSheetSegment(undefined);
  }}
  onOpenNote={handleOpenNote}
  initialSegment={moreSheetSegment}
/>
```
(Keep any other existing props exactly as found.)

- [ ] **Step 3: Full suite + lint**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm test` — all green.
Run lint — baseline unchanged, nothing referencing the touched files.

- [ ] **Step 4: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/components/sections/notepad/mobile/MobileMoreSheet.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx && git commit -m "feat(tour): register mobile workspace controls and More-sheet initial segment"
```

---

### Task 7: Desktop + shared registration

**Files:**
- Modify: `src/components/sections/Notepad.tsx` (DesktopNotepadWorkspace ~:34–39; NotepadOnboardingOverlay :328–347)
- Modify: `src/components/sections/notepad/StudyWindow.tsx` (~:24)

**Interfaces:**
- Consumes: `registerWorkspaceControls` (Task 1); `buildTourSampleNote`, `TOUR_SAMPLE_NOTE_TITLE` (Task 2); existing `useNoteCollection()` (`collection.createNote/openNote/updateNote`, state `notes`), `setGraphOpen` (Notepad.tsx:35–37), `setTab` (StudyWindow.tsx:24), `useNavigate` (react-router-dom).
- Produces: registry entries `desktopSetGraphOpen`, `openAuth` (desktop → `/login`), `desktopSetStudyTab`, `createSampleNote`, `openNote`.

No new unit test (same jsdom-infeasibility rationale as Task 6; covered by Task 1 tests + Task 9 runtime checklist).

- [ ] **Step 1: DesktopNotepadWorkspace — graph pane + desktop auth**

In `src/components/sections/Notepad.tsx`, inside `DesktopNotepadWorkspace` (after the state block at :34–39):

```tsx
const navigate = useNavigate();
useEffect(() => {
  return registerWorkspaceControls({
    desktopSetGraphOpen: (open) => setGraphOpen(open),
    // Desktop auth entry is the /login route (LoginPage → AuthCard, which
    // includes a signup mode) — resolved open item 1; MobileAuthModal is
    // mobile-only.
    openAuth: () => navigate('/login'),
  });
}, [navigate]);
```

Imports to add/merge at the top of Notepad.tsx:
```ts
import { useNavigate } from 'react-router-dom';
import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';
```
(Check first — either may already be imported; add `useEffect`/`useRef` to the react import if missing.)

- [ ] **Step 2: NotepadOnboardingOverlay — shared, idempotent `createSampleNote`**

In the same file, inside `NotepadOnboardingOverlay` (:328–347) — this component is mounted on **both** viewports, which is why the shared controls live here (they survive the 768px remount). Extend the existing `const { collection } = useNoteCollection();` destructure and add:

```tsx
const { collection, notes } = useNoteCollection();
const notesRef = useRef(notes);
notesRef.current = notes;

useEffect(() => {
  return registerWorkspaceControls({
    // Idempotent (spec §6): an existing sample note is detected by its exact
    // locked title and reused — Back/replay/viewport-switch never duplicates.
    createSampleNote: async () => {
      const existing = notesRef.current.find((note) => note.title === TOUR_SAMPLE_NOTE_TITLE);
      if (existing) {
        collection.openNote(existing.id);
        return existing.id;
      }
      const note = await collection.createNote('root', 'devotion');
      const sample = buildTourSampleNote();
      await collection.updateNote(note.id, { title: sample.title, content: sample.content });
      collection.openNote(note.id);
      return note.id;
    },
    openNote: (id) => collection.openNote(id),
  });
}, [collection]);
```

Imports to add/merge:
```ts
import { TOUR_SAMPLE_NOTE_TITLE, buildTourSampleNote } from '@/notepad/onboarding/guided-note/guided-note-template';
```
(The `'root'`/`'devotion'` arguments mirror the existing `createGuidedNote` in this same component.)

- [ ] **Step 3: StudyWindow — register the study tab**

In `src/components/sections/notepad/StudyWindow.tsx`, after the tab state (:24):

```tsx
useEffect(() => {
  return registerWorkspaceControls({
    desktopSetStudyTab: (next) => setTab(next),
  });
}, []);
```

Imports to add/merge:
```ts
import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';
```
(`StudyTab` = `'bible' | 'graph'` matches the registry's `StudyWindowTab` union exactly.)

- [ ] **Step 4: Full suite + lint**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm test` — all green.
Run lint — baseline unchanged.

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app && git add src/components/sections/Notepad.tsx src/components/sections/notepad/StudyWindow.tsx && git commit -m "feat(tour): register desktop and shared workspace controls"
```

---

### Task 8: Cutover — rewrite tour-steps, swap OnboardingSurfaces, delete SpotlightTour

**Files:**
- Rewrite: `src/notepad/onboarding/tour/tour-steps.ts`
- Rewrite: `src/notepad/onboarding/tour/tour-steps.test.ts`
- Rewrite: `src/notepad/onboarding/tour/anchors.contract.test.ts` (replace the old token assertion with the per-viewport lists; keep the Task 5 source contract)
- Modify: `src/notepad/onboarding/OnboardingSurfaces.tsx` (~:135–155)
- Delete: `src/notepad/onboarding/tour/SpotlightTour.tsx`, `src/notepad/onboarding/tour/SpotlightTour.test.tsx`

**Interfaces:**
- Consumes: `TourStep`, `TourRunContext`, `TourViewport` (Task 3); `WorkspaceControls` (Task 1); `SpotlightOverlay` (Task 4); `getWorkspaceControls` (Task 1); existing `markTourDone` in OnboardingSurfaces.
- Produces: `TOUR_STEPS: TourStep[]` (9 entries), `TOUR_ANCHOR_TOKENS: Record<TourViewport, Array<string | null>>`.

- [ ] **Step 1: Rewrite the steps test (failing against the old module)**

Replace the entire contents of `src/notepad/onboarding/tour/tour-steps.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { TourRunContext } from './tour-engine';
import { TOUR_ANCHOR_TOKENS, TOUR_STEPS } from './tour-steps';

function makeCtx(viewport: 'desktop' | 'mobile', sampleNoteId: string | null = null): TourRunContext {
  return { viewport, sampleNoteId };
}

describe('TOUR_STEPS', () => {
  it('has the nine approved moments in order (locked decision 2)', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      'welcome',
      'create-note',
      'sample-page',
      'verse-links',
      'bible-beside',
      'highlights',
      'graph-map',
      'lamplight',
      'make-it-yours',
    ]);
  });

  it('uses the approved copy verbatim (spot checks from spec §5)', () => {
    expect(TOUR_STEPS[0].copy.title).toBe('The first page is open.');
    expect(TOUR_STEPS[0].copy.body).toBe(
      'A one-minute walk through your study space. Skip anytime — it will keep.',
    );
    expect(TOUR_STEPS[2].copy.body).toBe(
      "Here's a sample study, opened so you can see the page at work. Write the way you think — the page keeps up.",
    );
    expect(TOUR_STEPS[7].copy.title).toBe('Meet Lamplight. 🕯');
    expect(TOUR_STEPS[8].copy.body).toBe(
      'A free account keeps your notes on every device — and lights Lamplight for the road ahead.',
    );
  });

  it('step 4 is the only step with per-viewport body copy', () => {
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
      'highlight-toolbar',
      'studywindow-graph-tab',
      'lamplight-panel-entry',
      null,
    ]);
    expect(TOUR_ANCHOR_TOKENS.mobile).toEqual([
      null,
      'mobile-new-note-fab',
      'editor-page',
      'verse-chip',
      'mobile-bible-reader',
      'highlight-toolbar',
      'more-sheet-graph',
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

    it('step 2 mobile switches to the editor tab only after the note is open', async () => {
      const calls: string[] = [];
      const controls = {
        createSampleNote: vi.fn(async () => {
          calls.push('create');
          return 'sample-1';
        }),
        mobileSetTab: vi.fn(() => {
          calls.push('tab');
        }),
      };
      await TOUR_STEPS[2].prepare?.(controls, makeCtx('mobile'));
      expect(calls).toEqual(['create', 'tab']);
      expect(controls.mobileSetTab).toHaveBeenCalledWith('editor');
    });

    it('steps 3 and 5 also ensure the sample note (Back-safe)', async () => {
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

    it('step 6 desktop shows the Graph tab; mobile opens the More sheet on Graph', async () => {
      const desktopSetGraphOpen = vi.fn();
      const desktopSetStudyTab = vi.fn();
      await TOUR_STEPS[6].prepare?.({ desktopSetGraphOpen, desktopSetStudyTab }, makeCtx('desktop'));
      expect(desktopSetGraphOpen).toHaveBeenCalledWith(true);
      expect(desktopSetStudyTab).toHaveBeenCalledWith('graph');
      const mobileOpenMoreSheet = vi.fn();
      await TOUR_STEPS[6].prepare?.({ mobileOpenMoreSheet }, makeCtx('mobile'));
      expect(mobileOpenMoreSheet).toHaveBeenCalledWith('graph');
    });

    it('step 7 mobile returns to the editor tab (closes the More sheet); desktop is a no-op', async () => {
      const mobileSetTab = vi.fn();
      await TOUR_STEPS[7].prepare?.({ mobileSetTab }, makeCtx('mobile'));
      expect(mobileSetTab).toHaveBeenCalledWith('editor');
      mobileSetTab.mockClear();
      await TOUR_STEPS[7].prepare?.({ mobileSetTab }, makeCtx('desktop'));
      expect(mobileSetTab).not.toHaveBeenCalled();
    });

    it('steps 0 and 8 are centered with no prepare', () => {
      expect(TOUR_STEPS[0].anchor('desktop')).toBeNull();
      expect(TOUR_STEPS[0].prepare).toBeUndefined();
      expect(TOUR_STEPS[8].anchor('mobile')).toBeNull();
      expect(TOUR_STEPS[8].prepare).toBeUndefined();
    });
  });
});
```

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/onboarding/tour/tour-steps.test.ts`
Expected: FAIL — old module has no `TOUR_ANCHOR_TOKENS`, old step shape.

- [ ] **Step 2: Rewrite `tour-steps.ts`**

Replace the entire contents of `src/notepad/onboarding/tour/tour-steps.ts` with:

```ts
import type { TourRunContext, TourStep, TourViewport } from './tour-engine';
import type { WorkspaceControls } from './workspace-controller';

// The nine tour moments (spec §3; copy §5 verbatim). Pure data: anchors are
// per-viewport data-tour tokens; prepare actions drive the app exclusively
// through the WorkspaceController registry (locked decision 1).

async function ensureSampleNoteOpen(
  controls: Readonly<WorkspaceControls>,
  ctx: TourRunContext,
): Promise<void> {
  if (ctx.sampleNoteId === null) {
    ctx.sampleNoteId = (await controls.createSampleNote?.()) ?? null;
  } else {
    controls.openNote?.(ctx.sampleNoteId);
  }
  // Mobile: the editor tab only sticks once a note is active (effectiveTab
  // guard in MobileNotepadWorkspace), so switch tabs after opening.
  if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    placement: 'center',
    copy: {
      title: 'The first page is open.',
      body: 'A one-minute walk through your study space. Skip anytime — it will keep.',
    },
    anchor: () => null,
  },
  {
    id: 'create-note',
    placement: { desktop: 'right', mobile: 'top' },
    copy: {
      title: 'Every study starts here.',
      body: 'Notes, devotions, sermons — each one begins behind this button.',
    },
    anchor: (viewport) =>
      viewport === 'desktop' ? 'new-note-sidebar-button' : 'mobile-new-note-fab',
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('notes');
    },
  },
  {
    id: 'sample-page',
    placement: 'bottom',
    copy: {
      title: 'The page is yours.',
      body: "Here's a sample study, opened so you can see the page at work. Write the way you think — the page keeps up.",
    },
    anchor: () => 'editor-page',
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'verse-links',
    placement: 'bottom',
    copy: {
      title: 'Verses become living links.',
      body: 'Type /verse and the passage drops right into your note. Tap one to read it in place.',
    },
    anchor: () => 'verse-chip',
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'bible-beside',
    placement: { desktop: 'left', mobile: 'top' },
    copy: {
      title: 'Scripture beside your page.',
      body: {
        desktop: 'Read and write side by side. The Bible stays open next to your note.',
        mobile: 'The whole Bible, one tab away from your note.',
      },
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'editor-bible-panel' : 'mobile-bible-reader'),
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'desktop') {
        controls.desktopSetGraphOpen?.(true);
        controls.desktopSetStudyTab?.('bible');
      } else {
        controls.mobileSetTab?.('bible');
      }
    },
  },
  {
    id: 'highlights',
    placement: { desktop: 'bottom', mobile: 'top' },
    copy: {
      title: 'Mark what speaks to you.',
      body: 'Highlight in textures that read like real ink.',
    },
    anchor: () => 'highlight-toolbar',
    // "Return to editor" (spec §3): mobile switches back to the editor tab;
    // desktop is a no-op beyond reusing the still-open sample note.
    prepare: ensureSampleNoteOpen,
  },
  {
    id: 'graph-map',
    placement: { desktop: 'left', mobile: 'top' },
    copy: {
      title: 'Your notebook becomes a map.',
      body: 'As notes link to verses and to each other, a map takes shape — of what God keeps drawing you toward.',
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'studywindow-graph-tab' : 'more-sheet-graph'),
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'desktop') {
        controls.desktopSetGraphOpen?.(true);
        controls.desktopSetStudyTab?.('graph');
      } else {
        controls.mobileOpenMoreSheet?.('graph');
      }
    },
  },
  {
    id: 'lamplight',
    placement: { desktop: 'left', mobile: 'bottom' },
    copy: {
      title: 'Meet Lamplight. 🕯',
      body: 'A companion for the mid-reading question. Ask what a verse means, where a thread leads, what to study next.',
    },
    anchor: (viewport) => (viewport === 'desktop' ? 'lamplight-panel-entry' : 'header-flame'),
    // Spec §3 lists "none"; on mobile the More sheet from step 6 covers the
    // header flame, so returning to the editor tab (which closes the sheet,
    // mirroring handleSelectTab) is a mechanical necessity per §6 — not a
    // product fork. Desktop stays a true no-op.
    prepare: (controls, ctx) => {
      if (ctx.viewport === 'mobile') controls.mobileSetTab?.('editor');
    },
  },
  {
    id: 'make-it-yours',
    placement: 'center',
    copy: {
      title: 'Make it yours.',
      body: 'A free account keeps your notes on every device — and lights Lamplight for the road ahead.',
    },
    anchor: () => null,
  },
];

/** Per-viewport anchor-token lists locked by the anchors contract test. */
export const TOUR_ANCHOR_TOKENS: Record<TourViewport, Array<string | null>> = {
  desktop: TOUR_STEPS.map((step) => step.anchor('desktop')),
  mobile: TOUR_STEPS.map((step) => step.anchor('mobile')),
};
```

- [ ] **Step 3: Finish the anchors contract test**

In `src/notepad/onboarding/tour/anchors.contract.test.ts`: delete the old 5-token assertion block (it referenced the old `TOUR_STEPS` shape) and add, alongside the Task 5 source contract (which stays):

```ts
import { TOUR_ANCHOR_TOKENS } from './tour-steps';

describe('tour anchors contract — step ↔ token lists (drift fails CI)', () => {
  it('desktop tokens, in step order', () => {
    expect(TOUR_ANCHOR_TOKENS.desktop).toEqual([
      null,
      'new-note-sidebar-button',
      'editor-page',
      'verse-chip',
      'editor-bible-panel',
      'highlight-toolbar',
      'studywindow-graph-tab',
      'lamplight-panel-entry',
      null,
    ]);
  });

  it('mobile tokens, in step order', () => {
    expect(TOUR_ANCHOR_TOKENS.mobile).toEqual([
      null,
      'mobile-new-note-fab',
      'editor-page',
      'verse-chip',
      'mobile-bible-reader',
      'highlight-toolbar',
      'more-sheet-graph',
      'header-flame',
      null,
    ]);
  });
});
```

(Remove any now-unused imports from the old assertion.)

- [ ] **Step 4: Swap OnboardingSurfaces and delete the old tour**

In `src/notepad/onboarding/OnboardingSurfaces.tsx` (~:135–155), replace the SpotlightTour portal render:

```tsx
createPortal(
  <SpotlightOverlay
    steps={TOUR_STEPS}
    onComplete={markTourDone}
    onSkip={markTourDone}
    onSignUp={() => {
      // Fixes the old onSignUp no-op TODO (spec §3 step 8): finish the tour,
      // then open the viewport's auth surface via the registry (desktop →
      // /login route, mobile → MobileAuthModal).
      markTourDone();
      getWorkspaceControls().openAuth?.();
    }}
  />,
  document.body,
  'start-tour',
)
```

Replace the `SpotlightTour` import with:
```ts
import { SpotlightOverlay } from './tour/SpotlightOverlay';
import { TOUR_STEPS } from './tour/tour-steps';
import { getWorkspaceControls } from './tour/workspace-controller';
```

Then delete the superseded files:
```bash
cd /Users/newmac/Downloads/Psalms_app && git rm src/notepad/onboarding/tour/SpotlightTour.tsx src/notepad/onboarding/tour/SpotlightTour.test.tsx
```

Verify nothing else references the old component:
```bash
cd /Users/newmac/Downloads/Psalms_app && grep -rn "SpotlightTour\|TOUR_SIGNUP_CARD" src && echo "STALE REFERENCES FOUND" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 5: Run the full suite**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm test`
Expected: all green — including the rewritten tour-steps + contract tests and the untouched `OnboardingSurfaces.test.tsx` (verified: it never exercises the start-tour path).

- [ ] **Step 6: Lint and commit**

Run lint (baseline unchanged), then:

```bash
cd /Users/newmac/Downloads/Psalms_app && git add -A src/notepad/onboarding && git commit -m "feat(tour): cut over to 9-step dual-viewport walkthrough, remove SpotlightTour"
```

---

### Task 9: Full-suite gate + runtime verification (visible chrome-devtools browser)

**Files:** none (verification; fixes route back to the owning task's files).

- [ ] **Step 1: Gates**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm test` — all green.
Run: `npm run lint 2>&1 | tail -3` — exactly the Task 1 baseline (124 pre-existing errors), none in files this plan touched.

- [ ] **Step 2: Start the dev server**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm run dev` (background). Note the printed localhost URL.

- [ ] **Step 3: Desktop pass (visible chrome-devtools browser — NEVER the hidden Claude_Preview tab)**

Open the app URL in the chrome-devtools-controlled visible browser. Reset the tour: in the console, `localStorage.removeItem('onboarding_anon_tour_done')`, then reload.

- [ ] Tour auto-starts on the anonymous notebook (welcome card, scrim, no console errors).
- [ ] Step 1 spotlights the sidebar new-note button; card to its right.
- [ ] Step 2 creates + opens **"A guided study (sample)"** and spotlights the editor page.
- [ ] Step 3 spotlights the verse chip (John 3:16) inside the sample note, scrolled into view.
- [ ] Step 4 opens the study pane on the Bible tab and spotlights it.
- [ ] Step 5 spotlights the Decorate (highlight) toolbar button.
- [ ] Step 6 switches the study pane to Graph and spotlights the Graph tab button.
- [ ] Step 7 spotlights the Lamplight tab entry; the 🕯 in the card flickers subtly.
- [ ] Step 8 centered finale; **"Create free account" navigates to `/login`**; "Not yet — keep exploring" completes.
- [ ] Back works from every step; rapid Next is interruptible (morph retargets mid-flight); ArrowLeft/ArrowRight navigate; Escape skips instantly.
- [ ] Complete → reload → tour does NOT restart. "Replay tour" in the Get Started panel restarts it; the sample note is **reused, not duplicated** (still exactly one "A guided study (sample)").

- [ ] **Step 4: Mobile pass (375×812)**

Emulate 375x812x2, mobile, touch; reload; wait ~1s settle. Reset the done-flag again first.

- [ ] Step 1 switches to the Notes tab and spotlights the gold FAB.
- [ ] Step 2 opens the sample note on the Editor tab and spotlights the page.
- [ ] Step 3 spotlights the verse chip.
- [ ] Step 4 switches to the Bible tab and spotlights the reader (John 1 content visible).
- [ ] Step 5 returns to the editor; the Decorate button is **visible at 375px** (horizontal scrollIntoView worked — spec §3's explicit VERIFY).
- [ ] Step 6 opens the More sheet on the Graph segment and spotlights it (tour overlay stacks above the sheet).
- [ ] Step 7 closes the sheet, returns to the editor, spotlights the header flame.
- [ ] Step 8 CTA opens **MobileAuthModal**.
- [ ] Mid-tour viewport switch: resize desktop→375px on step 4 — the tour holds on the scrim, then re-prepares and re-anchors for mobile without duplicating the sample note.

- [ ] **Step 5: Reduced motion**

Emulate `prefers-reduced-motion: reduce` (chrome-devtools rendering emulation), reset the flag, reload: no travel (cutout repositions instantly), card/copy crossfade only, scroll jumps, no flame flicker.

- [ ] **Step 6: Final commit (only if fixes were needed)**

If any checklist item forced a code fix, re-run `npm test` + lint, then commit the fixes with a descriptive `fix(tour): …` message. Do NOT push.

---

## Plan self-review record

- **Spec coverage:** §1 decisions 1–7 → Tasks 1–8 (drive-the-app via registry T1/T6/T7; 9 steps T8; parity via per-viewport anchors/prepares T5/T8; trigger/replay untouched — OnboardingSurfaces gate kept T8; Next-only advance — overlay buttons T4; sample kept + titled T2/T7; framer-motion engine T3/T4). §2 architecture → T3 (engine), T1 (registry), T4 (overlay), §2.4 kept-as-is honored. §3 table → T8 steps data + T5 tokens (incl. every grounding note: effectiveTab guard ordering, Decorate-only-with-active-note, editor-scroll owner, John 1 default, zero-width StudyWindow pane). §4 motion → T4 (spring constants, sequencing, asymmetric copy swap, pill progress, single flicker, 200ms exits, reduced-motion, transform-only). §5 copy → T8 verbatim + tests. §6 edge cases → T3 (retry/skip-forward/instant skip), T7 (idempotent create), T3+T4 (viewport re-run), z-[100] layering, reload-restart unaffected. §7 testing → contract (T5/T8), engine + registry units (T1/T3), runtime checklist (T9). §8 audit facts respected. §9 out-of-scope respected (no bus restructure — additive id only; no new deps; PR #74 untouched).
- **Placeholder scan:** no TBD/TODO-style steps; every code step carries complete code; landmark-based edits (T5–T7) specify the exact attribute/block to add against handoff-verified line anchors.
- **Type consistency:** `WorkspaceControls` keys match across T1 (definition), T6/T7 (registration), T8 (prepare usage); `TourStep`/`TourRunContext`/`resolveAnchor(token, signal)` signatures match across T3/T4/T8; `DetailSegment` ≡ `MoreSheetSegment` literal unions; `TOUR_SAMPLE_NOTE_TITLE` used for both build (T2) and detection (T7).
