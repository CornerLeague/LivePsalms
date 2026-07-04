// src/notepad/recordings/RecordingsDock.tsx
// Docked recorder/playback bar (spec §3). Renders null when idle — mounted as
// a shrink-0 flex footer in each workspace (desktop <main>; mobile above
// MobileTabBar), so visible content shrinks instead of being covered.
import { Loader2, Pause, Play, RotateCcw, RotateCw, Square, X } from 'lucide-react';
import { useRecordingsAudio } from './audio-context';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const barStyle: React.CSSProperties = {
  borderTop: '1px solid var(--pale-stone)',
  background: 'var(--notepad-bar-bg)',
  fontFamily: 'Outfit, sans-serif',
  color: 'var(--deep-umber)',
};

function IconButton({
  label, onClick, children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded hover:bg-black/5 dark:hover:bg-white/10"
      style={{ color: 'var(--deep-umber)' }}
    >
      {children}
    </button>
  );
}

export function RecordingsDock({
  variant, onOpenNote,
}: { variant: 'desktop' | 'mobile'; onOpenNote?: (noteId: string) => void }) {
  const {
    mode, recorder, track, positionSec, speed,
    pauseRecording, resumeRecording, stopRecording, cancelRecording,
    retryUpload, discardRecording,
    togglePlayback, seekTo, skipBy, setSpeed, closeDock,
  } = useRecordingsAudio();

  if (mode === 'recording' && recorder) {
    const paused = recorder.status === 'rec-paused';
    return (
      <div data-testid="recordings-dock" className="shrink-0 flex items-center gap-3 px-4 py-2" style={barStyle}>
        <span
          aria-hidden
          className={`w-2 h-2 rounded-full ${paused ? '' : 'animate-pulse'}`}
          style={{ background: '#c0392b' }}
        />
        <span className="text-[12px] tabular-nums">{formatClock(recorder.elapsedSec)}</span>
        <span className="text-[11px]" style={{ color: 'var(--silica)' }}>
          {paused ? 'Paused' : 'Recording…'}
        </span>
        <div className="flex-1" />
        {paused ? (
          <IconButton label="Resume recording" onClick={resumeRecording}><Play size={15} /></IconButton>
        ) : (
          <IconButton label="Pause recording" onClick={pauseRecording}><Pause size={15} /></IconButton>
        )}
        <IconButton label="Save recording" onClick={stopRecording}><Square size={15} /></IconButton>
        <IconButton label="Discard recording" onClick={cancelRecording}><X size={15} /></IconButton>
      </div>
    );
  }

  // Always-reachable uploading/failed surface (spec: note-agnostic). The strip's
  // pending chip only shows on the OWNING note, so a session started in note A is
  // UI-unreachable if the user returns to a different active note, note A was
  // deleted, or there is no active note. The dock renders app-wide, so this
  // branch guarantees a pending/failed upload is always visible + recoverable.
  // Active playback takes precedence (checked first) so we never hide the player.
  const pending =
    !track && recorder && (recorder.status === 'uploading' || recorder.status === 'failed')
      ? recorder
      : null;
  if (pending) {
    const openNote = onOpenNote && (
      <button
        type="button"
        aria-label="Open note"
        onClick={() => onOpenNote(pending.noteId)}
        className="text-[11px] underline underline-offset-2 shrink-0"
        style={{ color: 'var(--silica)' }}
      >
        Open note
      </button>
    );
    return (
      <div
        data-testid="recordings-dock"
        className={`shrink-0 flex items-center gap-3 ${variant === 'mobile' ? 'px-3' : 'px-4'} py-2`}
        style={barStyle}
      >
        {pending.status === 'uploading' ? (
          <>
            <Loader2 aria-hidden size={15} className="animate-spin" />
            <span className="text-[12px]">Uploading recording…</span>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
              {Math.round(pending.uploadProgress * 100)}%
            </span>
            <div className="flex-1" />
            {openNote}
          </>
        ) : (
          <>
            <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: '#c0392b' }} />
            <span className="text-[12px]" style={{ color: '#c0392b' }}>Upload failed</span>
            <div className="flex-1" />
            {openNote}
            <button
              type="button"
              aria-label="Retry upload"
              onClick={retryUpload}
              className="text-[11px] underline underline-offset-2 shrink-0"
              style={{ color: 'var(--deep-umber)' }}
            >
              Retry
            </button>
            <button
              type="button"
              aria-label="Discard failed recording"
              onClick={discardRecording}
              className="text-[11px] underline underline-offset-2 shrink-0"
              style={{ color: 'var(--silica)' }}
            >
              Discard
            </button>
          </>
        )}
      </div>
    );
  }

  if (!track || (mode !== 'playing' && mode !== 'paused')) return null;

  const nextSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const scrubber = (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
        {formatClock(positionSec)}
      </span>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={track.durationSeconds}
        step={1}
        value={Math.min(positionSec, track.durationSeconds)}
        onChange={(e) => seekTo(Number(e.target.value))}
        className="flex-1 min-w-0 accent-[var(--deep-umber)]"
      />
      <span className="text-[11px] tabular-nums" style={{ color: 'var(--silica)' }}>
        {formatClock(track.durationSeconds)}
      </span>
    </div>
  );

  const controls = (
    <div className="flex items-center gap-1">
      <IconButton label="Back 15 seconds" onClick={() => skipBy(-15)}><RotateCcw size={15} /></IconButton>
      {mode === 'playing' ? (
        <IconButton label="Pause" onClick={togglePlayback}><Pause size={16} /></IconButton>
      ) : (
        <IconButton label="Play" onClick={togglePlayback}><Play size={16} /></IconButton>
      )}
      <IconButton label="Forward 15 seconds" onClick={() => skipBy(15)}><RotateCw size={15} /></IconButton>
      <button
        type="button"
        aria-label="Playback speed"
        onClick={nextSpeed}
        className="px-1.5 h-8 rounded text-[11px] tabular-nums hover:bg-black/5 dark:hover:bg-white/10"
        style={{ color: 'var(--deep-umber)' }}
      >
        {speed}×
      </button>
      <IconButton label="Close player" onClick={closeDock}><X size={15} /></IconButton>
    </div>
  );

  const title = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[12px] truncate">{track.label}</span>
      {onOpenNote && (
        <button
          type="button"
          aria-label="Go to note"
          onClick={() => onOpenNote(track.noteId)}
          className="text-[11px] underline underline-offset-2 shrink-0"
          style={{ color: 'var(--silica)' }}
        >
          Open note
        </button>
      )}
    </div>
  );

  if (variant === 'mobile') {
    return (
      <div data-testid="recordings-dock" className="shrink-0 flex flex-col gap-1 px-3 py-2" style={barStyle}>
        {scrubber}
        <div className="flex items-center justify-between gap-2">
          {title}
          {controls}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="recordings-dock" className="shrink-0 flex items-center gap-4 px-4 py-2" style={barStyle}>
      <div className="w-56 shrink-0">{title}</div>
      {scrubber}
      {controls}
    </div>
  );
}
