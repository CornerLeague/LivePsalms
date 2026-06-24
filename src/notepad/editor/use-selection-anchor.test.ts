import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SelectionAnchorController,
  detectDoubleTap,
  PILL_SETTLE_MS,
  PILL_TOP_MARGIN,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_PX,
  type SelectionAnchorDeps,
} from './use-selection-anchor';

// Plain fakes for the injected I/O leaves — no ProseMirror, no DOM. Coords and
// viewport are mutated in-place by tests that need them to vary across fires.
function makeDeps(over: Partial<SelectionAnchorDeps> = {}): SelectionAnchorDeps {
  return {
    isBottomToolbar: false,
    coordsAtPos: () => ({ top: 200, bottom: 220, left: 30 }),
    viewportHeight: () => 800,
    viewportWidth: () => 400,
    ...over,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SelectionAnchorController — desktop swatch', () => {
  it('anchors the swatch immediately on selection, with no settle delay', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.onSelectionUpdate(2, 8);
    // No timers advanced — desktop is synchronous.
    expect(c.getSnapshot().swatchAnchor).toEqual({ top: 226, left: 30, autoFocus: true });
    expect(c.getSnapshot().pillAnchor).toBeNull();
  });

  it('carries the autoFocus decision from the last-interaction modality', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    // Default modality is pointer → keyboard-ready immediately.
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().swatchAnchor?.autoFocus).toBe(true);
    // A keyboard interaction flips it off so focus stays in the editor.
    c.setLastInteraction('keyboard');
    c.onSelectionUpdate(3, 9);
    expect(c.getSnapshot().swatchAnchor?.autoFocus).toBe(false);
  });

  it('dismiss() clears the swatch and keeps the same range dismissed until the selection changes', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().swatchAnchor).not.toBeNull();

    c.dismiss();
    expect(c.getSnapshot().swatchAnchor).toBeNull();

    // Same range fires again → stays dismissed.
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().swatchAnchor).toBeNull();

    // A different range → the swatch comes back.
    c.onSelectionUpdate(3, 9);
    expect(c.getSnapshot().swatchAnchor).not.toBeNull();
  });

  it('does not produce a pill on desktop', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().pillAnchor).toBeNull();
  });

  it('keeps the swatch closed while a pointer drag is in progress, then opens it on release', () => {
    // Opening (and auto-focusing) the swatch mid-drag pulls focus out of the
    // editor and truncates the selection the user is still dragging — so while
    // the pointer is down the swatch must stay closed.
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.setPointerDown(true);
    c.onSelectionUpdate(2, 5); // selection growing under the dragging cursor
    expect(c.getSnapshot().swatchAnchor).toBeNull();
    c.onSelectionUpdate(2, 8); // still dragging
    expect(c.getSnapshot().swatchAnchor).toBeNull();

    // Release: the settled selection opens the swatch, keyboard-ready (pointer).
    c.setPointerDown(false);
    expect(c.getSnapshot().swatchAnchor).toEqual({ top: 226, left: 30, autoFocus: true });
  });

  it('does not open a swatch on pointer release when the selection is collapsed', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.setPointerDown(true);
    c.onSelectionUpdate(5, 5); // a plain click — caret only, no range
    c.setPointerDown(false);
    expect(c.getSnapshot().swatchAnchor).toBeNull();
  });

  it('re-opens a dismissed swatch when a drag ends on a DIFFERENT range', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.onSelectionUpdate(2, 8);
    c.dismiss(); // dismiss the (2,8) swatch
    expect(c.getSnapshot().swatchAnchor).toBeNull();

    // Drag to a new range and release. The final range differs from the
    // dismissed one, so the swatch clears its dismissed state and re-opens.
    c.setPointerDown(true);
    c.onSelectionUpdate(2, 9); // mid-drag — stays closed
    expect(c.getSnapshot().swatchAnchor).toBeNull();
    c.setPointerDown(false);
    expect(c.getSnapshot().swatchAnchor).toEqual({ top: 226, left: 30, autoFocus: true });
  });

  it('keeps a dismissed swatch dismissed when a drag ends on the SAME range', () => {
    // Guards the mid-drag block against a stray swatchDismissed reset: starting
    // a drag must not resurrect a swatch the user dismissed for this range.
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.onSelectionUpdate(2, 8);
    c.dismiss();
    expect(c.getSnapshot().swatchAnchor).toBeNull();

    c.setPointerDown(true);
    c.onSelectionUpdate(2, 9); // wander mid-drag…
    c.onSelectionUpdate(2, 8); // …and settle back on the dismissed range
    c.setPointerDown(false);
    expect(c.getSnapshot().swatchAnchor).toBeNull();
  });
});

describe('SelectionAnchorController — mobile pill', () => {
  it('reveals the pill only after the settle timer fires', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: true }));
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().pillAnchor).toBeNull(); // still "moving"

    vi.advanceTimersByTime(PILL_SETTLE_MS);
    expect(c.getSnapshot().pillAnchor).not.toBeNull(); // settled
    expect(c.getSnapshot().swatchAnchor).toBeNull(); // mobile never shows the swatch
  });

  it('does not re-fire or re-anchor for a new selection within the same dedup range', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: true }));
    c.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    const settled = c.getSnapshot().pillAnchor;
    expect(settled).not.toBeNull();

    // Same range again: no hide/reschedule, the anchor snapshot is untouched.
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().pillAnchor).toBe(settled); // same reference, no churn
  });

  it('hides the pill while a different selection settles, then re-anchors', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: true }));
    c.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    expect(c.getSnapshot().pillAnchor).not.toBeNull();

    // New range → hidden immediately while it "moves".
    c.onSelectionUpdate(3, 9);
    expect(c.getSnapshot().pillAnchor).toBeNull();
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    expect(c.getSnapshot().pillAnchor).not.toBeNull();
  });

  it('anchors above the selection (bottom prop) by default, away from the top edge', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(
      makeDeps({
        isBottomToolbar: true,
        coordsAtPos: () => ({ top: 200, bottom: 220, left: 30 }), // top >= PILL_TOP_MARGIN
        viewportHeight: () => 800,
      }),
    );
    c.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    const anchor = c.getSnapshot().pillAnchor!;
    expect(anchor.top).toBeUndefined();
    expect(anchor.bottom).toBe(800 - 200 + 6); // viewportHeight - coords.top + 6
  });

  it('flips below the selection (top prop) when the selection sits near the top edge', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(
      makeDeps({
        isBottomToolbar: true,
        coordsAtPos: () => ({ top: 10, bottom: 30, left: 30 }), // top < PILL_TOP_MARGIN
      }),
    );
    expect(10).toBeLessThan(PILL_TOP_MARGIN);
    c.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    const anchor = c.getSnapshot().pillAnchor!;
    expect(anchor.bottom).toBeUndefined();
    expect(anchor.top).toBe(30 + 6); // coords.bottom + 6
  });

  it('clamps the pill horizontally inside the viewport', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(
      makeDeps({
        isBottomToolbar: true,
        coordsAtPos: () => ({ top: 200, bottom: 220, left: -100 }), // off the left edge
        viewportWidth: () => 400,
      }),
    );
    c.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    expect(c.getSnapshot().pillAnchor!.left).toBe(8); // clamped to the 8px gutter

    const c2 = new SelectionAnchorController(
      makeDeps({
        isBottomToolbar: true,
        coordsAtPos: () => ({ top: 200, bottom: 220, left: 99999 }), // off the right edge
        viewportWidth: () => 400,
      }),
    );
    c2.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    expect(c2.getSnapshot().pillAnchor!.left).toBe(400 - 8); // viewportWidth - 8
  });
});

describe('SelectionAnchorController — collapsed selection', () => {
  it('clears both anchors when the selection is collapsed (desktop)', () => {
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: false }));
    c.onSelectionUpdate(2, 8);
    expect(c.getSnapshot().swatchAnchor).not.toBeNull();
    c.onSelectionUpdate(5, 5);
    expect(c.getSnapshot().swatchAnchor).toBeNull();
    expect(c.getSnapshot().pillAnchor).toBeNull();
  });

  it('clears both anchors when the selection collapses (mobile)', () => {
    vi.useFakeTimers();
    const c = new SelectionAnchorController(makeDeps({ isBottomToolbar: true }));
    c.onSelectionUpdate(2, 8);
    vi.advanceTimersByTime(PILL_SETTLE_MS);
    expect(c.getSnapshot().pillAnchor).not.toBeNull();
    c.onSelectionUpdate(5, 5);
    expect(c.getSnapshot().pillAnchor).toBeNull();
    expect(c.getSnapshot().swatchAnchor).toBeNull();
  });
});

describe('detectDoubleTap', () => {
  it('returns false when there is no previous tap', () => {
    expect(detectDoubleTap(null, { t: 100, x: 10, y: 10 })).toBe(false);
  });

  it('registers two taps inside the time and position thresholds', () => {
    const prev = { t: 100, x: 10, y: 10 };
    expect(detectDoubleTap(prev, { t: 100 + DOUBLE_TAP_MS, x: 10 + DOUBLE_TAP_PX, y: 10 })).toBe(true);
  });

  it('rejects a second tap outside the time threshold', () => {
    const prev = { t: 100, x: 10, y: 10 };
    expect(detectDoubleTap(prev, { t: 100 + DOUBLE_TAP_MS + 1, x: 10, y: 10 })).toBe(false);
  });

  it('rejects a second tap outside the position threshold', () => {
    const prev = { t: 100, x: 10, y: 10 };
    expect(detectDoubleTap(prev, { t: 120, x: 10 + DOUBLE_TAP_PX + 1, y: 10 })).toBe(false);
    expect(detectDoubleTap(prev, { t: 120, x: 10, y: 10 + DOUBLE_TAP_PX + 1 })).toBe(false);
  });
});
