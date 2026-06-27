import { useEffect, useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { MapImage } from './region-maps';

// Type-only import is erased at build → does not pull the lib into the bundle.
type RZPPModule = typeof import('react-zoom-pan-pinch');

export interface ZoomableMapProps {
  image: MapImage;
  height: number | string;
  overlayTopRight?: React.ReactNode;
}

const zoomBtn: React.CSSProperties = {
  width: 28, height: 28, background: '#fff', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--deep-umber)',
};

export function ZoomableMap({ image, height, overlayTopRight }: ZoomableMapProps) {
  const reduced = usePrefersReducedMotion();
  const [rzpp, setRzpp] = useState<RZPPModule | null>(null);
  const [failed, setFailed] = useState(false);

  // Lazy-load react-zoom-pan-pinch only when a map is actually shown.
  useEffect(() => {
    let active = true;
    import('react-zoom-pan-pinch').then((m) => { if (active) setRzpp(m); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Reset the load-failure flag when the image changes (e.g. switching the era
  // tab and back) so a previously-failed image never keeps the fallback showing
  // over a different, working image.
  useEffect(() => { setFailed(false); }, [image.src]);

  const img = (
    <img
      src={image.src}
      alt={image.alt}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );

  return (
    <div style={{ position: 'relative', height, background: 'var(--pale-stone)', overflow: 'hidden' }}>
      {failed ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--silica)', fontStyle: 'italic' }}>
          Map image unavailable.
        </div>
      ) : rzpp ? (
        <rzpp.TransformWrapper
          initialScale={1}
          minScale={1}
          maxScale={5}
          doubleClick={{ animationTime: reduced ? 0 : 200 }}
          wheel={{ step: 0.2 }}
        >
          {({ zoomIn, zoomOut }) => (
            <>
              <rzpp.TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
                {img}
              </rzpp.TransformComponent>
              <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.25)', zIndex: 2 }}>
                <button type="button" aria-label="Zoom in" onClick={() => zoomIn(undefined, reduced ? 0 : 200)} style={zoomBtn}><Plus className="w-4 h-4" /></button>
                <button type="button" aria-label="Zoom out" onClick={() => zoomOut(undefined, reduced ? 0 : 200)} style={{ ...zoomBtn, borderTop: '1px solid #eee' }}><Minus className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </rzpp.TransformWrapper>
      ) : (
        img
      )}
      {overlayTopRight && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>{overlayTopRight}</div>
      )}
    </div>
  );
}
