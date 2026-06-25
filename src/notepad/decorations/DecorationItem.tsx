// src/notepad/decorations/DecorationItem.tsx
import { useEffect, useRef, useState } from 'react';
import { getStyleAsset } from '../styles/manifest';
import {
  moveTo, resizeWidthPct, rotationDeg, pinchTransform,
  decorationZIndex, pointerAngleDeg, applyRotationDrag, SELECTED_Z,
  resizeFromCorner, snapAngle,
} from './decoration-geometry';
import type { ResizeCorner } from './decoration-geometry';
import type { NoteDecoration } from '../types';

const MOBILE_DRAG_THRESHOLD_PX = 6;
const SNAP = { step: 45, threshold: 5 };

interface Props {
  decoration: NoteDecoration;
  selected: boolean;
  contentWidth: number;
  /** Mobile (bottom-toolbar) layout: enables finger-first handles, snapping
   *  rotation, drag threshold, and hides the floating action bar. */
  mobile?: boolean;
  onChange: (next: NoteDecoration) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
  onDeselect: () => void;
}

type Gesture = { kind: 'move' | 'resize'; startX: number; startY: number; base: NoteDecoration; movedEnough: boolean; corner?: ResizeCorner };

export function DecorationItem({
  decoration: d, selected, contentWidth, mobile = false,
  onChange, onSelect, onDelete, onDuplicate, onBringToFront, onSendToBack, onDeselect,
}: Props) {
  const asset = getStyleAsset(d.assetId);
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const rotateGesture = useRef<
    { centerX: number; centerY: number; startAngle: number; startRotation: number } | null
  >(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ startDist: number; startAngle: number; base: NoteDecoration } | null>(null);
  const [liveAngle, setLiveAngle] = useState<{ deg: number; snapped: boolean } | null>(null);

  const snapRotation = (deg: number): number => {
    const snapped = snapAngle(deg, SNAP);
    if (snapped !== rotationDeg(deg)) {
      try { navigator.vibrate?.(10); } catch { /* unsupported (iOS Safari) — visual feedback only */ }
    }
    return snapped;
  };

  // Move focus to the selection chrome when a decoration becomes selected, so
  // keyboard events target the decoration (not the contenteditable text).
  useEffect(() => {
    if (selected) rootRef.current?.focus();
  }, [selected]);

  const onChromeKeyDown = (e: React.KeyboardEvent) => {
    // Only handle keys when the chrome itself is focused — let child controls
    // (action-bar buttons, handles) keep their native keyboard behavior.
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        onDelete(d.id);
        break;
      case 'Escape':
        e.preventDefault();
        onDeselect();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dxPx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dyPx = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        onChange(moveTo(d, { dxPx, dyPx, contentWidth }));
        break;
      }
      default:
        break;
    }
  };

  const twoPointerMetrics = () => {
    const pts = [...pointers.current.values()];
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return { dist: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && pinch.current) {
      // Pinch is ending: tear it down and clear the live angle badge so it does
      // not stay stranded on screen after the fingers lift.
      pinch.current = null;
      setLiveAngle(null);
    }
    end(e);
  };

  if (!asset) return null;

  const start = (kind: Gesture['kind']) => (e: React.PointerEvent) => {
    e.stopPropagation();
    // Assign gesture state BEFORE touching pointer capture so a jsdom
    // limitation in setPointerCapture can never prevent the drag from starting.
    gesture.current = { kind, startX: e.clientX, startY: e.clientY, base: d, movedEnough: false };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom may not implement pointer capture; harmless no-op */
    }
    if (kind === 'move') onSelect(d.id);
  };

  const startCorner = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    gesture.current = { kind: 'resize', startX: e.clientX, startY: e.clientY, base: d, movedEnough: true, corner };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom may not implement pointer capture; harmless no-op */
    }
  };

  const move = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dxPx = e.clientX - g.startX;
    const dyPx = e.clientY - g.startY;
    if (g.kind === 'move') {
      if (mobile && !g.movedEnough) {
        if (Math.hypot(dxPx, dyPx) < MOBILE_DRAG_THRESHOLD_PX) return;
        g.movedEnough = true;
      }
      onChange(moveTo(g.base, { dxPx, dyPx, contentWidth }));
    } else if (g.corner) {
      onChange(resizeFromCorner(g.base, {
        corner: g.corner, dxPx, dyPx, contentWidth, aspectRatio: asset.aspectRatio,
      }));
    } else {
      onChange(resizeWidthPct(g.base, { dxPx, contentWidth }));
    }
  };

  const end = (e: React.PointerEvent) => {
    try {
      if ((e.target as Element).hasPointerCapture?.(e.pointerId)) {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      }
    } catch {
      /* jsdom may not implement pointer capture; harmless no-op */
    }
    gesture.current = null;
  };

  // Combined select + move + pinch handler. Applied to the body image when the
  // decoration is unselected (so a click selects/drags it) and to the top chrome
  // surface when selected (so it stays draggable even if the image is behind text).
  const surfacePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const m = twoPointerMetrics();
      pinch.current = { startDist: m.dist, startAngle: m.angle, base: d };
      gesture.current = null;
    } else {
      gesture.current = { kind: 'move', startX: e.clientX, startY: e.clientY, base: d, movedEnough: false };
      onSelect(d.id);
    }
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom may not implement pointer capture; harmless no-op */
    }
  };

  const surfacePointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinch.current && pointers.current.size >= 2) {
      const m = twoPointerMetrics();
      const transformed = pinchTransform(pinch.current.base, {
        startDist: pinch.current.startDist, dist: m.dist,
        startAngle: pinch.current.startAngle, angle: m.angle,
      });
      if (mobile) {
        const snappedRot = snapRotation(transformed.rotation);
        setLiveAngle({ deg: snappedRot, snapped: snappedRot % SNAP.step === 0 });
        onChange({ ...transformed, rotation: snappedRot });
      } else {
        onChange(transformed);
      }
      return;
    }
    move(e);
  };

  const rotateDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const rect = rootRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : 0;
    const centerY = rect ? rect.top + rect.height / 2 : 0;
    rotateGesture.current = {
      centerX,
      centerY,
      startAngle: pointerAngleDeg({ x: centerX, y: centerY }, { x: e.clientX, y: e.clientY }),
      startRotation: d.rotation,
    };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom may not implement pointer capture; harmless no-op */
    }
  };

  const rotateMove = (e: React.PointerEvent) => {
    const g = rotateGesture.current;
    if (!g) return;
    const currentAngle = pointerAngleDeg(
      { x: g.centerX, y: g.centerY },
      { x: e.clientX, y: e.clientY },
    );
    const raw = applyRotationDrag(g.startRotation, g.startAngle, currentAngle);
    const next = mobile ? snapRotation(raw) : raw;
    if (mobile) setLiveAngle({ deg: next, snapped: next % SNAP.step === 0 });
    onChange({ ...d, rotation: next });
  };

  const rotateEnd = (e: React.PointerEvent) => {
    try {
      if ((e.target as Element).hasPointerCapture?.(e.pointerId)) {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      }
    } catch {
      /* jsdom may not implement pointer capture; harmless no-op */
    }
    rotateGesture.current = null;
    setLiveAngle(null);
  };

  // Shared geometry: position + size + rotation. The image layer and the chrome
  // layer use identical geometry but live at different z so they stay aligned.
  const renderedWidth = d.widthPct * contentWidth;
  const geometry: React.CSSProperties = {
    position: 'absolute',
    // Fixed px from a frozen reference width (not container %), so resizing the
    // window never moves or rescales the decoration.
    left: d.xPct * contentWidth,
    top: d.yPx,
    width: renderedWidth,
    transform: `rotate(${d.rotation}deg)`,
    transformOrigin: 'center center',
  };
  // The chrome layer holds only absolutely-positioned children, so it needs an
  // explicit height (matching the <img> render = width / aspectRatio) for its
  // outline, drag surface (inset:0) and bottom-right handle to line up.
  const renderedHeight = asset.aspectRatio > 0 ? renderedWidth / asset.aspectRatio : renderedWidth;

  return (
    <>
      {/* Body image — rendered at its TRUE layer (behind or in front of text)
          regardless of selection, so 'send to back' / 'bring to front' are
          reflected immediately. When selected it is purely visual; interaction
          moves to the chrome layer below. */}
      <div style={{ ...geometry, zIndex: decorationZIndex(d, false), pointerEvents: selected ? 'none' : 'auto' }}>
        <div
          data-testid={`decoration-body-${d.id}`}
          onPointerDown={selected ? undefined : surfacePointerDown}
          onPointerMove={selected ? undefined : surfacePointerMove}
          onPointerUp={selected ? undefined : endPointer}
          onPointerCancel={selected ? undefined : endPointer}
          style={{
            cursor: 'move',
            touchAction: 'none',
            // Flip the asset only — keep handles/action-bar glyphs un-mirrored.
            transform: `scaleX(${d.flipH ? -1 : 1}) scaleY(${d.flipV ? -1 : 1})`,
          }}
        >
          <img src={asset.displayUrl} alt="" draggable={false}
            style={{ width: '100%', height: 'auto', display: 'block', userSelect: 'none' }} />
        </div>
      </div>

      {/* Selection chrome — always on top (SELECTED_Z) so handles stay grabbable
          even when the body image is behind the text. pointerEvents:none on the
          root; only the surface/handles/action-bar re-enable them. */}
      {selected && (
        <div
          ref={rootRef}
          data-testid={`decoration-chrome-${d.id}`}
          tabIndex={0}
          role="group"
          aria-label="Decoration selected — arrow keys move, Delete removes, Escape deselects"
          onKeyDown={onChromeKeyDown}
          style={{ ...geometry, height: renderedHeight, zIndex: SELECTED_Z, outline: '2px solid var(--deep-umber)', pointerEvents: 'none' }}
        >
          {/* Full-box drag/pinch surface (transparent), so a selected decoration
              stays movable even when its image sits behind the text. */}
          <div
            data-testid={`decoration-surface-${d.id}`}
            onPointerDown={surfacePointerDown}
            onPointerMove={surfacePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            style={{ position: 'absolute', inset: 0, cursor: 'move', touchAction: 'none', pointerEvents: 'auto' }}
          />

          {/* Relies on pointer capture (set in `start`) to keep receiving moves once the pointer leaves the 12px handle; no-op in jsdom. */}
          {!mobile && (
            <div
              aria-label="Resize decoration"
              onPointerDown={start('resize')}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              style={{ ...handleStyle('-6px', '-6px', 'nwse-resize', 'bottom-right'), pointerEvents: 'auto' }}
            />
          )}
          {mobile && (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
            <div
              key={corner}
              aria-label={`Resize ${corner}`}
              onPointerDown={startCorner(corner)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              style={{ ...cornerHitArea(corner), pointerEvents: 'auto' }}
            >
              <span style={visualDot} />
            </div>
          ))}
          <div
            aria-label="Rotate decoration"
            onPointerDown={rotateDown}
            onPointerMove={rotateMove}
            onPointerUp={rotateEnd}
            onPointerCancel={rotateEnd}
            style={mobile
              ? { ...rotateHitAreaMobile, pointerEvents: 'auto' }
              : { ...handleStyle('-22px', 'calc(50% - 6px)', 'grab', 'top'), pointerEvents: 'auto' }}
          >
            {mobile && <span style={visualDot} />}
          </div>
          {mobile && liveAngle !== null && (
            <div
              data-testid={`decoration-angle-badge-${d.id}`}
              data-snapped={liveAngle.snapped ? 'true' : 'false'}
              className={liveAngle.snapped ? 'decoration-snap-pulse' : undefined}
              style={{
                position: 'absolute', top: -58, left: 'calc(50% + 26px)',
                background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)', borderRadius: 4,
                padding: '1px 5px', fontSize: 11, color: 'var(--charred)',
                fontFamily: 'Outfit, sans-serif', pointerEvents: 'none', whiteSpace: 'nowrap',
              }}
            >
              {Math.round(liveAngle.deg)}&deg;
            </div>
          )}
          {!mobile && (
            <div style={{
              position: 'absolute', top: -34, left: 0, display: 'flex', gap: 4,
              background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)', borderRadius: 6,
              padding: '2px 4px', boxShadow: '0 2px 8px rgba(0,0,0,.14)', pointerEvents: 'auto',
            }}>
              <button aria-label="Rotate decoration counterclockwise 15 degrees" onClick={() => onChange({ ...d, rotation: rotationDeg(d.rotation - 15) })} style={barBtn}>↺</button>
              <button aria-label="Rotate decoration 15 degrees" onClick={() => onChange({ ...d, rotation: rotationDeg(d.rotation + 15) })} style={barBtn}>↻</button>
              <button aria-label="Flip horizontal" onClick={() => onChange({ ...d, flipH: !d.flipH })} style={barBtn}>⇋</button>
              <button aria-label="Flip vertical" onClick={() => onChange({ ...d, flipV: !d.flipV })} style={barBtn}>⇅</button>
              <button aria-label="Bring to front" onClick={() => onBringToFront(d.id)} style={barBtn}>⤒</button>
              <button aria-label="Send to back" onClick={() => onSendToBack(d.id)} style={barBtn}>⤓</button>
              <button aria-label="Duplicate decoration" onClick={() => onDuplicate(d.id)} style={barBtn}>⎘</button>
              <button aria-label="Delete decoration" onClick={() => onDelete(d.id)} style={barBtn}>✕</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const barBtn: React.CSSProperties = {
  fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 3px', color: 'var(--charred)',
};

function handleStyle(
  top: string, right: string, cursor: string, kind: 'bottom-right' | 'top',
): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute', width: 12, height: 12, borderRadius: '50%',
    background: 'var(--plaster)', border: '2px solid var(--deep-umber)', cursor,
  };
  if (kind === 'bottom-right') return { ...base, bottom: top, right };
  return { ...base, top, left: right };
}

// 44px transparent touch target centered on the box corner (negative offsets =
// half the hit-area size so the corner sits at its center).
function cornerHitArea(corner: ResizeCorner): React.CSSProperties {
  const SIZE = 44;
  const off = -SIZE / 2;
  const base: React.CSSProperties = {
    position: 'absolute', width: SIZE, height: SIZE,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    touchAction: 'none', cursor: (corner === 'top-left' || corner === 'bottom-right') ? 'nwse-resize' : 'nesw-resize', background: 'transparent',
  };
  const top = corner.startsWith('top');
  const left = corner.endsWith('left');
  return { ...base, top: top ? off : undefined, bottom: top ? undefined : off, left: left ? off : undefined, right: left ? undefined : off };
}

const visualDot: React.CSSProperties = {
  width: 24, height: 24, borderRadius: '50%', background: 'var(--plaster)',
  border: '2px solid var(--deep-umber)', boxShadow: '0 1px 3px rgba(0,0,0,.18)',
};

const rotateHitAreaMobile: React.CSSProperties = {
  position: 'absolute', width: 44, height: 44, top: -62, left: 'calc(50% - 22px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  touchAction: 'none', cursor: 'grab', background: 'transparent',
};
