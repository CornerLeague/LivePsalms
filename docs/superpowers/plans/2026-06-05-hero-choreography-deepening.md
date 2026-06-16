# HeroChoreography Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the hero animation layer (`HeroDesktop.tsx` 820 lines / `HeroMobile.tsx` 299 lines, zero tests) into per-scene keyframe **data** + pure invariant helpers (the "score") executed by thin GSAP/ScrollTrigger harnesses, plus one node-testable `HeroIntroSequence` state-machine controller — so the choreography gets focused node tests and one source of truth across desktop/mobile, instead of being reachable only by eyeballing the browser.

**Architecture:** A new `src/components/sections/hero-choreography/` directory holds the keyframe grammar (`Keyframe` + `applyKeyframes` + `projectFinalFrame`), the shared `WORDMARK_COLLAPSE` geometry + `wordmarkAuraSizes`, the three desktop scrub scenes as data (`collapseKeyframes`, `maskExpandKeyframes`, `quoteFadeKeyframes`), and the `HeroIntroSequence` controller (extends the shared `Observable` base, deps-injected, fake-`play` testable — mirrors `PurposeDetailReveal`). The shared `bridgeCascadeKeyframes` builder lives alongside `BRIDGE_PIN_TIMING` in `hero-bridge-content.ts`. `applyKeyframes` is the only GSAP-coupled step; the `gsap.context()`/ScrollTrigger lifecycle stays in thin component effects. The design is recorded under `## HeroChoreography`, `## WordmarkGeometry`, `## bridgeCascadeKeyframes`, `## HeroIntroSequence`, `## wordmarkAuraSizes` in `docs/CONTEXT.md`.

**Tech Stack:** TypeScript ~5.9, React 19, Vite, GSAP + ScrollTrigger, Vitest (default env `node`; React tests opt into `// @vitest-environment jsdom`), `@testing-library/react`.

**Test runner:** `npx vitest run` runs the whole suite. One file: `npx vitest run <path>`. Build check: `npm run build`.

**Behavior preserved exactly (so reviewers don't flag regressions — GSAP sniffs literal values, like the MoodBoard verbatim-token rule):**
1. Letter collapse offsets: `P 653.3, S1 339.8, L −313.9, M −690.5, S2 −1076.4` (SVG-userspace units) — identical desktop & mobile.
2. Aura/ring ratios off measured wordmark width: aura ×0.6545, ring-initial ×0.2364, ring-final ×2.5455.
3. Bridge kiss-handoff fractions from `BRIDGE_PIN_TIMING`; desktop text-2 enter `x:120`, mobile `x:30`; mobile `scrub` × `MOBILE_TIME_SCALE`.
4. Collapse scrub: bloom 0→0.150, wave-1 (S₂) at 0.150, wave-2 (P+M) at 0.221, wave-3 (S₁+L) at 0.292, A-pulse 0.504/0.575, ring bloom 0.568→expand 0.588→fade 0.678, color flash `#5A4520` at 0.568 → `#3A3426` at 0.604; `onUpdate` publishes `setNavCollapseProgress(self.progress)`.
5. Mask scrub: clip 75/45%→100/100% & image scale 1.15→1 over 0→0.55; video crossfade opacity 0→1 at 0.70; video `.play()` kicks at progress ≥ 0.65.
6. Intro: A enters 0.3, lub 2.10, dub 2.85, ring 2.97, letter spread waves 4.20/4.65/5.10, handoff beat 6.40 (fires `onHandoff` + reveals nav), `onIntroComplete` at timeline end; plays once.
7. Reduced-motion end-states unchanged: quote 3 lines visible; mask clip 100/100 + video playing; collapse carve-out (siblings opacity→0, A opacity→1, no x) on `IntersectionObserver`; bridge carve-out (all 3 beats visible, static flow).

**New behavior:** none intended. This is a faithful refactor; the only externally-visible surface that moves is `showNav`, now derived from `HeroIntroSequence` status instead of a local `setShowNav` call (fires at the same 6.40 handoff beat).

---

### Task 1: WordmarkGeometry — shared collapse offsets + `wordmarkAuraSizes`

The five letter offsets are copy-pasted verbatim across `HeroDesktop.tsx:21-27` and `HeroMobile.tsx:16`; the aura/ring ratio math is inline in `HeroDesktop.tsx:303-311`. Both become one shared, node-tested module.

**Files:**
- Create: `src/components/sections/hero-choreography/wordmark-geometry.ts`
- Test: `src/components/sections/hero-choreography/wordmark-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/sections/hero-choreography/wordmark-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WORDMARK_COLLAPSE, wordmarkAuraSizes } from './wordmark-geometry';

describe('WORDMARK_COLLAPSE', () => {
  it('carries the five SVG-userspace letter offsets verbatim', () => {
    expect(WORDMARK_COLLAPSE).toEqual({
      P: 653.3,
      S1: 339.8,
      L: -313.9,
      M: -690.5,
      S2: -1076.4,
    });
  });
});

describe('wordmarkAuraSizes', () => {
  it('derives aura/ring sizes from the measured wordmark width', () => {
    expect(wordmarkAuraSizes(1100)).toEqual({
      aura: 1100 * 0.6545,
      ringInitial: 1100 * 0.2364,
      ringFinal: 1100 * 2.5455,
    });
  });

  it('scales linearly with width', () => {
    expect(wordmarkAuraSizes(550).aura).toBeCloseTo(wordmarkAuraSizes(1100).aura / 2, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/wordmark-geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./wordmark-geometry"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/hero-choreography/wordmark-geometry.ts`:

```ts
// SVG-userspace collapse offsets. Distance each letter travels from its
// settled position to the A's center, in viewBox units (positive = moves
// rightward toward A from the left side; negative = moves leftward toward
// A from the right side). Shared by the intro spread (used as the `from`)
// and both letter-collapse scrubs (used as the `to`).
export const WORDMARK_COLLAPSE = {
  P: 653.3,
  S1: 339.8,
  L: -313.9,
  M: -690.5,
  S2: -1076.4,
} as const;

export interface WordmarkAuraSizes {
  aura: number;
  ringInitial: number;
  ringFinal: number;
}

// Ratios derived from the original 1100px wordmark:
// aura 720px → 0.6545, ring initial 260px → 0.2364, ring final 2800px → 2.5455.
export function wordmarkAuraSizes(wordmarkWidth: number): WordmarkAuraSizes {
  return {
    aura: wordmarkWidth * 0.6545,
    ringInitial: wordmarkWidth * 0.2364,
    ringFinal: wordmarkWidth * 2.5455,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/wordmark-geometry.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/wordmark-geometry.ts src/components/sections/hero-choreography/wordmark-geometry.test.ts
git commit -m "feat(hero): shared WordmarkGeometry — collapse offsets + aura sizes"
```

---

### Task 2: Keyframe grammar + `applyKeyframes`

The one GSAP-coupled step that walks scene data into a timeline. `Keyframe = { target, from?, to, at, duration, ease }`; `applyKeyframes` emits `tl.set` (duration 0), `tl.fromTo` (has `from`), or `tl.to` (otherwise) — exactly the three GSAP calls the current effects use by hand.

**Files:**
- Create: `src/components/sections/hero-choreography/keyframes.ts`
- Test: `src/components/sections/hero-choreography/keyframes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/sections/hero-choreography/keyframes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyKeyframes } from './keyframes';
import type { Keyframe, KeyframeTimeline } from './keyframes';

interface Call {
  method: 'set' | 'to' | 'fromTo';
  target: unknown;
  args: unknown[];
}

function makeFakeTimeline(): { tl: KeyframeTimeline; calls: Call[] } {
  const calls: Call[] = [];
  const tl: KeyframeTimeline = {
    set: (target, vars, at) => {
      calls.push({ method: 'set', target, args: [vars, at] });
      return tl;
    },
    to: (target, vars, at) => {
      calls.push({ method: 'to', target, args: [vars, at] });
      return tl;
    },
    fromTo: (target, from, to, at) => {
      calls.push({ method: 'fromTo', target, args: [from, to, at] });
      return tl;
    },
  };
  return { tl, calls };
}

describe('applyKeyframes', () => {
  it('emits tl.set for a zero-duration keyframe with no `from`', () => {
    const { tl, calls } = makeFakeTimeline();
    const kfs: Keyframe[] = [{ target: 'a', to: { opacity: 0 }, at: 0, duration: 0 }];
    applyKeyframes(tl, kfs, { a: 'EL_A' });
    expect(calls).toEqual([{ method: 'set', target: 'EL_A', args: [{ opacity: 0 }, 0] }]);
  });

  it('emits tl.to with duration+ease folded into the vars', () => {
    const { tl, calls } = makeFakeTimeline();
    const kfs: Keyframe[] = [
      { target: 'a', to: { x: 0 }, at: 0.221, duration: 0.227, ease: 'power3.out' },
    ];
    applyKeyframes(tl, kfs, { a: 'EL_A' });
    expect(calls).toEqual([
      { method: 'to', target: 'EL_A', args: [{ x: 0, duration: 0.227, ease: 'power3.out' }, 0.221] },
    ]);
  });

  it('emits tl.fromTo when a `from` is present', () => {
    const { tl, calls } = makeFakeTimeline();
    const kfs: Keyframe[] = [
      { target: 'clip', from: { width: '75%' }, to: { width: '100%' }, at: 0, duration: 0.55, ease: 'none' },
    ];
    applyKeyframes(tl, kfs, { clip: 'EL_CLIP' });
    expect(calls).toEqual([
      {
        method: 'fromTo',
        target: 'EL_CLIP',
        args: [{ width: '75%' }, { width: '100%', duration: 0.55, ease: 'none' }, 0],
      },
    ]);
  });

  it('skips keyframes whose target is missing from the map (null-safe)', () => {
    const { tl, calls } = makeFakeTimeline();
    const kfs: Keyframe[] = [{ target: 'ghost', to: { opacity: 1 }, at: 0, duration: 1 }];
    applyKeyframes(tl, kfs, { ghost: null });
    expect(calls).toEqual([]);
  });

  it('omits ease from the vars when the keyframe has none', () => {
    const { tl, calls } = makeFakeTimeline();
    const kfs: Keyframe[] = [{ target: 'a', to: { opacity: 1 }, at: 0, duration: 1 }];
    applyKeyframes(tl, kfs, { a: 'EL_A' });
    expect(calls[0].args[0]).toEqual({ opacity: 1, duration: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/keyframes.test.ts`
Expected: FAIL — `Failed to resolve import "./keyframes"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/hero-choreography/keyframes.ts`:

```ts
export type GsapVars = Record<string, unknown>;

// A single tween/set in a scene "score". `from` present → fromTo; duration 0
// with no `from` → set; otherwise → to. `at` is the absolute timeline position.
export interface Keyframe {
  target: string;
  from?: GsapVars;
  to: GsapVars;
  at: number;
  duration: number;
  ease?: string;
}

// The narrow slice of the GSAP timeline API that applyKeyframes touches. The
// real `gsap.timeline()` satisfies this; tests pass a recording fake.
export interface KeyframeTimeline {
  set(target: unknown, vars: GsapVars, at: number): unknown;
  to(target: unknown, vars: GsapVars, at: number): unknown;
  fromTo(target: unknown, from: GsapVars, to: GsapVars, at: number): unknown;
}

// The only GSAP-coupled step in HeroChoreography. Walks declarative keyframe
// data into a timeline, resolving abstract target names to DOM elements via
// `targets`. Null/absent targets are skipped (callers guard their refs).
export function applyKeyframes(
  tl: KeyframeTimeline,
  keyframes: Keyframe[],
  targets: Record<string, unknown>,
): void {
  for (const kf of keyframes) {
    const el = targets[kf.target];
    if (el == null) continue;

    if (kf.duration === 0 && !kf.from) {
      tl.set(el, kf.to, kf.at);
      continue;
    }

    const toVars: GsapVars = { ...kf.to, duration: kf.duration };
    if (kf.ease !== undefined) toVars.ease = kf.ease;

    if (kf.from) {
      tl.fromTo(el, kf.from, toVars, kf.at);
    } else {
      tl.to(el, toVars, kf.at);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/keyframes.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/keyframes.ts src/components/sections/hero-choreography/keyframes.test.ts
git commit -m "feat(hero): Keyframe grammar + applyKeyframes (only GSAP-coupled step)"
```

---

### Task 3: `projectFinalFrame` — reduced-motion derived projection

The "reduced == last frame" helper: collapses a scene spec to each target's final merged `to`. Backs the reduced-motion paths for the two fade-only scenes (quote, mask) and the drift-catching invariant tests.

**Files:**
- Modify: `src/components/sections/hero-choreography/keyframes.ts` (append)
- Test: `src/components/sections/hero-choreography/keyframes.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/components/sections/hero-choreography/keyframes.test.ts`:

```ts
import { projectFinalFrame } from './keyframes';

describe('projectFinalFrame', () => {
  it('returns each target\'s merged final values, later keyframes overriding', () => {
    const kfs: Keyframe[] = [
      // text1: enter (visible) then exit (faded) — final = faded but at rest.
      { target: 't1', from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0, filter: 'blur(0px)' }, at: 0, duration: 0.1 },
      { target: 't1', to: { opacity: 0 }, at: 0.32, duration: 0.08 },
    ];
    expect(projectFinalFrame(kfs)).toEqual({
      t1: { opacity: 0, y: 0, filter: 'blur(0px)' },
    });
  });

  it('merges multiple same-position tweens for one target', () => {
    const kfs: Keyframe[] = [
      { target: 's2', to: { x: -1076.4 }, at: 0.15, duration: 0.227 },
      { target: 's2', to: { opacity: 0 }, at: 0.15, duration: 0.227 },
      { target: 's2', to: { filter: 'blur(6px)' }, at: 0.15, duration: 0.227 },
    ];
    expect(projectFinalFrame(kfs)).toEqual({
      s2: { x: -1076.4, opacity: 0, filter: 'blur(6px)' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/keyframes.test.ts`
Expected: FAIL — `projectFinalFrame is not a function` (or import resolve error).

- [ ] **Step 3: Write the implementation**

Append to `src/components/sections/hero-choreography/keyframes.ts`:

```ts
// Reduced-motion projection: each target's final visual state = its `to` vars
// merged in timeline order (later keyframes override earlier keys). Used by the
// fade-only reduced paths (quote, mask) and by invariant tests that assert a
// scene's reduced state equals its scrub's last frame.
export function projectFinalFrame(keyframes: Keyframe[]): Record<string, GsapVars> {
  const result: Record<string, GsapVars> = {};
  for (const kf of keyframes) {
    result[kf.target] = { ...(result[kf.target] ?? {}), ...kf.to };
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/keyframes.test.ts`
Expected: PASS (7 passing total).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/keyframes.ts src/components/sections/hero-choreography/keyframes.test.ts
git commit -m "feat(hero): projectFinalFrame reduced-motion projection helper"
```

---

### Task 4: `bridgeCascadeKeyframes` — shared three-beat builder

The six-tween bridge ladder is re-coded almost verbatim in `HeroDesktop.tsx:143-203` and `HeroMobile.tsx:126-180`, differing only by text-2's enter `x` (120 vs 30). Extract one builder living with `BRIDGE_PIN_TIMING`.

**Files:**
- Modify: `src/components/sections/hero-bridge-content.ts` (append builder)
- Test: `src/components/sections/hero-bridge-content.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/components/sections/hero-bridge-content.test.ts`:

```ts
import { bridgeCascadeKeyframes } from './hero-bridge-content';
import { projectFinalFrame } from './hero-choreography/keyframes';

describe('bridgeCascadeKeyframes', () => {
  const desktop = bridgeCascadeKeyframes({ enterX2: 120 });

  it('seeds the three initial states at t=0 (set keyframes)', () => {
    const sets = desktop.filter((k) => k.duration === 0);
    expect(sets).toEqual([
      { target: 't1', to: { opacity: 0, y: 40, filter: 'blur(10px)' }, at: 0, duration: 0 },
      { target: 't2', to: { opacity: 0, x: 120, filter: 'blur(10px)' }, at: 0, duration: 0 },
      { target: 't3', to: { opacity: 0, y: 80, filter: 'blur(10px)' }, at: 0, duration: 0 },
    ]);
  });

  it('uses the BRIDGE_PIN_TIMING kiss-handoff fractions for the enter tweens', () => {
    const enters = desktop.filter((k) => k.duration > 0 && k.to.opacity === 1);
    expect(enters.map((k) => k.at)).toEqual([0, 0.40, 0.70]);
  });

  it('threads the configurable text-2 enter offset into both the set and the slide', () => {
    const mobile = bridgeCascadeKeyframes({ enterX2: 30 });
    const set2 = mobile.find((k) => k.target === 't2' && k.duration === 0);
    expect(set2?.to.x).toBe(30);
  });

  it('reduced projection leaves text-2/3 settled at rest (carve-out hides them in JSX, not here)', () => {
    const final = projectFinalFrame(desktop);
    expect(final.t3).toMatchObject({ opacity: 0, y: 0, filter: 'blur(0px)' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-bridge-content.test.ts`
Expected: FAIL — `bridgeCascadeKeyframes is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/components/sections/hero-bridge-content.ts`:

```ts
import type { Keyframe } from './hero-choreography/keyframes';

// Builds the shared three-beat bridge cascade as keyframe data. Desktop and
// mobile call this with their own text-2 enter offset (`enterX2`: 120 desktop,
// 30 mobile — proportional to viewport). Scrub speed stays component-level
// trigger metadata (mobile multiplies by MOBILE_TIME_SCALE); the timeline
// positions are identical across platforms, driven by BRIDGE_PIN_TIMING.
export function bridgeCascadeKeyframes({ enterX2 }: { enterX2: number }): Keyframe[] {
  const { text1, text2, text3 } = BRIDGE_PIN_TIMING;
  return [
    // Initial states (t=0): t1 rises from below, t2 slides from off-right, t3 rises further.
    { target: 't1', to: { opacity: 0, y: 40, filter: 'blur(10px)' }, at: 0, duration: 0 },
    { target: 't2', to: { opacity: 0, x: enterX2, filter: 'blur(10px)' }, at: 0, duration: 0 },
    { target: 't3', to: { opacity: 0, y: 80, filter: 'blur(10px)' }, at: 0, duration: 0 },

    // Text 1 — enter (rise + blur clear), then exit (opacity only).
    { target: 't1', to: { opacity: 1, y: 0, filter: 'blur(0px)' }, ease: 'power2.out',
      at: text1.enter, duration: text1.holdStart - text1.enter },
    { target: 't1', to: { opacity: 0 }, ease: 'power1.in',
      at: text1.holdEnd, duration: text1.exit - text1.holdEnd },

    // Text 2 — horizontal slide in, then exit.
    { target: 't2', to: { opacity: 1, x: 0, filter: 'blur(0px)' }, ease: 'power2.out',
      at: text2.enter, duration: text2.holdStart - text2.enter },
    { target: 't2', to: { opacity: 0 }, ease: 'power1.in',
      at: text2.holdEnd, duration: text2.exit - text2.holdEnd },

    // Text 3 — long hold, exits in the last 5%.
    { target: 't3', to: { opacity: 1, y: 0, filter: 'blur(0px)' }, ease: 'power2.out',
      at: text3.enter, duration: text3.holdStart - text3.enter },
    { target: 't3', to: { opacity: 0 }, ease: 'power1.in',
      at: text3.holdEnd, duration: text3.exit - text3.holdEnd },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-bridge-content.test.ts`
Expected: PASS (existing 14 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-bridge-content.ts src/components/sections/hero-bridge-content.test.ts
git commit -m "feat(hero): shared bridgeCascadeKeyframes builder beside BRIDGE_PIN_TIMING"
```

---

### Task 5: `collapseKeyframes` — wordmark scroll-collapse scene

The 60-line scrub composition in `HeroDesktop.tsx:460-523` becomes data, owning the wave-overlap invariant (wave 2 starts before wave 1 ends).

**Files:**
- Create: `src/components/sections/hero-choreography/collapse-keyframes.ts`
- Test: `src/components/sections/hero-choreography/collapse-keyframes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/sections/hero-choreography/collapse-keyframes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collapseKeyframes, COLLAPSE_COLOR_DEEP_UMBER } from './collapse-keyframes';
import { WORDMARK_COLLAPSE } from './wordmark-geometry';
import type { Keyframe } from './keyframes';

const at = (kfs: Keyframe[], target: string, prop: string): Keyframe =>
  kfs.find((k) => k.target === target && prop in k.to)!;

describe('collapseKeyframes', () => {
  const kfs = collapseKeyframes();

  it('moves each letter to its WORDMARK_COLLAPSE offset', () => {
    expect(at(kfs, 'letterS2', 'x').to.x).toBe(WORDMARK_COLLAPSE.S2);
    expect(at(kfs, 'letterP', 'x').to.x).toBe(WORDMARK_COLLAPSE.P);
    expect(at(kfs, 'letterL', 'x').to.x).toBe(WORDMARK_COLLAPSE.L);
  });

  it('blooms the wordmark first (fromTo at 0)', () => {
    const bloom = kfs.find((k) => k.target === 'svg' && k.from);
    expect(bloom).toMatchObject({ at: 0, from: { opacity: 0.45 }, to: { opacity: 1.0 } });
  });

  it('WAVE-OVERLAP INVARIANT: wave 2 (P+M) starts before wave 1 (S₂) ends', () => {
    const s2 = at(kfs, 'letterS2', 'x');
    const p = at(kfs, 'letterP', 'x');
    expect(p.at).toBeLessThan(s2.at + s2.duration);
  });

  it('WAVE-OVERLAP INVARIANT: wave 3 (S₁+L) starts before wave 2 (P+M) ends', () => {
    const p = at(kfs, 'letterP', 'x');
    const s1 = at(kfs, 'letterS1', 'x');
    expect(s1.at).toBeLessThan(p.at + p.duration);
  });

  it('pulses A after the waves and flashes color to deep umber', () => {
    const pulseUp = kfs.find((k) => k.target === 'letterA' && k.to.scale === 1.06);
    expect(pulseUp?.at).toBe(0.504);
    const flash = kfs.filter((k) => k.target === 'svg' && 'color' in k.to);
    expect(flash.map((k) => k.to.color)).toEqual(['#5A4520', COLLAPSE_COLOR_DEEP_UMBER]);
  });

  it('reduced projection = final opacities (the carve-out drops x/filter at the call site)', () => {
    // Final frame has siblings at opacity 0 and A at scale 1 — the IntersectionObserver
    // carve-out applies these opacities without the x-translate.
    const s2Final = at(kfs, 'letterS2', 'opacity');
    expect(s2Final.to.opacity).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/collapse-keyframes.test.ts`
Expected: FAIL — `Failed to resolve import "./collapse-keyframes"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/hero-choreography/collapse-keyframes.ts`:

```ts
import type { Keyframe } from './keyframes';
import { WORDMARK_COLLAPSE } from './wordmark-geometry';

// Kept in sync with the `--deep-umber` CSS var (#3A3426) — GSAP can't tween a
// CSS variable cleanly, so the literal lives here (see src/index.css).
export const COLLAPSE_COLOR_DEEP_UMBER = '#3A3426';

// One collapse wave for a letter: independent x / opacity / filter eases,
// matching the standalone composition.
function wave(target: string, x: number, at: number, duration: number): Keyframe[] {
  return [
    { target, to: { x }, ease: 'power3.out', at, duration },
    { target, to: { opacity: 0 }, ease: 'power1.out', at, duration },
    { target, to: { filter: 'blur(6px)' }, ease: 'power2.out', at, duration },
  ];
}

// Scroll-collapse scene: bloom → three letter waves → A pulse → ring bloom →
// color flash. Trigger metadata (start/end/scrub/onUpdate/force3D) stays in the
// thin component effect — this is pure timeline data.
export function collapseKeyframes(): Keyframe[] {
  return [
    // Phase 1 — Bloom (0.000 → 0.150): opacity 0.45 → 1.0 + scale 0.98 → 1.0.
    { target: 'svg', from: { opacity: 0.45, scale: 0.98, transformOrigin: '50% 50%' },
      to: { opacity: 1.0, scale: 1.0 }, ease: 'power2.out', at: 0, duration: 0.150 },

    // Phase 2 — Wave 1: S₂ (0.150).
    ...wave('letterS2', WORDMARK_COLLAPSE.S2, 0.150, 0.227),
    // Phase 3 — Wave 2: P + M (0.221).
    ...wave('letterP', WORDMARK_COLLAPSE.P, 0.221, 0.227),
    ...wave('letterM', WORDMARK_COLLAPSE.M, 0.221, 0.227),
    // Phase 4 — Wave 3: S₁ + L (0.292).
    ...wave('letterS1', WORDMARK_COLLAPSE.S1, 0.292, 0.226),
    ...wave('letterL', WORDMARK_COLLAPSE.L, 0.292, 0.226),

    // Phase 5 — A pulse (0.504 → 0.575). Peak 1.06.
    { target: 'letterA', to: { scale: 1.06, transformOrigin: '50% 50%' }, ease: 'power2.out', at: 0.504, duration: 0.071 },
    { target: 'letterA', to: { scale: 1.00, transformOrigin: '50% 50%' }, ease: 'power3.out', at: 0.575, duration: 0.064 },

    // Phase 6.2 — Ring bloom + expand. width/height (not scale) keeps the 1px stroke a true hairline.
    { target: 'ring', from: { opacity: 0, width: 8, height: 8 },
      to: { opacity: 0.85, width: 24, height: 24 }, ease: 'power1.out', at: 0.568, duration: 0.020 },
    { target: 'ring', to: { width: 940, height: 940 }, ease: 'power2.out', at: 0.588, duration: 0.380 },
    { target: 'ring', to: { opacity: 0 }, ease: 'power1.inOut', at: 0.678, duration: 0.290 },

    // Phase 6.3 — A fill warming (tonal flash via the SVG's inherited `color`).
    { target: 'svg', to: { color: '#5A4520' }, ease: 'power2.out', at: 0.568, duration: 0.036 },
    { target: 'svg', to: { color: COLLAPSE_COLOR_DEEP_UMBER }, ease: 'power2.out', at: 0.604, duration: 0.156 },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/collapse-keyframes.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/collapse-keyframes.ts src/components/sections/hero-choreography/collapse-keyframes.test.ts
git commit -m "feat(hero): collapseKeyframes scene data + wave-overlap invariant"
```

---

### Task 6: `maskExpandKeyframes` + `VIDEO_PLAY_AT`

The silhouette-expand scrub in `HeroDesktop.tsx:231-254` becomes data; `VIDEO_PLAY_AT = 0.65` is carried as data so the play-before-crossfade ordering is assertable.

**Files:**
- Create: `src/components/sections/hero-choreography/mask-expand-keyframes.ts`
- Test: `src/components/sections/hero-choreography/mask-expand-keyframes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/sections/hero-choreography/mask-expand-keyframes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maskExpandKeyframes, VIDEO_PLAY_AT } from './mask-expand-keyframes';
import { projectFinalFrame } from './keyframes';

describe('maskExpandKeyframes', () => {
  const kfs = maskExpandKeyframes();

  it('grows the clip from 75/45% to 100/100% over the first 0.55', () => {
    const clip = kfs.find((k) => k.target === 'clip');
    expect(clip).toMatchObject({
      from: { width: '75%', height: '45%' },
      to: { width: '100%', height: '100%' },
      at: 0,
      duration: 0.55,
    });
  });

  it('scales the image 1.15 → 1 over the same window', () => {
    const img = kfs.find((k) => k.target === 'img');
    expect(img).toMatchObject({ from: { scale: 1.15 }, to: { scale: 1 }, at: 0, duration: 0.55 });
  });

  it('crossfades the video in at 0.70', () => {
    const video = kfs.find((k) => k.target === 'video' && k.to.opacity === 1);
    expect(video?.at).toBe(0.70);
  });

  it('PLAY-BEFORE-CROSSFADE INVARIANT: playback kicks before the visual crossfade', () => {
    const crossfade = kfs.find((k) => k.target === 'video' && k.to.opacity === 1)!;
    expect(VIDEO_PLAY_AT).toBeLessThan(crossfade.at);
  });

  it('reduced projection = clip full, image at rest, video visible', () => {
    const final = projectFinalFrame(kfs);
    expect(final.clip).toMatchObject({ width: '100%', height: '100%' });
    expect(final.img).toMatchObject({ scale: 1 });
    expect(final.video).toMatchObject({ opacity: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/mask-expand-keyframes.test.ts`
Expected: FAIL — `Failed to resolve import "./mask-expand-keyframes"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/hero-choreography/mask-expand-keyframes.ts`:

```ts
import type { Keyframe } from './keyframes';

// Scroll progress at which the video element starts playing — slightly before
// its visual crossfade (0.70) so the first visible frame is already in motion.
export const VIDEO_PLAY_AT = 0.65;

// Mask-expand scene: the silhouette clip grows to fill the viewport while the
// image de-zooms, then the video crossfades in inside the silhouette. The video
// element's initial opacity:0 is its `set` keyframe; `.play()` is fired by the
// component at VIDEO_PLAY_AT (separate ScrollTrigger.onUpdate, not tweenable data).
export function maskExpandKeyframes(): Keyframe[] {
  return [
    // Phase 1 — Expansion (0.00 → 0.55).
    { target: 'clip', from: { width: '75%', height: '45%' },
      to: { width: '100%', height: '100%' }, ease: 'none', at: 0, duration: 0.55 },
    { target: 'img', from: { scale: 1.15 }, to: { scale: 1 }, ease: 'none', at: 0, duration: 0.55 },

    // Phase 2 — Image → video crossfade (0.70 → 0.90).
    { target: 'video', to: { opacity: 0 }, at: 0, duration: 0 },
    { target: 'video', to: { opacity: 1 }, ease: 'power1.inOut', at: 0.70, duration: 0.2 },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/mask-expand-keyframes.test.ts`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/mask-expand-keyframes.ts src/components/sections/hero-choreography/mask-expand-keyframes.test.ts
git commit -m "feat(hero): maskExpandKeyframes scene + play-before-crossfade invariant"
```

---

### Task 7: `quoteFadeKeyframes`

The three-line staggered fade in `HeroDesktop.tsx:83-109` becomes data; reduced state is its literal final frame.

**Files:**
- Create: `src/components/sections/hero-choreography/quote-fade-keyframes.ts`
- Test: `src/components/sections/hero-choreography/quote-fade-keyframes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/sections/hero-choreography/quote-fade-keyframes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quoteFadeKeyframes } from './quote-fade-keyframes';
import { projectFinalFrame } from './keyframes';

describe('quoteFadeKeyframes', () => {
  const kfs = quoteFadeKeyframes();

  it('seeds all three lines hidden + offset + blurred at t=0', () => {
    const sets = kfs.filter((k) => k.duration === 0);
    expect(sets).toHaveLength(3);
    sets.forEach((s) => expect(s.to).toEqual({ opacity: 0, y: 40, filter: 'blur(10px)' }));
  });

  it('staggers the three reveals at 0, 0.35, 0.70', () => {
    const reveals = kfs.filter((k) => k.duration > 0);
    expect(reveals.map((k) => k.at)).toEqual([0, 0.35, 0.70]);
  });

  it('REDUCED == LAST FRAME: every line ends fully visible at rest', () => {
    const final = projectFinalFrame(kfs);
    Object.values(final).forEach((vars) =>
      expect(vars).toEqual({ opacity: 1, y: 0, filter: 'blur(0px)' }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/quote-fade-keyframes.test.ts`
Expected: FAIL — `Failed to resolve import "./quote-fade-keyframes"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/hero-choreography/quote-fade-keyframes.ts`:

```ts
import type { Keyframe } from './keyframes';

// Psalm 23 quote: three lines rise + unblur on scroll, staggered. Reduced-motion
// holds them all at the final frame (handled via projectFinalFrame at the call site).
export function quoteFadeKeyframes(): Keyframe[] {
  const reveal = { opacity: 1, y: 0, filter: 'blur(0px)' } as const;
  const hidden = { opacity: 0, y: 40, filter: 'blur(10px)' } as const;
  return [
    { target: 'l1', to: { ...hidden }, at: 0, duration: 0 },
    { target: 'l2', to: { ...hidden }, at: 0, duration: 0 },
    { target: 'attr', to: { ...hidden }, at: 0, duration: 0 },
    { target: 'l1', to: { ...reveal }, ease: 'power2.out', at: 0, duration: 1 },
    { target: 'l2', to: { ...reveal }, ease: 'power2.out', at: 0.35, duration: 1 },
    { target: 'attr', to: { ...reveal }, ease: 'power2.out', at: 0.70, duration: 1 },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/quote-fade-keyframes.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/quote-fade-keyframes.ts src/components/sections/hero-choreography/quote-fade-keyframes.test.ts
git commit -m "feat(hero): quoteFadeKeyframes scene + reduced==last-frame invariant"
```

---

### Task 8: `HeroIntroSequence` controller

The intro lifecycle in `HeroDesktop.tsx:324-418` (play-once, handoff-before-complete, `showNav` flip) becomes a deps-injected `Observable` state machine, mirroring `PurposeDetailReveal`. The aesthetic heartbeat/ring/spread tweens stay imperative inside the injected `play` — we test the lifecycle, not the easing.

**Files:**
- Create: `src/components/sections/hero-choreography/hero-intro-sequence.ts`
- Test: `src/components/sections/hero-choreography/hero-intro-sequence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/sections/hero-choreography/hero-intro-sequence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HeroIntroSequence } from './hero-intro-sequence';
import type { HeroIntroSequenceDeps } from './hero-intro-sequence';

interface Captured {
  playCalls: number;
  onHandoff: number;
  onIntroComplete: number;
  callbacks: { onHandoff: () => void; onComplete: () => void } | null;
}

function makeDeps(): { deps: HeroIntroSequenceDeps; cap: Captured } {
  const cap: Captured = { playCalls: 0, onHandoff: 0, onIntroComplete: 0, callbacks: null };
  const deps: HeroIntroSequenceDeps = {
    play: (callbacks) => {
      cap.playCalls++;
      cap.callbacks = callbacks;
    },
    onHandoff: () => {
      cap.onHandoff++;
    },
    onIntroComplete: () => {
      cap.onIntroComplete++;
    },
  };
  return { deps, cap };
}

describe('HeroIntroSequence — initial state', () => {
  it('starts idle', () => {
    const { deps } = makeDeps();
    expect(new HeroIntroSequence(deps).getSnapshot()).toEqual({ status: 'idle' });
  });
});

describe('HeroIntroSequence — start()', () => {
  it('moves idle → playing and invokes deps.play once', () => {
    const { deps, cap } = makeDeps();
    const r = new HeroIntroSequence(deps);
    r.start();
    expect(r.getSnapshot()).toEqual({ status: 'playing' });
    expect(cap.playCalls).toBe(1);
  });

  it('PLAY-ONCE GUARD: a second start() is a no-op', () => {
    const { deps, cap } = makeDeps();
    const r = new HeroIntroSequence(deps);
    r.start();
    r.start();
    expect(cap.playCalls).toBe(1);
  });
});

describe('HeroIntroSequence — handoff before complete', () => {
  it('handoff flips status → revealed and fires onHandoff', () => {
    const { deps, cap } = makeDeps();
    const r = new HeroIntroSequence(deps);
    r.start();
    cap.callbacks!.onHandoff();
    expect(r.getSnapshot()).toEqual({ status: 'revealed' });
    expect(cap.onHandoff).toBe(1);
    expect(cap.onIntroComplete).toBe(0);
  });

  it('complete fires onIntroComplete and leaves status revealed', () => {
    const { deps, cap } = makeDeps();
    const r = new HeroIntroSequence(deps);
    r.start();
    cap.callbacks!.onHandoff();
    cap.callbacks!.onComplete();
    expect(cap.onIntroComplete).toBe(1);
    expect(r.getSnapshot()).toEqual({ status: 'revealed' });
  });

  it('a repeated handoff callback does not double-fire onHandoff', () => {
    const { deps, cap } = makeDeps();
    const r = new HeroIntroSequence(deps);
    r.start();
    cap.callbacks!.onHandoff();
    cap.callbacks!.onHandoff();
    expect(cap.onHandoff).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/sections/hero-choreography/hero-intro-sequence.test.ts`
Expected: FAIL — `Failed to resolve import "./hero-intro-sequence"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/sections/hero-choreography/hero-intro-sequence.ts`:

```ts
import { Observable } from '@/notepad/collection/observable';

export type HeroIntroStatus = 'idle' | 'playing' | 'revealed';

export interface HeroIntroState {
  status: HeroIntroStatus;
}

export interface HeroIntroSequenceDeps {
  // Builds + plays the gsap intro timeline. Must invoke `onHandoff` at the
  // handoff beat (t≈6.40) and `onComplete` at timeline end. The aesthetic
  // tweens live here (imperative, preserved verbatim).
  play: (callbacks: { onHandoff: () => void; onComplete: () => void }) => void;
  onHandoff?: () => void;
  onIntroComplete?: () => void;
}

// Owns the play-once intro → handoff → reveal lifecycle. `revealed` is reached
// at the handoff beat (before complete), which is what gates the desktop nav /
// mask reveal. Mirrors PurposeDetailReveal: deps-injected, node-testable.
export class HeroIntroSequence extends Observable<HeroIntroState> {
  private readonly deps: HeroIntroSequenceDeps;

  constructor(deps: HeroIntroSequenceDeps) {
    super({ status: 'idle' });
    this.deps = deps;
  }

  start = (): void => {
    if (this.getSnapshot().status !== 'idle') return; // play-once guard
    this.set('playing');
    this.deps.play({
      onHandoff: () => {
        if (this.getSnapshot().status === 'revealed') return; // no double-fire
        this.set('revealed');
        this.deps.onHandoff?.();
      },
      onComplete: () => {
        this.deps.onIntroComplete?.();
      },
    });
  };

  private set(status: HeroIntroStatus): void {
    (this as unknown as { setState: (u: (p: HeroIntroState) => HeroIntroState) => void })
      .setState(() => ({ status }));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/sections/hero-choreography/hero-intro-sequence.test.ts`
Expected: PASS (7 passing).

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/hero-choreography/hero-intro-sequence.ts src/components/sections/hero-choreography/hero-intro-sequence.test.ts
git commit -m "feat(hero): HeroIntroSequence lifecycle controller (play-once, handoff-before-complete)"
```

---

### Task 9: Wire `HeroDesktop` to consume the score

Replace the inline compositions with `applyKeyframes(tl, <scene>, targets)` calls and the controller. This is the risky faithful-refactor step — values must stay byte-identical. No new behavior; verify via build + full suite + browser preview.

**Files:**
- Modify: `src/components/sections/HeroDesktop.tsx`

- [ ] **Step 1: Replace the module-level constants with shared imports**

In `src/components/sections/HeroDesktop.tsx`, delete the local `DEEP_UMBER_HEX` const (lines 11-14) and the `COLLAPSE` const (lines 16-27). Update imports at the top:

```tsx
import { BRIDGE_COPY, BRIDGE_PIN_TIMING, bridgeCascadeKeyframes } from './hero-bridge-content';
import { applyKeyframes, projectFinalFrame } from './hero-choreography/keyframes';
import { wordmarkAuraSizes } from './hero-choreography/wordmark-geometry';
import { collapseKeyframes, COLLAPSE_COLOR_DEEP_UMBER } from './hero-choreography/collapse-keyframes';
import { maskExpandKeyframes, VIDEO_PLAY_AT } from './hero-choreography/mask-expand-keyframes';
import { quoteFadeKeyframes } from './hero-choreography/quote-fade-keyframes';
import { HeroIntroSequence } from './hero-choreography/hero-intro-sequence';
import { useSyncExternalStore } from 'react';
```

Note: `BRIDGE_PIN_TIMING` is no longer referenced directly after this task — drop it from the import if the linter flags it. Keep `BRIDGE_COPY`.

- [ ] **Step 2: Convert the quote effect to data**

Replace the body of the quote `useEffect` (lines 69-113) so the GSAP branch builds from `quoteFadeKeyframes()` and the reduced branch uses `projectFinalFrame`:

```tsx
  useEffect(() => {
    const container = quoteRef.current;
    const l1 = quoteLine1Ref.current;
    const l2 = quoteLine2Ref.current;
    const attr = quoteAttrRef.current;
    if (!container || !l1 || !l2 || !attr) return;

    const targets = { l1, l2, attr };
    const kfs = quoteFadeKeyframes();

    if (prefersReducedMotion) {
      const final = projectFinalFrame(kfs);
      gsap.set(l1, final.l1);
      gsap.set(l2, final.l2);
      gsap.set(attr, final.attr);
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: container, start: 'top 95%', end: 'top 10%', scrub: 3, invalidateOnRefresh: true },
      });
      applyKeyframes(tl, kfs, targets);
    }, container);

    return () => ctx.revert();
  }, [prefersReducedMotion]);
```

- [ ] **Step 3: Convert the bridge effect to data**

Replace the GSAP branch of the bridge `useEffect` (lines 138-204) to build from `bridgeCascadeKeyframes({ enterX2: 120 })`. Keep the reduced branch verbatim (the bridge carve-out renders all beats visible in normal flow):

```tsx
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: scrollEl, start: 'top 80%', end: 'bottom bottom', scrub: 2, invalidateOnRefresh: true },
      });
      applyKeyframes(tl, bridgeCascadeKeyframes({ enterX2: 120 }), { t1, t2, t3 });
    }, scrollEl);
```

- [ ] **Step 4: Convert the mask effect to data**

Replace the GSAP branch of the mask `useEffect` (lines 219-255) and the playback trigger threshold (line 265) to consume `maskExpandKeyframes()` / `VIDEO_PLAY_AT`:

```tsx
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: scrollEl, start: 'top top', end: '60% top', scrub: 1, pin: false, invalidateOnRefresh: true },
      });
      const kfs = videoEl
        ? maskExpandKeyframes()
        : maskExpandKeyframes().filter((k) => k.target !== 'video');
      applyKeyframes(tl, kfs, { clip: clipEl, img: imgEl, video: videoEl });
    }, scrollEl);

    let playbackTrigger: ScrollTrigger | undefined;
    if (videoEl) {
      playbackTrigger = ScrollTrigger.create({
        trigger: scrollEl,
        start: 'top top',
        end: '60% top',
        onUpdate: (self) => {
          if (self.progress >= VIDEO_PLAY_AT && videoEl.paused) {
            videoEl.play().catch(() => {});
          }
        },
      });
    }
```

For the mask reduced-motion fallback (lines 280-295), build from the projection:

```tsx
  useEffect(() => {
    if (!prefersReducedMotion) return;
    const clipEl = maskClipRef.current;
    const imgEl = maskImgRef.current;
    const videoEl = maskVideoRef.current;
    if (!clipEl || !imgEl) return;

    const final = projectFinalFrame(maskExpandKeyframes());
    gsap.set(clipEl, final.clip);
    gsap.set(imgEl, final.img);
    if (videoEl) {
      gsap.set(videoEl, final.video);
      videoEl.play().catch(() => {});
    }
  }, [prefersReducedMotion]);
```

- [ ] **Step 5: Convert the responsive aura/ring effect**

Replace the `update` body inside the sizing `useEffect` (lines 303-311) to call `wordmarkAuraSizes`:

```tsx
    const update = () => {
      const wordmarkWidth = svgEl.getBoundingClientRect().width;
      if (wordmarkWidth === 0) return;
      const sizes = wordmarkAuraSizes(wordmarkWidth);
      heroEl.style.setProperty('--aura-size', `${sizes.aura}px`);
      heroEl.style.setProperty('--ring-size', `${sizes.ringInitial}px`);
      heroEl.style.setProperty('--ring-final-size', `${sizes.ringFinal}px`);
    };
```

- [ ] **Step 6: Drive the intro via `HeroIntroSequence`**

Replace the `showNav` state (line 37) and the intro `useLayoutEffect` (lines 324-418). The controller is created once and subscribed via `useSyncExternalStore`; `showNav` derives from status. The gsap build moves into the injected `play` (the heartbeat/ring/spread tweens are preserved verbatim — only the `setShowNav`/`onHandoff` call site and `onComplete` are routed through the controller's callbacks). Keep using `COLLAPSE_COLOR_DEEP_UMBER` for the `svg` color tween and `WORDMARK_COLLAPSE` (import it) for the letter `from` offsets.

```tsx
  const introRef = useRef<HeroIntroSequence | null>(null);
  if (introRef.current === null) {
    introRef.current = new HeroIntroSequence({
      play: ({ onHandoff: fireHandoff, onComplete }) => {
        const svgEl = svgRef.current!;
        const darkEl = darkCanvasRef.current!;
        const glowEl = glowAuraRef.current!;
        const ringEl = pulseRingRef.current!;
        const heroEl = heroRef.current!;
        const letterA  = svgEl.querySelector<SVGGElement>('#letter-A')!;
        const letterP  = svgEl.querySelector<SVGGElement>('#letter-P')!;
        const letterS1 = svgEl.querySelector<SVGGElement>('#letter-S1')!;
        const letterL  = svgEl.querySelector<SVGGElement>('#letter-L')!;
        const letterM  = svgEl.querySelector<SVGGElement>('#letter-M')!;
        const letterS2 = svgEl.querySelector<SVGGElement>('#letter-S2')!;

        const tl = gsap.timeline({ paused: true, onComplete });

        tl.set(letterA,  { opacity: 0, scale: 0.92, transformOrigin: '50% 50%' }, 0);
        tl.set(letterP,  { x: WORDMARK_COLLAPSE.P,  opacity: 0, filter: 'blur(6px)' }, 0);
        tl.set(letterS1, { x: WORDMARK_COLLAPSE.S1, opacity: 0, filter: 'blur(6px)' }, 0);
        tl.set(letterL,  { x: WORDMARK_COLLAPSE.L,  opacity: 0, filter: 'blur(6px)' }, 0);
        tl.set(letterM,  { x: WORDMARK_COLLAPSE.M,  opacity: 0, filter: 'blur(6px)' }, 0);
        tl.set(letterS2, { x: WORDMARK_COLLAPSE.S2, opacity: 0, filter: 'blur(6px)' }, 0);
        tl.set(glowEl, { opacity: 0 }, 0);
        tl.set(ringEl, { width: 'var(--ring-size, 260px)', height: 'var(--ring-size, 260px)', opacity: 0 }, 0);
        tl.set(darkEl, { opacity: 1 }, 0);

        tl.to(letterA, { opacity: 1, scale: 1, duration: 1.4, ease: 'power2.out', overwrite: 'auto' }, 0.3);
        tl.to(glowEl,  { opacity: 0.18, duration: 1.4, ease: 'power1.out', overwrite: 'auto' }, 0.4);

        const lub = 2.10;
        tl.to(letterA, { scale: 1.022, duration: 0.18, ease: 'power2.out', overwrite: 'auto' }, lub);
        tl.to(letterA, { scale: 1.0,   duration: 0.32, ease: 'power3.out', overwrite: 'auto' }, lub + 0.18);
        tl.to(glowEl,  { opacity: 0.42, scale: 1.08, duration: 0.18, ease: 'power2.out', overwrite: 'auto' }, lub);
        tl.to(glowEl,  { opacity: 0.18, scale: 1.0,  duration: 0.32, ease: 'power2.out', overwrite: 'auto' }, lub + 0.18);

        const dub = 2.85;
        tl.to(letterA, { scale: 1.042, duration: 0.22, ease: 'power2.out', overwrite: 'auto' }, dub);
        tl.to(letterA, { scale: 1.0,   duration: 0.50, ease: 'power3.out', overwrite: 'auto' }, dub + 0.22);
        tl.to(glowEl,  { opacity: 0.78, scale: 1.18, duration: 0.22, ease: 'power2.out', overwrite: 'auto' }, dub);
        tl.to(glowEl,  { opacity: 0,    scale: 1.0,  duration: 1.30, ease: 'power2.in',  overwrite: 'auto' }, dub + 0.22);

        const ring = dub + 0.12;
        const ringFinalCss = getComputedStyle(heroEl).getPropertyValue('--ring-final-size').trim() || '2800px';
        tl.to(ringEl, { opacity: 0.92, duration: 0.24, ease: 'power2.out', overwrite: 'auto' }, ring);
        tl.to(ringEl, { width: ringFinalCss, height: ringFinalCss, duration: 1.8, ease: 'power2.out', overwrite: 'auto' }, ring);
        tl.to(ringEl, { opacity: 0, duration: 1.5, ease: 'power2.in', overwrite: 'auto' }, ring + 0.35);

        const spread = (target: SVGGElement, t: number) => {
          tl.to(target, { x: 0,                duration: 1.8, ease: 'power3.out' }, t);
          tl.to(target, { opacity: 1,          duration: 1.4, ease: 'power1.out' }, t);
          tl.to(target, { filter: 'blur(0px)', duration: 1.6, ease: 'power2.out' }, t);
        };
        const spreadAt = 4.20;
        spread(letterS1, spreadAt);
        spread(letterL,  spreadAt);
        spread(letterP,  spreadAt + 0.45);
        spread(letterM,  spreadAt + 0.45);
        spread(letterS2, spreadAt + 0.90);

        const handoff = 6.40;
        tl.to(darkEl, { opacity: 0, duration: 1.2, ease: 'power2.inOut' }, handoff);
        tl.to(svgEl,  { color: COLLAPSE_COLOR_DEEP_UMBER, duration: 1.2, ease: 'power2.inOut' }, handoff);
        tl.to(svgEl,  { opacity: 0.45, duration: 1.2, ease: 'power2.inOut' }, handoff);
        tl.call(fireHandoff, [], handoff);

        tl.play(0);
        introRef.current!._killTimeline = () => tl.kill();
      },
      onHandoff,
      onIntroComplete,
    });
  }
  const introStatus = useSyncExternalStore(
    introRef.current.subscribe,
    () => introRef.current!.getSnapshot().status,
  );
  const showNav = !introActive || introStatus === 'revealed';

  useLayoutEffect(() => {
    if (!introActive) return;
    introRef.current!.start();
    return () => {
      (introRef.current as unknown as { _killTimeline?: () => void })._killTimeline?.();
    };
  }, [introActive]);
```

Add a `_killTimeline` field to the controller is undesirable (it leaks the gsap handle into the state machine). Instead, capture the kill handle in a component ref. Use this cleaner wiring in place of the two `_killTimeline` lines above:

```tsx
  const killIntroRef = useRef<(() => void) | null>(null);
  // ...inside play(): replace `introRef.current!._killTimeline = ...` with:
  //   killIntroRef.current = () => tl.kill();
  // ...and the layout effect cleanup becomes:
  //   return () => killIntroRef.current?.();
```

(Use the `killIntroRef` form; the `_killTimeline` lines are illustrative of why a ref is cleaner.)

- [ ] **Step 7: Build to verify the refactor typechecks and bundles**

Run: `npm run build`
Expected: SUCCESS, no TypeScript errors. If `introActive`/`onHandoff`/`onIntroComplete` are flagged as missing deps on the layout effect, that's expected — the controller closes over the latest via the ref created once; keep `[introActive]` as the dependency (matches the original play-once intent).

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all existing tests plus the new hero-choreography tests green.

- [ ] **Step 9: Verify in the browser preview**

Start the dev server (`preview_start`) and load the landing page. Confirm: (a) the intro plays once — A fades in, two heartbeats, ring expands, letters spread, then at the handoff the dark canvas fades and the masked image/quote reveal; (b) scrolling collapses the wordmark in three waves with the ring climax and color flash; (c) the bridge three-beat cascade and the Psalm quote fade behave as before; (d) the mask expands and the video plays. Capture a screenshot of the settled hero. Check `preview_console_logs` for GSAP/ScrollTrigger errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/sections/HeroDesktop.tsx
git commit -m "refactor(hero): HeroDesktop consumes HeroChoreography score + HeroIntroSequence"
```

---

### Task 10: Wire `HeroMobile` to the shared modules

Remove the duplicated `COLLAPSE` const and the re-coded bridge ladder; consume `WORDMARK_COLLAPSE` and `bridgeCascadeKeyframes({ enterX2: 30 })`. Mobile keeps its trivial immediate-fire intro (no controller) and its `scrub × MOBILE_TIME_SCALE`.

**Files:**
- Modify: `src/components/sections/HeroMobile.tsx`

- [ ] **Step 1: Swap imports and delete the duplicated const**

In `src/components/sections/HeroMobile.tsx`, delete the local `COLLAPSE` const (lines 14-16) and update imports:

```tsx
import { BRIDGE_COPY, bridgeCascadeKeyframes } from './hero-bridge-content';
import { MOBILE_TIME_SCALE } from '@/lib/motion-scale';
import { applyKeyframes } from './hero-choreography/keyframes';
import { WORDMARK_COLLAPSE } from './hero-choreography/wordmark-geometry';
```

(Drop `BRIDGE_PIN_TIMING` from the import — it's now only used inside `bridgeCascadeKeyframes`.)

- [ ] **Step 2: Point the wordmark-collapse tweens at the shared geometry**

Replace the five `.to(...)` calls in the collapse `useLayoutEffect` (lines 89-93):

```tsx
      tl.to(letters.P,  { x: WORDMARK_COLLAPSE.P,  ease: 'power2.inOut' }, 0)
        .to(letters.S1, { x: WORDMARK_COLLAPSE.S1, ease: 'power2.inOut' }, 0)
        .to(letters.L,  { x: WORDMARK_COLLAPSE.L,  ease: 'power2.inOut' }, 0)
        .to(letters.M,  { x: WORDMARK_COLLAPSE.M,  ease: 'power2.inOut' }, 0)
        .to(letters.S2, { x: WORDMARK_COLLAPSE.S2, ease: 'power2.inOut' }, 0);
```

- [ ] **Step 3: Replace the bridge ladder with `applyKeyframes`**

Replace the GSAP branch of the bridge `useEffect` (lines 122-181). Keep the reduced branch verbatim (mobile bridge carve-out, lines 113-120):

```tsx
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: scrollEl,
          start: 'top 80%',
          end: 'bottom bottom',
          scrub: 2 * MOBILE_TIME_SCALE,
          invalidateOnRefresh: true,
        },
      });
      applyKeyframes(tl, bridgeCascadeKeyframes({ enterX2: 30 }), { t1, t2, t3 });
    }, scrollEl);
```

- [ ] **Step 4: Build + run the suite (HeroMobile has an existing render test)**

Run: `npm run build && npx vitest run src/components/sections/HeroMobile.test.tsx`
Expected: SUCCESS + the existing `HeroMobile.test.tsx` stays green.

- [ ] **Step 5: Verify mobile in the preview**

Resize the preview to a mobile viewport (`preview_resize` ~390×844). Confirm the wordmark collapses on scroll, the bridge cascade plays (text-2 slides in a short distance), the quote fades in on intersection, and the video loops. Screenshot the result. Check console logs for errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/sections/HeroMobile.tsx
git commit -m "refactor(hero): HeroMobile consumes shared WordmarkGeometry + bridgeCascadeKeyframes"
```

---

## Self-Review

**1. Spec coverage** — every `## Hero*` CONTEXT entry maps to a task: WordmarkGeometry → Task 1; Keyframe grammar/`applyKeyframes`/`projectFinalFrame` → Tasks 2–3; bridgeCascadeKeyframes → Task 4; collapse/mask/quote scenes → Tasks 5–7; HeroIntroSequence → Task 8; component wiring (the "thin harness") → Tasks 9–10. The two documented reduced-motion carve-outs (collapse, bridge) are preserved verbatim; the two derived scenes (quote, mask) use `projectFinalFrame`.

**2. Placeholder scan** — every code step ships full code; no TBD/“handle edge cases”. The one prose aside in Task 9 Step 6 (the `_killTimeline` → `killIntroRef` note) explicitly directs the implementer to the `killIntroRef` form and explains why; no ambiguity about what to write.

**3. Type consistency** — `Keyframe`/`GsapVars`/`KeyframeTimeline` defined in Task 2 are the exact types imported in Tasks 3–7 and consumed by `applyKeyframes`/`projectFinalFrame`. `WORDMARK_COLLAPSE` keys (`P/S1/L/M/S2`) are identical across Tasks 1, 5, 9, 10. `HeroIntroSequenceDeps` (`play`/`onHandoff`/`onIntroComplete`) and `HeroIntroState` (`{ status }`) defined in Task 8 match the wiring in Task 9. `COLLAPSE_COLOR_DEEP_UMBER` (`#3A3426`) is defined once in Task 5 and reused in Task 9. `VIDEO_PLAY_AT` (Task 6) is the single threshold used in Task 9 Step 4.
