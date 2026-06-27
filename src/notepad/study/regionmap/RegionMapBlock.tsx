import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useRegionMap } from './useRegionMap';
import { RegionMapView } from './RegionMapView';
import { RegionMapFullscreen } from './RegionMapFullscreen';
import type { MapTab } from './region-maps';

export interface RegionMapBlockProps {
  book: string;
}

export function RegionMapBlock({ book }: RegionMapBlockProps) {
  const map = useRegionMap(book);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<MapTab>('then');
  const [fullscreen, setFullscreen] = useState(false);

  if (!map) return null;

  return (
    <section style={{ marginBottom: 24, borderTop: '1px solid var(--pale-stone)', paddingTop: 16 }}>
      <button
        type="button"
        onClick={() => setExpanded((o) => !o)}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />
          : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />}
        <span style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--silica)' }}>Map of the region</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 10, border: '1px solid var(--pale-stone)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <RegionMapView
            map={map}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onExpand={() => setFullscreen(true)}
          />
        </div>
      )}

      {fullscreen && (
        <RegionMapFullscreen
          map={map}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={() => setFullscreen(false)}
        />
      )}
    </section>
  );
}
