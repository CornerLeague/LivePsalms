// src/notepad/components/HighlightSwatchPopover.tsx
import { useEffect, useRef, useState } from 'react';
import { filterAssets, type StyleAsset } from '../styles/manifest';

interface Anchor { top: number; left: number; }

interface Props {
  assets: StyleAsset[];
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (swatchId: string) => void;
  onRemove: () => void;
  onClose: () => void;
  autoFocus: boolean;
  onRequestEditorFocus?: () => void;
  anchor: Anchor;
}

export function HighlightSwatchPopover({
  assets, query, onQueryChange, onPick, onRemove, onClose, autoFocus, onRequestEditorFocus, anchor,
}: Props) {
  const shown = filterAssets(assets, 'highlight', query);
  const rootRef = useRef<HTMLDivElement>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep the active index in range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  // Pointer-driven opens are keyboard-ready immediately; keyboard-driven opens
  // leave focus in the editor (so selection isn't interrupted).
  useEffect(() => {
    if (autoFocus) swatchRefs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSwatchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(shown.length - 1, activeIndex + 1);
      setActiveIndex(next);
      swatchRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(0, activeIndex - 1);
      setActiveIndex(prev);
      swatchRefs.current[prev]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const a = shown[activeIndex];
      if (a) onPick(a.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      onRequestEditorFocus?.();
    }
  };

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
        left: anchor.left,
        zIndex: 60,
        width: 200,
        background: 'var(--highlight-panel-bg)',
        border: '1px solid var(--pale-stone)',
        borderRadius: 9,
        boxShadow: '0 8px 22px rgba(0,0,0,.16)',
        padding: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search…"
          aria-label="Search highlights"
          style={{ flex: 1, fontSize: 12, padding: '3px 6px', border: '1px solid var(--pale-stone)', borderRadius: 6 }}
        />
        <button aria-label="Close highlights" onClick={onClose}
          style={{ fontSize: 11, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)', padding: '0 4px' }}>
          ✕
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
          {/* Pointer path for removal; the keyboard path is Delete/Backspace on a swatch. */}
        <button
          aria-label="Remove highlight"
          onClick={onRemove}
          style={{ height: 26, border: '1px solid var(--pale-stone)', borderRadius: 5, background: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--silica)' }}
        >
          ✕
        </button>
        {shown.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => { swatchRefs.current[i] = el; }}
            aria-label={`Highlight ${a.id}`}
            tabIndex={i === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(i)}
            onKeyDown={onSwatchKeyDown}
            onClick={() => onPick(a.id)}
            style={{ height: 26, border: '1px solid var(--pale-stone)', borderRadius: 5, overflow: 'hidden', background: '#fff', cursor: 'pointer', padding: 0 }}
          >
            <img src={a.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
