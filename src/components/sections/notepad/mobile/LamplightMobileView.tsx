// src/components/sections/notepad/mobile/LamplightMobileView.tsx
import { useState } from 'react';
import { LamplightTabPanel } from '../../../../notepad/components/lamplight/LamplightTabPanel';
import { ConnectionCardsPanel } from '../../../../notepad/components/lamplight/ConnectionCardsPanel';
import type { LamplightAdapter } from '../../../../notepad/storage/lamplight-adapter';
import type { Note } from '../../../../notepad/types';
import { Segmented } from './Segmented';

type LampSegment = 'today' | 'connections';

export interface LamplightMobileViewProps {
  lamplightAdapter: LamplightAdapter;
  userId: string | null;
  activeNote: Note | null;
  totalNoteCount: number;
  loadNeighborNotes: (ids: string[]) => Promise<Note[]>;
  onOpenNote: (id: string) => void;
}

export function LamplightMobileView({
  lamplightAdapter,
  userId,
  activeNote,
  totalNoteCount,
  loadNeighborNotes,
  onOpenNote,
}: LamplightMobileViewProps) {
  const [segment, setSegment] = useState<LampSegment>('today');

  return (
    <div className="lamplight-mobile-view flex flex-col h-full min-h-0" style={{ background: 'var(--alabaster)' }}>
      <div className="shrink-0 px-4 pt-3 pb-2">
        <Segmented<LampSegment>
          options={[
            { value: 'today', label: "Today's Lamp" },
            { value: 'connections', label: 'Connection Cards' },
          ]}
          value={segment}
          onChange={setSegment}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {segment === 'today' && (
          <LamplightTabPanel lamplightAdapter={lamplightAdapter} autoGenerate={false} />
        )}
        {segment === 'connections' &&
          (userId ? (
            <ConnectionCardsPanel
              adapter={lamplightAdapter}
              userId={userId}
              activeNote={activeNote}
              totalNoteCount={totalNoteCount}
              loadNeighborNotes={loadNeighborNotes}
              onOpenNote={onOpenNote}
              showEmptyStates
              layout="stack"
            />
          ) : (
            <div
              className="flex items-center justify-center min-h-[200px] text-xs"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              Sign in to see connections.
            </div>
          ))}
      </div>
    </div>
  );
}
