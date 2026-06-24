import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { Observable } from '../collection/observable';

// ---------------------------------------------------------------------------
// Anchor snapshots — what the view renders the pill / swatch from.
// ---------------------------------------------------------------------------

/** Mobile highlight-pill anchor. `bottom` set → pill sits ABOVE the selection;
 *  `top` set → it flips BELOW (used near the top viewport edge). */
export interface PillAnchor {
  top?: number;
  bottom?: number;
  left: number;
}

/** Desktop highlight-swatch anchor. `autoFocus` carries the input-modality
 *  decision (pointer opens are keyboard-ready immediately). */
export interface SwatchAnchor {
  top: number;
  left: number;
  autoFocus: boolean;
}

export interface SelectionAnchorState {
  pillAnchor: PillAnchor | null;
  swatchAnchor: SwatchAnchor | null;
}

/**
 * Imperative I/O leaves the controller is pure of, injected so it is
 * node-testable without a real ProseMirror mount (mirrors how `RouteTransition`
 * / `GraphView` inject DOM + clock). `coordsAtPos` wraps
 * `editor.view.coordsAtPos`; the viewport getters wrap `window.inner*`.
 */
export interface SelectionAnchorDeps {
  /** Mobile (bottom toolbar) reveals the pill; desktop auto-opens the swatch. */
  isBottomToolbar: boolean;
  coordsAtPos: (pos: number) => { top: number; bottom: number; left: number };
  viewportHeight: () => number;
  viewportWidth: () => number;
}

// Magic constants lifted verbatim from the old inline Editor effect.
export const PILL_SETTLE_MS = 250;
/** If the selection sits this close to the top, flip the pill below it. */
export const PILL_TOP_MARGIN = 56;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;

const PILL_EDGE_GUTTER = 8;
const PILL_OFFSET = 6;
const SWATCH_OFFSET = 6;

interface Range {
  from: number;
  to: number;
}

function sameRange(a: Range | null, b: Range): boolean {
  return a != null && a.from === b.from && a.to === b.to;
}

// ---------------------------------------------------------------------------
// Gesture primitive
// ---------------------------------------------------------------------------

export interface TapPoint {
  t: number;
  x: number;
  y: number;
}

/**
 * Pure double-tap fence: true when `tap` lands inside the time + position
 * thresholds of `prev`. The stateful "record the tap on a miss" wiring stays
 * with its consumer (behind-text decoration re-select) in the Editor; only the
 * comparison is lifted here so it's testable without a DOM event.
 */
export function detectDoubleTap(
  prev: TapPoint | null,
  tap: TapPoint,
  opts: { ms?: number; px?: number } = {},
): boolean {
  const ms = opts.ms ?? DOUBLE_TAP_MS;
  const px = opts.px ?? DOUBLE_TAP_PX;
  return (
    prev != null &&
    tap.t - prev.t <= ms &&
    Math.abs(tap.x - prev.x) <= px &&
    Math.abs(tap.y - prev.y) <= px
  );
}

// ---------------------------------------------------------------------------
// Controller core
// ---------------------------------------------------------------------------

/**
 * Owns the selection-anchor decision that used to live in the single
 * `selectionUpdate` effect inside the Editor: the mobile pill (settle-timer +
 * range-dedup + viewport above/below clamp) and the desktop swatch (anchor +
 * auto-focus + dismissed-range tracking).
 *
 * Pure-state + injected deps so it runs in node. Does NOT own: the popover's
 * search query (`HighlightSwatchPopover` view state), nor any
 * decoration-toolbar / tray / heading-menu state — those stay in the view.
 */
export class SelectionAnchorController extends Observable<SelectionAnchorState> {
  private readonly deps: SelectionAnchorDeps;
  private currentRange: Range | null = null;

  // Pill (mobile)
  private pillAnchor: PillAnchor | null = null;
  private pillTimer: ReturnType<typeof setTimeout> | null = null;
  private pillRange: Range | null = null;

  // Swatch (desktop)
  private swatchRaw: SwatchAnchor | null = null;
  private swatchDismissed = false;
  private dismissedRange: Range | null = null;
  // Input modality, fed by the hook's window listeners. Pointer opens make the
  // swatch keyboard-ready immediately; keyboard opens leave focus in the editor.
  private lastInteraction: 'pointer' | 'keyboard' = 'pointer';
  // True between pointerdown and pointerup — i.e. while a drag-select is still
  // in progress. The swatch must NOT open mid-drag: opening it auto-focuses a
  // swatch button (see HighlightSwatchPopover), which pulls focus out of the
  // contenteditable and aborts the browser's in-progress text selection — the
  // user's drag "stops immediately and only selects a little area". So we hold
  // the swatch closed until the pointer is released and the range has settled.
  private pointerDown = false;

  constructor(deps: SelectionAnchorDeps) {
    super({ pillAnchor: null, swatchAnchor: null });
    this.deps = deps;
  }

  setLastInteraction = (modality: 'pointer' | 'keyboard'): void => {
    this.lastInteraction = modality;
  };

  /**
   * Track the pointer button between down and up. On release, re-evaluate the
   * desktop swatch for the settled selection: now that the drag is over, opening
   * (and auto-focusing) it is safe and is exactly what the user expects.
   */
  setPointerDown = (down: boolean): void => {
    if (this.pointerDown === down) return;
    this.pointerDown = down;
    if (!down && !this.deps.isBottomToolbar && this.currentRange) {
      this.updateSwatch(this.currentRange.from, this.currentRange.to);
    }
  };

  /** Recompute the public snapshot from internal fields; no-op if unchanged. */
  private emit(): void {
    const swatchAnchor = this.swatchDismissed ? null : this.swatchRaw;
    const prev = this.getSnapshot();
    if (prev.pillAnchor === this.pillAnchor && prev.swatchAnchor === swatchAnchor) return;
    this.setState(() => ({ pillAnchor: this.pillAnchor, swatchAnchor }));
  }

  onSelectionUpdate = (from: number, to: number): void => {
    this.currentRange = { from, to };
    if (this.deps.isBottomToolbar) {
      this.updatePill(from, to);
    } else {
      this.updateSwatch(from, to);
    }
  };

  // Mobile: never show the pill mid-drag. Hide while the range is moving, then
  // reveal ~250ms after it settles. Recompute the anchor on fire.
  private updatePill(from: number, to: number): void {
    if (from === to) {
      this.clearPillTimer();
      this.pillRange = null;
      this.pillAnchor = null;
      this.emit();
      return;
    }
    if (sameRange(this.pillRange, { from, to })) return; // unchanged → no-op, avoid flicker
    this.pillRange = { from, to };
    this.pillAnchor = null; // hide while moving
    this.emit();
    this.clearPillTimer();
    this.pillTimer = setTimeout(() => {
      const coords = this.deps.coordsAtPos(from);
      const left = Math.max(
        PILL_EDGE_GUTTER,
        Math.min(coords.left, this.deps.viewportWidth() - PILL_EDGE_GUTTER),
      );
      this.pillAnchor =
        coords.top < PILL_TOP_MARGIN
          ? { top: coords.bottom + PILL_OFFSET, left } // near top → below
          : { bottom: this.deps.viewportHeight() - coords.top + PILL_OFFSET, left }; // default → above
      this.emit();
    }, PILL_SETTLE_MS);
  }

  // Desktop: auto-open on a settled selection. Suppressed mid-drag (see
  // pointerDown) so the auto-focus can't interrupt the in-progress selection.
  private updateSwatch(from: number, to: number): void {
    if (from === to) {
      this.swatchRaw = null;
      this.swatchDismissed = false;
      this.dismissedRange = null;
      this.emit();
      return;
    }
    // Mid-drag: hold the swatch closed. setPointerDown(false) re-runs this once
    // the pointer is released, opening it for the final range.
    if (this.pointerDown) {
      this.swatchRaw = null;
      this.emit();
      return;
    }
    const start = this.deps.coordsAtPos(from);
    this.swatchRaw = {
      top: start.bottom + SWATCH_OFFSET,
      left: start.left,
      autoFocus: this.lastInteraction === 'pointer',
    };
    if (!sameRange(this.dismissedRange, { from, to })) {
      this.swatchDismissed = false;
      this.dismissedRange = null;
    }
    this.emit();
  }

  /**
   * Dismiss the currently-anchored affordance. For the swatch this records the
   * dismissed range so the SAME selection stays dismissed until it changes; for
   * the pill the dedup range already enforces that, so we just hide it.
   */
  dismiss = (): void => {
    this.swatchDismissed = true;
    if (this.currentRange) this.dismissedRange = { ...this.currentRange };
    this.clearPillTimer();
    this.pillAnchor = null;
    this.emit();
  };

  dispose = (): void => {
    this.clearPillTimer();
  };

  private clearPillTimer(): void {
    if (this.pillTimer) {
      clearTimeout(this.pillTimer);
      this.pillTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Thin hook — wires the real deps once and bridges the controller to React.
// ---------------------------------------------------------------------------

const EMPTY_STATE: SelectionAnchorState = { pillAnchor: null, swatchAnchor: null };
const NOOP_SUBSCRIBE = () => () => {};

export interface UseSelectionAnchorResult {
  pillAnchor: PillAnchor | null;
  swatchAnchor: SwatchAnchor | null;
  dismiss: () => void;
}

/**
 * Selection-anchor controller (mobile pill + desktop swatch). Sibling of
 * `useNoteLinkPopup` / `useVerseTooltip`: a thin hook owning the React/TipTap
 * coupling over a pure controller core. The Editor renders the pill + swatch
 * from the returned snapshots and calls `dismiss` to close them.
 */
export function useSelectionAnchor({
  editor,
  isBottomToolbar,
}: {
  editor: Editor | null;
  isBottomToolbar: boolean;
}): UseSelectionAnchorResult {
  const controller = useMemo(() => {
    if (!editor) return null;
    return new SelectionAnchorController({
      isBottomToolbar,
      coordsAtPos: (pos) => editor.view.coordsAtPos(pos),
      viewportHeight: () => window.innerHeight,
      viewportWidth: () => window.innerWidth,
    });
  }, [editor, isBottomToolbar]);

  const state = useSyncExternalStore(
    controller ? controller.subscribe : NOOP_SUBSCRIBE,
    controller ? controller.getSnapshot : () => EMPTY_STATE,
  );

  // Feed the swatch auto-focus decision its input modality. Sole consumer of
  // this signal, so it lives here rather than in the view shell.
  useEffect(() => {
    if (!controller) return;
    const onPointerDown = () => {
      controller.setLastInteraction('pointer');
      controller.setPointerDown(true);
    };
    // pointerup may land outside the editor (drag released over the gutter), and
    // pointercancel covers gesture interruptions — both end the drag, so listen
    // on the window in the capture phase to catch them wherever they fire.
    const onPointerUp = () => controller.setPointerDown(false);
    const onKey = () => controller.setLastInteraction('keyboard');
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [controller]);

  useEffect(() => {
    if (!editor || !controller) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      controller.onSelectionUpdate(from, to);
    };
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('selectionUpdate', update);
      controller.dispose();
    };
  }, [editor, controller]);

  const dismiss = useCallback(() => {
    controller?.dismiss();
  }, [controller]);

  return { pillAnchor: state.pillAnchor, swatchAnchor: state.swatchAnchor, dismiss };
}
