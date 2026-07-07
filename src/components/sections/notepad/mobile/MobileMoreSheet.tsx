// src/components/sections/notepad/mobile/MobileMoreSheet.tsx
import { useEffect, useMemo, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { BacklinksPanel } from '../../../../notepad/components/BacklinksPanel';
import { InfoPanel } from '../../../../notepad/components/InfoPanel';
import { GraphPane } from '../GraphPane';
import { NodePeek } from './NodePeek';
import { buildPeekData, type PeekTarget } from './node-peek-data';
import { useNoteCollection } from '../../../../notepad/context/useNoteCollection';
import { useReferenceGraph } from '../../../../notepad/context/useReferenceGraph';
import { useOnlineStatus } from '../../../../notepad/hooks/useOnlineStatus';
import { Segmented } from './Segmented';

type DetailSegment = 'backlinks' | 'info' | 'graph';

export interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}

export function MobileMoreSheet({ open, onClose, onOpenNote }: MobileMoreSheetProps) {
  const [segment, setSegment] = useState<DetailSegment>('backlinks');
  const [peeked, setPeeked] = useState<PeekTarget | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  const { notes } = useNoteCollection();
  const { graph } = useReferenceGraph();
  const peekData = useMemo(
    () => (peeked ? buildPeekData(peeked, notes, graph) : null),
    [peeked, notes, graph],
  );

  // Reset peek AND focus when the sheet closes, so a reopened sheet starts on a
  // clean global graph rather than a stale peek or local-focus from last time.
  useEffect(() => {
    if (!open) {
      setPeeked(null);
      setFocusId(null);
    }
  }, [open]);

  const handleSegment = (next: DetailSegment) => {
    setPeeked(null);
    setSegment(next);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ fontFamily: 'Outfit, sans-serif' }}>
      <button
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      />
      <div
        className="relative rounded-t-2xl flex flex-col"
        style={{
          background: 'var(--notepad-page-bg)',
          maxHeight: '80vh',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -8px 28px rgba(0,0,0,0.18)',
        }}
      >
        <div className="flex justify-center pt-2">
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--pale-stone)' }} />
        </div>

        <div className="px-4 pt-3 pb-2">
          <Segmented<DetailSegment>
            options={[
              { value: 'backlinks', label: 'Backlinks' },
              { value: 'info', label: 'Info' },
              { value: 'graph', label: 'Graph' },
            ]}
            value={segment}
            onChange={handleSegment}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {segment === 'backlinks' && <BacklinksPanel />}
          {segment === 'info' && <InfoPanel />}
          {segment === 'graph' && (
            peekData ? (
              <NodePeek
                data={peekData}
                onBack={() => setPeeked(null)}
                onOpenInEditor={(id) => { onOpenNote(id); onClose(); }}
                onFocus={(id) => { setFocusId(id); setPeeked(null); }}
                onPeekNote={(id) => setPeeked({ id, kind: 'note' })}
              />
            ) : (
              <div data-tour="more-sheet-graph" className="h-full min-h-0">
                <GraphPane
                  graphOpen
                  embedded
                  focusNodeId={focusId}
                  expanded={false}
                  onToggleExpand={() => {}}
                  onNodePeek={(n) => setPeeked({ id: n.id, kind: n.type === 'scripture' ? 'scripture' : 'note' })}
                />
              </div>
            )
          )}
        </div>

        <footer
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-[11px]"
          style={{ borderTop: '1px solid var(--pale-stone)', color: 'var(--silica)' }}
        >
          {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          {isOnline ? 'Synced' : 'Offline — changes saved locally'}
        </footer>
      </div>
    </div>
  );
}
