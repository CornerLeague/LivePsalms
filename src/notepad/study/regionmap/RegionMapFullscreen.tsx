import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { RegionMapView } from './RegionMapView';
import type { MapTab, RegionMap } from './region-maps';

export interface RegionMapFullscreenProps {
  map: RegionMap;
  activeTab: MapTab;
  onTabChange: (tab: MapTab) => void;
  onClose: () => void;
}

const closeBtn: React.CSSProperties = {
  width: 28, height: 28, marginLeft: 'auto', background: 'rgba(255,255,255,.15)', color: '#fff',
  border: 'none', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function RegionMapFullscreen({ map, activeTab, onTabChange, onClose }: RegionMapFullscreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Hold the latest onClose in a ref so the setup effect can run exactly once on
  // mount. Otherwise an inline onClose from the parent (a fresh identity every
  // render — e.g. switching the era tab in fullscreen) re-triggers this effect,
  // teleporting focus to the ✕ button and breaking keyboard tab navigation.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key === 'Tab') {
        const nodes = overlayRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
    // Runs once: setup/teardown is mount-scoped; onClose is read via onCloseRef.
  }, []);

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Map of ${map.label}`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#2a2620', display: 'flex', flexDirection: 'column' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <RegionMapView
        map={map}
        activeTab={activeTab}
        onTabChange={onTabChange}
        variant="fullscreen"
        trailing={
          <button ref={closeRef} type="button" aria-label="Close fullscreen map" onClick={onClose} style={closeBtn}>
            <X className="w-4 h-4" />
          </button>
        }
      />
    </div>,
    document.body,
  );
}
