import { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { localAdapter } from '../storage/local-storage';
import { useMigrationWorkflow } from '../storage/useMigrationWorkflow';
import type { MigrationWorkflowState } from '../storage/migration-workflow';
import type { StorageAdapter } from '../storage/adapter';

const PREVIEW_LIMIT = 3;

interface MigrationDialogProps {
  open: boolean;
  onClose: () => void;
  targetAdapter: StorageAdapter;
  onMigrationComplete: () => void;
}

const phaseMessage = (s: MigrationWorkflowState): string => {
  switch (s.status) {
    case 'idle':    return '';
    case 'loading': return 'Reading your local notes…';
    case 'folders': return s.total === 1
      ? 'Syncing your folder…'
      : `Syncing folder ${s.current} of ${s.total}…`;
    case 'notes':   return s.total === 1
      ? 'Importing your note…'
      : `Importing note ${s.current} of ${s.total}…`;
    case 'cleanup': return 'Almost done — tidying up…';
    case 'done':    return 'All set. Your notes are now in your account.';
    case 'error':   return s.message;
  }
};

const isInProgress = (s: MigrationWorkflowState): boolean =>
  s.status === 'loading' ||
  s.status === 'folders' ||
  s.status === 'notes' ||
  s.status === 'cleanup';

export function MigrationDialog({
  open,
  onClose,
  targetAdapter,
  onMigrationComplete,
}: MigrationDialogProps) {
  const { state, start, dismissError } = useMigrationWorkflow({
    target: targetAdapter,
    onMigrationComplete,
    onClose,
  });
  const [titles, setTitles] = useState<string[]>([]);

  // Read local note titles when the dialog opens. Source-side ownership stays
  // inside LocalStorageAdapter — the dialog never touches storage keys.
  useEffect(() => {
    if (!open) return;
    localAdapter.getNotes().then((notes) =>
      setTitles(notes.map((n) => n.title.trim() || 'Untitled note')),
    );
  }, [open]);

  const total = titles.length;

  const inProgress = isInProgress(state);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !inProgress) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-sm p-8"
        style={{
          background: 'var(--alabaster)',
          border: '1px solid var(--pale-stone)',
        }}
      >
        {inProgress || state.status === 'done' ? (
          <div className="flex flex-col items-center gap-4 py-2">
            {state.status === 'done' ? (
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ border: '1.5px solid var(--deep-umber)' }}
              >
                <Check className="w-5 h-5" style={{ color: 'var(--deep-umber)' }} strokeWidth={2} />
              </div>
            ) : (
              <Loader2
                className="w-11 h-11 animate-spin"
                style={{ color: 'var(--deep-umber)' }}
                strokeWidth={1.25}
              />
            )}

            <DialogTitle
              className="text-base font-medium text-center"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              {state.status === 'done' ? 'Done' : 'Importing your notes'}
            </DialogTitle>

            <DialogDescription
              className="text-center text-xs px-2"
              style={{
                color: 'var(--silica)',
                fontFamily: 'Outfit, sans-serif',
                minHeight: '2.4em',
                lineHeight: 1.5,
              }}
            >
              {phaseMessage(state)}
            </DialogDescription>

            {(state.status === 'folders' || state.status === 'notes') && (
              <div
                className="w-full h-1 rounded-full overflow-hidden"
                style={{ background: 'var(--pale-stone)' }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    background: 'var(--deep-umber)',
                    width: `${(state.current / Math.max(state.total, 1)) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        ) : state.status === 'error' ? (
          <>
            <DialogTitle
              className="text-lg font-medium text-center"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              Something went wrong
            </DialogTitle>
            <DialogDescription
              className="text-center text-sm mt-2"
              style={{
                color: 'var(--silica)',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              {state.message}
            </DialogDescription>
            <div className="flex gap-3 mt-6">
              <button
                onClick={dismissError}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  border: '1px solid var(--pale-stone)',
                  color: 'var(--deep-umber)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Close
              </button>
              <button
                onClick={start}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity"
                style={{
                  background: 'var(--deep-umber)',
                  color: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogTitle
              className="text-lg font-medium text-center"
              style={{
                color: 'var(--deep-umber)',
                fontFamily: 'Cormorant Garamond, serif',
              }}
            >
              {total === 1 ? 'Import this note?' : `Import these ${total} notes?`}
            </DialogTitle>

            <ul className="mt-3 flex flex-col gap-1.5">
              {titles.slice(0, PREVIEW_LIMIT).map((t, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                >
                  <span aria-hidden style={{ color: 'var(--silica)' }}>•</span>
                  <span className="truncate">{t}</span>
                </li>
              ))}
              {total > PREVIEW_LIMIT && (
                <li
                  className="text-sm pl-4"
                  style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                >
                  …and {total - PREVIEW_LIMIT} more
                </li>
              )}
            </ul>

            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  border: '1px solid var(--pale-stone)',
                  color: 'var(--deep-umber)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                No
              </button>
              <button
                onClick={start}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium transition-opacity"
                style={{
                  background: 'var(--deep-umber)',
                  color: 'var(--plaster)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                Import Notes
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
