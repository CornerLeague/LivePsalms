// src/notepad/components/HighlightPill.tsx
import { useEffect, useRef } from 'react';
import { filterAssets, type StyleAsset } from '../styles/manifest';

interface Anchor { top?: number; bottom?: number; left: number; }

interface Props {
  assets: StyleAsset[];
  anchor: Anchor;
  onPick: (swatchId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

// Mobile-only floating pill, rendered just above (or below) the settled
// selection. Presentational: it consumes a ready-made anchor; positioning math
// lives in the editor. The remove chip stays pinned at the left while the
// swatches scroll horizontally in their own track beside it.
export function HighlightPill({ assets, anchor, onPick, onRemove, onClose }: Props) {
  const shown = filterAssets(assets, 'highlight', '');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Highlight swatches"
      style={{
        position: 'fixed',
        top: anchor.top,
        bottom: anchor.bottom,
        left: anchor.left,
        zIndex: 60,
        maxWidth: 'calc(100vw - 16px)',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: 'var(--highlight-panel-bg)',
        border: '1px solid var(--pale-stone)',
        borderRadius: 9,
        boxShadow: '0 8px 22px rgba(0,0,0,.16)',
        padding: 6,
        overflow: 'hidden',
      }}
    >
      <button
        aria-label="Remove highlight"
        onClick={onRemove}
        style={{ flex: '0 0 auto', height: 28, width: 28, border: '1px solid var(--pale-stone)', borderRadius: 6, background: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--silica)' }}
      >
        ✕
      </button>
      <div
        className="scrollbar-hide"
        style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto' }}
      >
        {shown.map((a) => (
          <button
            key={a.id}
            aria-label={`Highlight ${a.id}`}
            onClick={() => onPick(a.id)}
            style={{ flex: '0 0 auto', height: 28, width: 36, border: '1px solid var(--pale-stone)', borderRadius: 6, overflow: 'hidden', background: '#fff', cursor: 'pointer', padding: 0 }}
          >
            <img src={a.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
