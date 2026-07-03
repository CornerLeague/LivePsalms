// src/notepad/recordings/RecordingsStrip.tsx
// Chips strip under the note title (spec §4). Satellite data — never touches
// the TipTap document. Signed-out users get a muted nudge (repo precedent:
// LamplightMobileView's plain sign-in line).
import { useState } from 'react';
import { Loader2, Mic, MoreVertical, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthSession } from '@/auth/context/useAuthSession';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { recordingLabel, useRecordingsAudio } from './audio-context';
import { deleteRecording, renameRecording, type NoteRecording } from './recordings-client';
import { useNoteRecordings } from './useNoteRecordings';
import { formatClock } from './RecordingsDock';

const outfit = { fontFamily: 'Outfit, sans-serif' } as const;

const chipStyle: React.CSSProperties = {
  ...outfit,
  border: '1px solid var(--pale-stone)',
  background: 'color-mix(in srgb, var(--warm-sand) 12%, transparent)',
  color: 'var(--deep-umber)',
  borderRadius: 999,
};

function Chip({
  rec, inert, onRenamed, onDeleted,
}: {
  rec: NoteRecording;
  inert: boolean;
  onRenamed: (id: string, title: string) => void;
  onDeleted: (id: string) => void;
}) {
  const { track, mode, playRecording, stopIfCurrent } = useRecordingsAudio();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isPlaying = track?.recordingId === rec.id && mode === 'playing';

  const commitRename = async () => {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === rec.title) return;
    try {
      await renameRecording(rec.id, title);
      onRenamed(rec.id, title);
    } catch {
      toast.error('Could not rename the recording.');
    }
  };

  const confirmDelete = async () => {
    stopIfCurrent(rec.id); // playing? stop + close dock first (spec §4)
    try {
      await deleteRecording(rec);
      onDeleted(rec.id);
    } catch {
      toast.error('Could not delete the recording.');
    }
  };

  return (
    <span data-testid="recording-chip" className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1" style={chipStyle}>
      {renaming ? (
        <input
          aria-label="Recording title"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={() => setRenaming(false)}
          className="text-[11px] bg-transparent outline-none w-28"
          style={outfit}
        />
      ) : (
        <button
          type="button"
          disabled={inert}
          onClick={() => void playRecording(rec)}
          className="inline-flex items-center gap-1.5 disabled:opacity-50"
          style={outfit}
        >
          {isPlaying ? (
            <span aria-label="Playing" className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--deep-umber)' }} />
          ) : (
            <Play size={11} />
          )}
          <span className="text-[11px]">{recordingLabel(rec)}</span>
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
            {formatClock(rec.durationSeconds)}
          </span>
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Recording options"
            className="flex items-center justify-center w-5 h-5 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--silica)' }}
          >
            <MoreVertical size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={outfit}>
          <DropdownMenuItem onSelect={() => { setDraft(rec.title || ''); setRenaming(true); }}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => setDeleteOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={outfit}>
          <AlertDialogHeader>
            <AlertDialogTitle style={outfit}>Delete Recording</AlertDialogTitle>
            <AlertDialogDescription style={outfit}>
              Are you sure you want to delete "{recordingLabel(rec)}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={outfit}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} style={outfit}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

export function RecordingsStrip({ noteId }: { noteId: string }) {
  const { user } = useAuthSession();
  const audio = useRecordingsAudio();
  const { recordings, applyRename, applyDelete } = useNoteRecordings(noteId);
  const [micBlocked, setMicBlocked] = useState(false);

  if (!user) {
    return (
      <div className="flex items-center gap-1.5 text-[11px]" style={{ ...outfit, color: 'var(--silica)', marginBottom: '0.75rem' }}>
        <Mic size={12} />
        Sign in to record voice notes
      </div>
    );
  }

  const recordingHere = audio.mode === 'recording' && audio.recorder?.noteId === noteId;
  const chipsInert = audio.mode === 'recording'; // everywhere (spec §4)
  const pending =
    audio.recorder && audio.recorder.noteId === noteId &&
    (audio.recorder.status === 'uploading' || audio.recorder.status === 'failed')
      ? audio.recorder
      : null;

  const handleRecord = async () => {
    setMicBlocked(false);
    const result = await audio.startRecording(noteId);
    if (result === 'permission-denied') setMicBlocked(true);
    if (result === 'busy') toast('Finish or discard the pending recording first.');
  };

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div className="flex flex-wrap items-center gap-1.5">
        {recordings.map((rec) => (
          <Chip key={rec.id} rec={rec} inert={chipsInert} onRenamed={applyRename} onDeleted={applyDelete} />
        ))}

        {pending && (
          <span data-testid="recording-chip" className="inline-flex items-center gap-1.5 px-2.5 py-1" style={chipStyle}>
            {pending.status === 'uploading' ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                <span className="text-[11px]">Uploading… {Math.round(pending.uploadProgress * 100)}%</span>
              </>
            ) : (
              <>
                <span className="text-[11px]" style={{ color: '#c0392b' }}>Upload failed</span>
                <button type="button" aria-label="Retry upload" onClick={audio.retryUpload} className="text-[11px] underline underline-offset-2" style={outfit}>
                  Retry
                </button>
                <button type="button" aria-label="Discard failed recording" onClick={audio.discardRecording} className="text-[11px] underline underline-offset-2" style={{ ...outfit, color: 'var(--silica)' }}>
                  Discard
                </button>
              </>
            )}
          </span>
        )}

        {recordingHere ? (
          <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ ...outfit, color: '#c0392b' }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#c0392b' }} />
            Recording…
          </span>
        ) : (
          <button
            type="button"
            aria-label="Record voice note"
            disabled={chipsInert}
            onClick={() => void handleRecord()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] disabled:opacity-50"
            style={chipStyle}
          >
            <Mic size={11} />
            Record
          </button>
        )}
      </div>

      {micBlocked && (
        <div className="text-[11px] mt-1" style={{ ...outfit, color: '#c0392b' }}>
          Microphone access is blocked — enable it in your browser settings
        </div>
      )}
    </div>
  );
}
