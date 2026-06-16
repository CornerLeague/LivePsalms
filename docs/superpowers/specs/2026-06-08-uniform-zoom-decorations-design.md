# Uniform-Zoom Decorations — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)

## Problem

Notepad decorations (style stickers placed over a note) do not currently track
the screen as it resizes. After an earlier change they were pinned to a frozen
reference width: resizing the window neither moved nor resized them.

The desired behavior: a decoration should **scale with the content** as the
screen view changes, staying relative to the position it had when the user saved
it (clicked out of it), and resizing proportionally so it keeps its state — for
both shrinking and enlarging the screen.

## History / context

- The very first bug was that decorations scaled **non-uniformly**: horizontal
  position (`xPct`) and width (`widthPct`) were fractions of the container width
  and so scaled on resize, but vertical position (`yPx`) was absolute pixels and
  did not. The result was a diagonal drift.
- That was "fixed" by **freezing** the reference width so nothing moved or
  resized on resize (stable-per-session).
- This design **reverses** the freeze and instead makes scaling **uniform**, so
  decorations track the screen without drifting.

## Decision summary

1. **Scaling model — uniform zoom.** On a width change, a decoration's
   horizontal position, vertical position, and size all scale by the same factor
   (the content-width ratio). It keeps its exact relative spot and proportions at
   any width.
2. **Live.** Scaling follows the container width continuously as the view
   changes (not snapshotted).
3. **Migration — best-effort convert on load.** Decorations saved under the old
   model (absolute `yPx`) are converted once to the new fraction unit using the
   current content width, then persisted in the new format.

### Explicit trade-off

The editor text font stays fixed and reflows; decorations scale by width. So a
decoration does **not** stick to a specific word across large width changes — it
holds its *relative position on the page* and its *proportional size*. This is
the accepted consequence of uniform zoom.

## Approach (chosen: A)

**A — Live width + fraction-of-width coordinates.** The `ResizeObserver` tracks
the live container width and feeds it as `contentWidth`. All three coordinates
are fractions of that width; each render computes pixels as `frac · W`. Drag math
divides every delta by `W`. Smallest change to the current architecture; removes
the freeze rather than adding more; existing `hitTestBehind` and selection-chrome
math already operate in fraction space, so no coordinate inversion is needed.

Rejected: **B** (fixed canvas + one CSS `transform: scale()`) — uniform by
construction but adds a stored reference width and forces every pointer
interaction to invert the scale; more machinery for the same visual result.
Pure-CSS percentages are not viable because CSS `top: %` is relative to container
*height*, not width.

## Components & changes

### 1. Data model — `src/notepad/types.ts`
- `NoteDecoration.yPx: number` → `yPct: number` (vertical position as a fraction
  of content width; same basis as `xPct` and `widthPct`).
- Keep `yPx?: number` as an optional **legacy input** field, read only during
  migration.

### 2. Live width — `src/notepad/decorations/DecorationLayer.tsx`
- Replace the frozen measurement with a live `ResizeObserver` that updates
  `contentWidth` on every resize, seeded by a synchronous first measure in
  `useLayoutEffect` (no first-paint flash).
- Remove `key={activeNote.id}` on `<DecorationLayer>` in `Editor.tsx` — it existed
  only to re-snapshot the frozen width and is no longer needed.

### 3. Rendering — `src/notepad/decorations/DecorationItem.tsx`
- Geometry: `left = xPct·W`, `top = yPct·W`, `width = widthPct·W`; height derives
  from the asset aspect ratio (`renderedWidth / aspectRatio`), unchanged.
- Both the image layer and the selection chrome use this geometry (already true).
- No-jump render fallback for legacy data: resolve vertical as
  `yPct ?? (W > 0 ? yPx / W : 0)`, so a not-yet-migrated decoration renders at its
  old pixel `top` for the single frame before migration persists.

### 4. Interaction math — `src/notepad/decorations/decoration-geometry.ts`
- `moveTo`: `yPct = d.yPct + dyPx / contentWidth` (was `yPx + dyPx`).
- `clampDecoration`: clamp `yPct ≥ 0` (was `yPx ≥ 0`); `xPct` clamp unchanged.
- `decorationBox`: `top = d.yPct · refWidth` (was `d.yPx`).
- `resizeWidthPct`, `pinchTransform`: unchanged.

### 5. Migration — helper + `useDecorations` (bulk persist) + `DecorationLayer` (trigger)
- Pure helper `migrateLegacyDecoration(d, width)` in `decoration-geometry.ts`: if
  `yPct` is undefined and `yPx` is defined, return
  `{ ...d, yPct: width > 0 ? d.yPx / width : 0 }` with `yPx` removed; otherwise
  return `d` unchanged.
- **Bulk persist (single commit).** `useDecorations` exposes
  `migrateLegacy(width)` which, only if at least one decoration is legacy,
  commits `decorations.map(d => migrateLegacyDecoration(d, width))` in **one**
  `commit`. A per-item `onChange` loop is NOT used: each `commit` derives from the
  same `decorations` snapshot, so looping would let later items overwrite earlier
  ones (stale-closure) — bulk-map-then-commit-once avoids this.
- **Trigger.** `DecorationLayer` gains an optional prop `onFirstWidth(width)`
  called exactly once when the measured width first becomes `> 0`. `Editor.tsx`
  wires `onFirstWidth={decorationsApi.migrateLegacy}`. Single call → no loop;
  no-op when nothing is legacy.
- Other `yPx` producers move to the new unit:
  - `Editor.tsx` tray placement default `yPx: 80` → `yPct: 0.1`.
  - `decoration-ops.ts` `duplicateDecoration` offset `yPx + 20` → `yPct + 0.02`
    (mirrors the existing `xPct + 0.02`).

## Testing

- **Geometry (pure):** update `moveTo` / `clampDecoration` / `decorationBox` tests
  to `yPct`; add `migrateLegacyDecoration` tests (converts `yPx`→`yPct` by width;
  leaves already-migrated untouched; width 0 → `yPct` 0).
- **DecorationItem:** fixtures `yPx`→`yPct`; assert `top` scales as `yPct·W`.
- **DecorationLayer:** replace the "freezes the reference width" test with a
  **live-resize** test — fire the `ResizeObserver` at 1000px then 1400px and assert
  rendered `left`/`top`/`width` scale ×1.4. Add a test that `onFirstWidth` fires
  once with the measured width when it first becomes `> 0`.
- **useDecorations:** `migrateLegacy(width)` converts every legacy decoration in a
  single `commit` (assert one resulting state update carries `yPct` for all legacy
  items); is a no-op when no decoration is legacy.
- **Editor:** update the tray-placement default assertion if present.
- Full notepad suite stays green except the known pre-existing
  `Editor.toolbar-placement` baseline (unrelated tiptap mock failure).

## Out of scope

- Scaling the editor **text** font with width (text remains fixed + reflowing).
- Anchoring decorations to specific text positions/characters.
- Changing min/max size limits (`MIN_WIDTH_PCT` / `MAX_WIDTH_PCT` unchanged).
