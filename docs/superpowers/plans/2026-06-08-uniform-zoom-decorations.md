# Uniform-Zoom Decorations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make notepad decorations scale uniformly with the live content width so they keep their saved relative position and proportional size as the screen resizes (shrinking and enlarging).

**Architecture:** Store all three decoration coordinates as fractions of content width (`xPct`, `yPct`, `widthPct`); render each as `frac · liveWidth`. A live `ResizeObserver` feeds the current width. Legacy decorations that stored absolute `yPx` are converted once to `yPct` on first measure.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react (jsdom), existing notepad decoration modules.

**Reference spec:** `docs/superpowers/specs/2026-06-08-uniform-zoom-decorations-design.md`

---

## File Structure

- `src/notepad/types.ts` — `NoteDecoration`: `yPx` → `yPct`; keep optional legacy `yPx?`.
- `src/notepad/decorations/decoration-geometry.ts` — new pure helpers `resolveYPct`, `isLegacyDecoration`, `migrateLegacyDecoration`; update `moveTo`, `clampDecoration`, `decorationBox`.
- `src/notepad/decorations/decoration-ops.ts` — `duplicateDecoration` offset in `yPct`.
- `src/notepad/decorations/DecorationItem.tsx` — render `top` from `yPct · contentWidth`.
- `src/notepad/decorations/DecorationLayer.tsx` — live width (remove freeze) + `onFirstWidth` prop.
- `src/notepad/decorations/useDecorations.ts` — `migrateLegacy(width)` bulk-commit method.
- `src/notepad/components/Editor.tsx` — tray-placement default in `yPct`; wire `onFirstWidth`; drop `key={activeNote.id}`.
- Tests: `decoration-geometry.test.ts`, `decoration-ops.test.ts`, `DecorationItem.test.tsx`, `DecorationLayer.test.tsx`, `useDecorations.test.ts`.

---

## Task 1: Coordinate model + geometry (fraction-of-width `yPct`)

**Files:**
- Modify: `src/notepad/types.ts:3-14`
- Modify: `src/notepad/decorations/decoration-geometry.ts`
- Modify: `src/notepad/decorations/decoration-ops.ts:44-48`
- Modify: `src/notepad/decorations/DecorationItem.tsx` (geometry `top`)
- Modify: `src/notepad/components/Editor.tsx:632`
- Test: `src/notepad/decorations/decoration-geometry.test.ts`, `decoration-ops.test.ts`
- Fixtures touched: `DecorationItem.test.tsx`, `DecorationLayer.test.tsx`, `useDecorations.test.ts`

- [ ] **Step 1: Update geometry tests to the `yPct` unit and add helper specs**

In `src/notepad/decorations/decoration-geometry.test.ts`:

Replace the import block (lines 3-7) with:

```ts
import {
  moveTo, resizeWidthPct, rotationDeg, clampDecoration, pinchTransform,
  decorationZIndex, pointerAngleDeg, applyRotationDrag, TEXT_Z, SELECTED_Z,
  decorationBox, pointInBox, topmostBehindAtPoint,
  resolveYPct, isLegacyDecoration, migrateLegacyDecoration,
} from './decoration-geometry';
import type { NoteDecoration } from '../types';
```

Change the shared fixture (line 10-12) and the two other fixtures (lines ~55, ~76) so `yPx: 100` becomes `yPct: 0.1`, and `yPx: 100` in the `topmostBehindAtPoint` fixtures (`back`, `front`) becomes `yPct: 0.1`.

Update the `moveTo` describe (lines 14-25):

```ts
describe('moveTo', () => {
  it('converts a pixel delta to a normalized x and y (fraction of width)', () => {
    // content width 1000px: +100px → +0.1 xPct; +30px → +0.03 yPct.
    expect(moveTo(d, { dxPx: 100, dyPx: 30, contentWidth: 1000 }))
      .toMatchObject({ xPct: expect.closeTo(0.6, 5), yPct: expect.closeTo(0.13, 5) });
  });

  it('ignores both deltas when contentWidth is 0', () => {
    expect(moveTo(d, { dxPx: 100, dyPx: 30, contentWidth: 0 }))
      .toMatchObject({ xPct: 0.5, yPct: 0.1 });
  });
});
```

Update the `clampDecoration` describe (lines 46-51):

```ts
describe('clampDecoration', () => {
  it('keeps xPct within [0, 1] and yPct non-negative', () => {
    expect(clampDecoration({ ...d, xPct: 1.5, yPct: -0.02 })).toMatchObject({ xPct: 1, yPct: 0 });
    expect(clampDecoration({ ...d, xPct: -0.2 }).xPct).toBe(0);
  });
});
```

Append these new describes at the end of the file:

```ts
describe('resolveYPct', () => {
  const legacy = { id: 'l', assetId: 'x', xPct: 0.5, yPx: 300, widthPct: 0.2, rotation: 0, z: 1 } as unknown as NoteDecoration;

  it('returns yPct directly when present', () => {
    expect(resolveYPct({ ...d, yPct: 0.25 }, 1000)).toBe(0.25);
  });
  it('derives yPct from legacy yPx and width when yPct is absent', () => {
    expect(resolveYPct(legacy, 1000)).toBe(0.3);
  });
  it('is 0 when width is 0', () => {
    expect(resolveYPct(legacy, 0)).toBe(0);
  });
});

describe('isLegacyDecoration', () => {
  const legacy = { id: 'l', assetId: 'x', xPct: 0.5, yPx: 300, widthPct: 0.2, rotation: 0, z: 1 } as unknown as NoteDecoration;

  it('is true when yPct is missing', () => {
    expect(isLegacyDecoration(legacy)).toBe(true);
  });
  it('is true when a lingering yPx remains even with yPct present', () => {
    expect(isLegacyDecoration({ ...d, yPct: 0.1, yPx: 50 })).toBe(true);
  });
  it('is false for a clean migrated decoration', () => {
    expect(isLegacyDecoration({ ...d, yPct: 0.1 })).toBe(false);
  });
});

describe('migrateLegacyDecoration', () => {
  const legacy = { id: 'l', assetId: 'x', xPct: 0.5, yPx: 300, widthPct: 0.2, rotation: 0, z: 1 } as unknown as NoteDecoration;

  it('converts legacy yPx to yPct by width and drops yPx', () => {
    const out = migrateLegacyDecoration(legacy, 1000);
    expect(out.yPct).toBe(0.3);
    expect((out as { yPx?: number }).yPx).toBeUndefined();
  });
  it('leaves an already-migrated decoration unchanged and yPx-free', () => {
    const out = migrateLegacyDecoration({ ...d, yPct: 0.4 }, 1000);
    expect(out.yPct).toBe(0.4);
    expect((out as { yPx?: number }).yPx).toBeUndefined();
  });
});
```

(The existing `decorationBox` test already expects `top: 100` — with `d.yPct = 0.1` and `refWidth 1000` that still holds, so it needs no change beyond the fixture edit. The `topmostBehindAtPoint` tests likewise still pass with `yPct: 0.1`.)

- [ ] **Step 2: Update `decoration-ops.test.ts` fixtures/expectations**

In `src/notepad/decorations/decoration-ops.test.ts`:
- `base` (line 10): `yPx: 100` → `yPct: 0.1`.
- `addDecoration` call (line 19): `yPx: 10` → `yPct: 0.01`.
- `duplicateDecoration` expectation (line 42): replace `expect(out[1].yPx).toBe(120);` with `expect(out[1].yPct).toBeCloseTo(0.12);`.

- [ ] **Step 3: Update remaining test fixtures so the suite type-checks**

Mechanical `yPx: <n>` → `yPct: <fraction>` in fixtures:
- `src/notepad/decorations/DecorationItem.test.tsx:16` — `yPx: 100` → `yPct: 0.1`.
- `src/notepad/decorations/DecorationItem.test.tsx:35` — comment `// yPx, unchanged` → `// 0.1 * 1000`.
- `src/notepad/decorations/DecorationItem.test.tsx:72` — `yPx: 130` → `yPct: expect.closeTo(0.13, 5)`.
- `src/notepad/decorations/DecorationLayer.test.tsx:35` — `yPx: 100` → `yPct: 0.1`; line 73 comment `yPx 100` → `yPct 0.1`.
- `src/notepad/decorations/useDecorations.test.ts` lines 25, 44, 51, 80, 97, 124 — every `yPx: 0`/`yPx: 100` → `yPct: 0`/`yPct: 0.1`.

- [ ] **Step 4: Run the geometry + ops tests to verify they fail (compile error / missing exports)**

Run: `npx vitest run src/notepad/decorations/decoration-geometry.test.ts src/notepad/decorations/decoration-ops.test.ts`
Expected: FAIL — `resolveYPct`/`isLegacyDecoration`/`migrateLegacyDecoration` not exported; `yPct` missing on `NoteDecoration`.

- [ ] **Step 5: Update the data model in `types.ts`**

Replace lines 3-14 of `src/notepad/types.ts`:

```ts
export interface NoteDecoration {
  id: string;        // local uuid
  assetId: string;   // manifest id
  xPct: number;      // 0..1, left position as a fraction of content width
  yPct: number;      // 0..1, top position as a fraction of content width (uniform zoom)
  widthPct: number;  // 0..1, width as a fraction of content width
  rotation: number;  // degrees
  z: number;         // stacking order
  /** Legacy (pre-uniform-zoom): absolute px top. Read only during migration. */
  yPx?: number;
  behindText?: boolean; // when true, renders behind editor text (default = in front of text)
  flipH?: boolean;   // horizontal flip
  flipV?: boolean;   // vertical flip
}
```

- [ ] **Step 6: Add helpers and update geometry functions**

In `src/notepad/decorations/decoration-geometry.ts`, add these three helpers immediately after the `import` line at the top:

```ts
// Vertical position as a fraction of content width. Tolerates legacy decorations
// that still carry an absolute `yPx` until migration persists `yPct`.
export function resolveYPct(d: NoteDecoration, width: number): number {
  const yPct = (d as { yPct?: number }).yPct;
  if (typeof yPct === 'number') return yPct;
  return width > 0 ? (d.yPx ?? 0) / width : 0;
}

// True if a decoration predates uniform zoom (no yPct, or a lingering legacy yPx).
export function isLegacyDecoration(d: NoteDecoration): boolean {
  return typeof (d as { yPct?: number }).yPct !== 'number' || d.yPx !== undefined;
}

// Convert a legacy decoration (absolute `yPx`) to the uniform-zoom `yPct` unit
// using the given content width, dropping the legacy field. Already-migrated
// decorations are returned with any lingering `yPx` removed.
export function migrateLegacyDecoration(d: NoteDecoration, width: number): NoteDecoration {
  const next = { ...d, yPct: resolveYPct(d, width) };
  delete (next as { yPx?: number }).yPx;
  return next;
}
```

Replace `moveTo` (currently lines 33-42):

```ts
export function moveTo(
  d: NoteDecoration,
  { dxPx, dyPx, contentWidth }: { dxPx: number; dyPx: number; contentWidth: number },
): NoteDecoration {
  return clampDecoration({
    ...d,
    xPct: d.xPct + (contentWidth > 0 ? dxPx / contentWidth : 0),
    yPct: resolveYPct(d, contentWidth) + (contentWidth > 0 ? dyPx / contentWidth : 0),
  });
}
```

Replace `clampDecoration` (currently lines 56-62):

```ts
export function clampDecoration(d: NoteDecoration): NoteDecoration {
  return {
    ...d,
    xPct: Math.min(1, Math.max(0, d.xPct)),
    yPct: Math.max(0, d.yPct),
  };
}
```

In `decorationBox` (the `return` line, currently `return { left: d.xPct * refWidth, top: d.yPx, width, height };`), change `top`:

```ts
  return { left: d.xPct * refWidth, top: resolveYPct(d, refWidth) * refWidth, width, height };
```

- [ ] **Step 7: Update `duplicateDecoration` offset to `yPct`**

In `src/notepad/decorations/decoration-ops.ts`, replace the duplicate spread (line 46):

```ts
    { ...src, id: idGen(), xPct: src.xPct + 0.02, yPct: src.yPct + 0.02, z: nextZ(list) },
```

- [ ] **Step 8: Update `DecorationItem` render `top`**

In `src/notepad/decorations/DecorationItem.tsx`, add `resolveYPct` to the import from `./decoration-geometry`:

```ts
import {
  moveTo, resizeWidthPct, rotationDeg, pinchTransform,
  decorationZIndex, pointerAngleDeg, applyRotationDrag, SELECTED_Z, resolveYPct,
} from './decoration-geometry';
```

In the `geometry` style object, change `top: d.yPx,` to:

```ts
    top: resolveYPct(d, contentWidth) * contentWidth,
```

- [ ] **Step 9: Update the tray-placement default in `Editor.tsx`**

In `src/notepad/components/Editor.tsx` (line ~632), change the default placement:

```ts
            decorationsApi.add({ assetId, xPct: 0.4, yPct: 0.1, widthPct: 0.25, rotation: 0 })
```

- [ ] **Step 10: Run decoration tests + typecheck to verify green**

Run: `npx vitest run src/notepad/decorations/`
Expected: PASS (all decoration test files).

Run: `npx tsc --noEmit 2>&1 | grep -E "notepad/decorations|types.ts|Editor.tsx" || echo "NO TS ERRORS in touched files"`
Expected: `NO TS ERRORS in touched files`.

- [ ] **Step 11: Commit**

```bash
git add src/notepad/types.ts src/notepad/decorations/decoration-geometry.ts src/notepad/decorations/decoration-geometry.test.ts src/notepad/decorations/decoration-ops.ts src/notepad/decorations/decoration-ops.test.ts src/notepad/decorations/DecorationItem.tsx src/notepad/decorations/DecorationItem.test.tsx src/notepad/decorations/DecorationLayer.test.tsx src/notepad/decorations/useDecorations.test.ts src/notepad/components/Editor.tsx
git commit -m "refactor(notepad): store decoration vertical position as fraction of width (yPct)"
```

---

## Task 2: Live width in DecorationLayer

**Files:**
- Modify: `src/notepad/decorations/DecorationLayer.tsx`
- Test: `src/notepad/decorations/DecorationLayer.test.tsx`

- [ ] **Step 1: Replace the freeze test with a live-resize test and add an `onFirstWidth` test**

In `src/notepad/decorations/DecorationLayer.test.tsx`, replace the existing `it('freezes the reference width at first measure and ignores later resizes', ...)` test with:

```ts
  it('scales decoration position and size live as the container width changes', () => {
    const { getByTestId } = render(
      <DecorationLayer decorations={[deco]} selectedId={null} onSelect={() => {}} onDeselect={() => {}} {...noops} />,
    );
    const root = getByTestId('decoration-body-a').parentElement!;

    act(() => roCallback!([{ contentRect: { width: 1000 } }]));
    expect(root.style.left).toBe('500px'); // 0.5 * 1000
    expect(root.style.top).toBe('100px'); // 0.1 * 1000
    expect(root.style.width).toBe('200px'); // 0.2 * 1000

    // A later resize must re-scale position AND size (uniform zoom), not freeze.
    act(() => roCallback!([{ contentRect: { width: 1400 } }]));
    expect(root.style.left).toBe('700px'); // 0.5 * 1400
    expect(root.style.top).toBe('140px'); // 0.1 * 1400
    expect(root.style.width).toBe('280px'); // 0.2 * 1400
  });

  it('calls onFirstWidth once with the first non-zero measured width', () => {
    const onFirstWidth = vi.fn();
    render(
      <DecorationLayer decorations={[deco]} selectedId={null} onSelect={() => {}} onDeselect={() => {}} onFirstWidth={onFirstWidth} {...noops} />,
    );
    act(() => roCallback!([{ contentRect: { width: 1000 } }]));
    act(() => roCallback!([{ contentRect: { width: 1400 } }]));
    expect(onFirstWidth).toHaveBeenCalledTimes(1);
    expect(onFirstWidth).toHaveBeenCalledWith(1000);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/decorations/DecorationLayer.test.tsx`
Expected: FAIL — second resize still reports `500px`/`100px`/`200px` (frozen); `onFirstWidth` is not a prop yet.

- [ ] **Step 3: Add the `onFirstWidth` prop and make the width live**

In `src/notepad/decorations/DecorationLayer.tsx`:

Add to the `Props` interface (after `onSendToBack`):

```ts
  onFirstWidth?: (width: number) => void;
```

Add `onFirstWidth` to the destructured props in the `forwardRef` callback signature:

```ts
export const DecorationLayer = forwardRef<DecorationLayerHandle, Props>(function DecorationLayer({
  decorations, selectedId, onSelect, onDeselect,
  onChange, onDelete, onDuplicate, onBringToFront, onSendToBack, onFirstWidth,
}: Props, handleRef) {
```

Replace the `contentWidth` state + `useLayoutEffect` block (the frozen version) with:

```ts
  const [contentWidth, setContentWidth] = useState(0);
  // Keep the latest onFirstWidth in a ref so the measuring effect can stay
  // mount-only (the callback identity changes every render).
  const onFirstWidthRef = useRef(onFirstWidth);
  onFirstWidthRef.current = onFirstWidth;
  const firstWidthSent = useRef(false);

  // Live width: the decoration coordinates are fractions of this, so updating it
  // on every resize makes decorations scale uniformly with the container.
  // Measured synchronously in useLayoutEffect for first paint; jsdom reports 0,
  // so we also accept the first non-zero ResizeObserver tick.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (width: number) => {
      if (width <= 0) return;
      setContentWidth(width);
      if (!firstWidthSent.current) {
        firstWidthSent.current = true;
        onFirstWidthRef.current?.(width);
      }
    };
    apply(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
```

(`useState`, `useRef`, `useLayoutEffect`, `forwardRef`, `useImperativeHandle` are already imported.)

- [ ] **Step 4: Run DecorationLayer tests to verify green**

Run: `npx vitest run src/notepad/decorations/DecorationLayer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "DecorationLayer" || echo "NO TS ERRORS in touched files"`
Expected: `NO TS ERRORS in touched files`.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/decorations/DecorationLayer.tsx src/notepad/decorations/DecorationLayer.test.tsx
git commit -m "feat(notepad): decoration layer tracks live container width (uniform zoom)"
```

---

## Task 3: Migration wiring (useDecorations + Editor)

**Files:**
- Modify: `src/notepad/decorations/useDecorations.ts`
- Modify: `src/notepad/components/Editor.tsx`
- Test: `src/notepad/decorations/useDecorations.test.ts`

- [ ] **Step 1: Add migrateLegacy tests**

In `src/notepad/decorations/useDecorations.test.ts`, add inside the top-level `describe('useDecorations', ...)` block:

```ts
  it('migrateLegacy converts legacy yPx decorations to yPct in one persisted write', () => {
    const updateNote = vi.fn();
    const legacy = { id: 'd1', assetId: 'arrow-01', xPct: 0.5, yPx: 300, widthPct: 0.2, rotation: 0, z: 1 } as unknown as NonNullable<Note['decorations']>[number];
    const { result } = renderHook(() => useDecorations(note([legacy]), updateNote));

    act(() => { result.current.migrateLegacy(1000); });

    expect(result.current.decorations[0].yPct).toBe(0.3);
    expect((result.current.decorations[0] as { yPx?: number }).yPx).toBeUndefined();

    act(() => { vi.advanceTimersByTime(500); });
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('migrateLegacy is a no-op when no decoration is legacy', () => {
    const updateNote = vi.fn();
    const clean = { id: 'd1', assetId: 'arrow-01', xPct: 0.5, yPct: 0.3, widthPct: 0.2, rotation: 0, z: 1 };
    const { result } = renderHook(() => useDecorations(note([clean]), updateNote));

    act(() => { result.current.migrateLegacy(1000); });
    act(() => { vi.advanceTimersByTime(500); });

    expect(updateNote).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/decorations/useDecorations.test.ts`
Expected: FAIL — `result.current.migrateLegacy` is not a function.

- [ ] **Step 3: Add `migrateLegacy` to `useDecorations`**

In `src/notepad/decorations/useDecorations.ts`, extend the import from `./decoration-ops`... no — the helpers live in `decoration-geometry`. Add a new import near the top:

```ts
import { migrateLegacyDecoration, isLegacyDecoration } from './decoration-geometry';
```

Add to the returned object (after the `sendToBack` line, before the closing `};`):

```ts
    migrateLegacy: (width: number) => {
      // One-time best-effort conversion of pre-uniform-zoom decorations (absolute
      // yPx) once the live content width is known. Single coalesced commit.
      if (!decorations.some(isLegacyDecoration)) return;
      commit(decorations.map((d) => migrateLegacyDecoration(d, width)));
    },
```

- [ ] **Step 4: Run useDecorations tests to verify green**

Run: `npx vitest run src/notepad/decorations/useDecorations.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `onFirstWidth` and drop the freeze-era remount key in Editor**

In `src/notepad/components/Editor.tsx`, at the `<DecorationLayer>` usage, remove the `key={activeNote.id}` line (and its two-line comment about re-snapshotting the frozen width) and add the `onFirstWidth` prop. The element should read:

```tsx
          <DecorationLayer
            ref={decorationLayerRef}
            decorations={decorationsApi.decorations}
            selectedId={selectedDecoration}
            onSelect={setSelectedDecoration}
            onDeselect={() => setSelectedDecoration(null)}
            onChange={(next) => decorationsApi.update(next.id, next)}
            onDelete={(id) => { decorationsApi.remove(id); setSelectedDecoration(null); }}
            onDuplicate={(id) => decorationsApi.duplicate(id)}
            onBringToFront={(id) => decorationsApi.bringToFront(id)}
            onSendToBack={(id) => decorationsApi.sendToBack(id)}
            // Convert any pre-uniform-zoom decorations once the live width is known.
            onFirstWidth={decorationsApi.migrateLegacy}
          />
```

- [ ] **Step 6: Run the full notepad suite + typecheck + lint**

Run: `npx vitest run src/notepad/ 2>&1 | grep -E "Test Files|Tests "`
Expected: only `src/notepad/components/Editor.toolbar-placement.test.tsx` fails (4 known pre-existing failures); everything else passes.

Run: `npx tsc --noEmit 2>&1 | grep -E "notepad" || echo "NO TS ERRORS in notepad"`
Expected: `NO TS ERRORS in notepad`.

Run: `npx eslint src/notepad/decorations/ src/notepad/components/Editor.tsx src/notepad/types.ts`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/decorations/useDecorations.ts src/notepad/decorations/useDecorations.test.ts src/notepad/components/Editor.tsx
git commit -m "feat(notepad): migrate legacy decoration yPx to yPct on first measure"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** scaling model (Task 1 geometry + Task 2 live width), migration (Task 3 + Task 1 helpers), no-jump render fallback (`resolveYPct` in Task 1 Step 8), drop remount key (Task 3 Step 5), tests for each (all tasks). Covered.
- **Type consistency:** field is `yPct` everywhere; helpers named `resolveYPct` / `isLegacyDecoration` / `migrateLegacyDecoration` and used with those exact names in `DecorationItem.tsx`, `useDecorations.ts`, and tests.
- **Known baseline:** `Editor.toolbar-placement.test.tsx` (4 failures) is a pre-existing, unrelated tiptap-mock baseline — not introduced or fixed here.
