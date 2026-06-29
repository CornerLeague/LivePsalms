import { useId } from 'react';
import { Maximize2 } from 'lucide-react';
import { ZoomableMap } from './ZoomableMap';
import type { MapTab, RegionMap } from './region-maps';

export interface RegionMapViewProps {
  map: RegionMap;
  activeTab: MapTab;
  onTabChange: (tab: MapTab) => void;
  onExpand?: () => void;          // inline → renders the ⤢ button over the map
  trailing?: React.ReactNode;     // fullscreen → ✕ at the end of the tab row
  variant?: 'inline' | 'fullscreen';
}

const TABS: { id: MapTab; label: string }[] = [
  { id: 'then', label: 'Biblical times' },
  { id: 'now', label: 'Today' },
];

const expandBtn: React.CSSProperties = {
  width: 26, height: 26, background: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--deep-umber)',
  boxShadow: '0 1px 3px rgba(0,0,0,.25)',
};

export function RegionMapView({ map, activeTab, onTabChange, onExpand, trailing, variant = 'inline' }: RegionMapViewProps) {
  const image = map[activeTab];
  const fullscreen = variant === 'fullscreen';
  const comingSoon = !!image.comingSoon;

  // Unique per instance so the inline + fullscreen views never collide on ids.
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const tabId = (t: MapTab) => `${baseId}-tab-${t}`;

  function onTabKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onTabChange(activeTab === 'then' ? 'now' : 'then');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: fullscreen ? '100%' : 'auto' }}>
      <div role="tablist" aria-label="Map era" style={{ display: 'flex', alignItems: 'stretch' }}>
        {TABS.map((t) => {
          const selected = t.id === activeTab;
          return (
            <button
              key={t.id}
              id={tabId(t.id)}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(t.id)}
              onKeyDown={onTabKeyDown}
              style={{
                flex: 1, textAlign: 'center', fontSize: 11, padding: 7, cursor: 'pointer', border: 'none',
                fontWeight: selected ? 600 : 400,
                background: selected ? 'var(--lamplight-accent)' : fullscreen ? 'rgba(255,255,255,.15)' : '#efe7d6',
                color: selected ? '#fff' : fullscreen ? '#e8e0d2' : 'var(--silica)',
              }}
            >
              {t.label}
            </button>
          );
        })}
        {trailing}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(activeTab)}
        // Focusable only when the panel has no focusable content of its own
        // (the coming-soon placeholder); the map view already has zoom buttons.
        tabIndex={comingSoon ? 0 : undefined}
        style={{ flex: fullscreen ? 1 : 'none', minHeight: 0 }}
      >
        {comingSoon ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16,
              height: fullscreen ? '100%' : 210,
              background: fullscreen ? 'rgba(255,255,255,.06)' : 'var(--pale-stone)',
              fontSize: 12, fontStyle: 'italic', color: fullscreen ? '#e8e0d2' : 'var(--silica)',
            }}
          >
            Maps for today are coming soon.
          </div>
        ) : (
          <ZoomableMap
            image={image}
            height={fullscreen ? '100%' : 210}
            overlayTopRight={!fullscreen && onExpand ? (
              <button type="button" aria-label="Expand map to fullscreen" onClick={onExpand} style={expandBtn}>
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            ) : undefined}
          />
        )}
      </div>

      {!comingSoon && (
        <div style={{ padding: fullscreen ? '10px 14px' : '8px 10px', background: fullscreen ? 'rgba(0,0,0,.55)' : 'transparent' }}>
          <div aria-live="polite" aria-atomic="true" style={{ fontSize: 11, fontStyle: 'italic', lineHeight: 1.5, color: fullscreen ? '#f4efe4' : '#5a4f3c' }}>{image.caption}</div>
          {!fullscreen && (
            <div style={{ fontSize: 9, color: '#a89f90', marginTop: 4 }}>{image.attribution} · {image.license}</div>
          )}
        </div>
      )}
    </div>
  );
}
