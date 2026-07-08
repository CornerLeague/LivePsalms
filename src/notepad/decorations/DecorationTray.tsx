// src/notepad/decorations/DecorationTray.tsx
import { useState } from 'react';
import { filterAssets, type StyleAsset, type StyleCategory } from '../styles/manifest';

interface Props {
  assets: StyleAsset[];
  onPlace: (assetId: string) => void;
  onClose: () => void;
}

const PILLS: { label: string; value: StyleCategory | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Shapes', value: 'shape' },
  { label: 'Arrows', value: 'arrow' },
  { label: 'Bubbles', value: 'bubble' },
  { label: 'Squiggles', value: 'squiggle' },
  { label: 'Lines', value: 'line' },
];

export function DecorationTray({ assets, onPlace, onClose }: Props) {
  const [category, setCategory] = useState<StyleCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  // Highlights live in the selection popover, not the tray.
  const decorationAssets = assets.filter((a) => a.category !== 'highlight');
  const shown = filterAssets(decorationAssets, category, query);

  return (
    <div
      role="dialog"
      aria-label="Decorations"
      data-tour="decoration-tray"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: 'var(--plaster)', borderTop: '1px solid var(--pale-stone)',
        boxShadow: '0 -8px 22px rgba(0,0,0,.12)', padding: '8px 10px', zIndex: 70,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
        <input
          aria-label="Search decorations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid var(--pale-stone)', borderRadius: 6 }}
        />
        <button aria-label="Close decorations" onClick={onClose}
          style={{ fontSize: 12, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--silica)' }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, overflowX: 'auto' }}>
        {PILLS.map((p) => (
          <button
            key={p.value}
            onClick={() => setCategory(p.value)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', cursor: 'pointer',
              border: 'none',
              background: category === p.value ? 'var(--deep-umber)' : 'transparent',
              color: category === p.value ? '#fff' : 'var(--silica)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {shown.map((a) => (
          <button
            key={a.id}
            aria-label={`Place ${a.id}`}
            onClick={() => onPlace(a.id)}
            style={{ flex: '0 0 auto', width: 56, height: 56, border: '1px solid var(--pale-stone)', borderRadius: 8, background: '#fff', cursor: 'pointer', padding: 4 }}
          >
            <img src={a.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
