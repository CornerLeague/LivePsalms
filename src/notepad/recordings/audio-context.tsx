// src/notepad/recordings/audio-context.tsx
// Global audio state for voice recordings: one provider owns BOTH the
// MediaRecorder session and the single Audio() playback instance, so
// record/play exclusivity is structural (spec §3). Pure reducer exported for
// tests (tree-view-state.tsx precedent); hook throws outside the provider
// (bible-prefs-context.ts precedent).
import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
  type ReactNode,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { useAuthSession } from '@/auth/context/useAuthSession';
import {
  MAX_RECORDING_SECONDS, signedRecordingUrl, uploadRecording,
  type NoteRecording,
} from './recordings-client';

export type AudioMode = 'idle' | 'recording' | 'playing' | 'paused';
export type RecorderStatus = 'recording' | 'rec-paused' | 'uploading' | 'failed';

export interface RecorderSession {
  noteId: string;
  status: RecorderStatus;
  elapsedSec: number;
  uploadProgress: number; // 0..1
  error: string | null;
  mimeType: string;
}

export interface PlaybackTrack {
  recordingId: string;
  noteId: string;
  label: string;
  durationSeconds: number;
  storagePath: string;
}

export interface AudioState {
  mode: AudioMode;
  recorder: RecorderSession | null;
  track: PlaybackTrack | null;
  positionSec: number;
  speed: number;
  savedVersion: number; // bumped on successful upload → strips refetch
}

export type AudioAction =
  | { type: 'RECORD_START'; noteId: string; mimeType: string }
  | { type: 'RECORD_TICK'; seconds: number }
  | { type: 'RECORD_PAUSE' }
  | { type: 'RECORD_RESUME' }
  | { type: 'RECORD_STOP' }
  | { type: 'UPLOAD_PROGRESS'; progress: number }
  | { type: 'UPLOAD_DONE' }
  | { type: 'UPLOAD_FAILED'; error: string }
  | { type: 'RECORDER_CLEAR' }
  | { type: 'PLAY_TRACK'; track: PlaybackTrack }
  | { type: 'PLAYBACK_PLAYING' }
  | { type: 'PLAYBACK_PAUSED' }
  | { type: 'POSITION'; seconds: number }
  | { type: 'SPEED'; speed: number }
  | { type: 'CLOSE' };

export const initialAudioState: AudioState = {
  mode: 'idle', recorder: null, track: null, positionSec: 0, speed: 1, savedVersion: 0,
};

export function audioReducer(state: AudioState, action: AudioAction): AudioState {
  switch (action.type) {
    case 'RECORD_START':
      // One recorder slot: a pending (uploading/failed) session must be
      // resolved via Retry/Discard before a new capture starts.
      if (state.recorder) return state;
      return {
        ...state,
        mode: 'recording',
        track: null,
        positionSec: 0,
        recorder: {
          noteId: action.noteId, status: 'recording', elapsedSec: 0,
          uploadProgress: 0, error: null, mimeType: action.mimeType,
        },
      };
    case 'RECORD_TICK':
      if (state.recorder?.status !== 'recording') return state;
      return {
        ...state,
        recorder: { ...state.recorder, elapsedSec: state.recorder.elapsedSec + action.seconds },
      };
    case 'RECORD_PAUSE':
      if (state.recorder?.status !== 'recording') return state;
      return { ...state, recorder: { ...state.recorder, status: 'rec-paused' } };
    case 'RECORD_RESUME':
      if (state.recorder?.status !== 'rec-paused') return state;
      return { ...state, recorder: { ...state.recorder, status: 'recording' } };
    case 'RECORD_STOP':
      if (!state.recorder) return state;
      return {
        ...state,
        mode: 'idle',
        recorder: { ...state.recorder, status: 'uploading', uploadProgress: 0 },
      };
    case 'UPLOAD_PROGRESS':
      if (state.recorder?.status !== 'uploading') return state;
      return { ...state, recorder: { ...state.recorder, uploadProgress: action.progress } };
    case 'UPLOAD_DONE':
      return { ...state, recorder: null, savedVersion: state.savedVersion + 1 };
    case 'UPLOAD_FAILED':
      if (!state.recorder) return state;
      return { ...state, recorder: { ...state.recorder, status: 'failed', error: action.error } };
    case 'RECORDER_CLEAR':
      return { ...state, recorder: null, mode: state.mode === 'recording' ? 'idle' : state.mode };
    case 'PLAY_TRACK':
      if (state.mode === 'recording') return state; // chips are inert while recording
      return { ...state, mode: 'playing', track: action.track, positionSec: 0 };
    case 'PLAYBACK_PLAYING':
      if (!state.track) return state;
      return { ...state, mode: 'playing' };
    case 'PLAYBACK_PAUSED':
      if (!state.track) return state;
      return { ...state, mode: 'paused' };
    case 'POSITION':
      return { ...state, positionSec: action.seconds };
    case 'SPEED':
      return { ...state, speed: action.speed };
    case 'CLOSE':
      return { ...state, mode: 'idle', track: null, positionSec: 0 };
    default:
      return state;
  }
}

/** Chip/dock display label: title, or a date like "Jul 3, 2026" (spec §4). */
export function recordingLabel(rec: Pick<NoteRecording, 'title' | 'createdAt'>): string {
  if (rec.title.trim()) return rec.title;
  return new Date(rec.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export interface RecordingsAudioValue extends AudioState {
  startRecording(noteId: string): Promise<'ok' | 'permission-denied' | 'busy'>;
  pauseRecording(): void;
  resumeRecording(): void;
  stopRecording(): void;
  cancelRecording(): void;
  retryUpload(): void;
  discardRecording(): void;
  playRecording(rec: NoteRecording): Promise<void>;
  togglePlayback(): void;
  seekTo(sec: number): void;
  skipBy(deltaSec: number): void;
  setSpeed(speed: number): void;
  closeDock(): void;
  stopIfCurrent(recordingId: string): void;
}

const RecordingsAudioContext = createContext<RecordingsAudioValue | null>(null);

export function useRecordingsAudio(): RecordingsAudioValue {
  const ctx = useContext(RecordingsAudioContext);
  if (!ctx) throw new Error('useRecordingsAudio must be used within RecordingsAudioProvider');
  return ctx;
}

export function RecordingsAudioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const [state, dispatch] = useReducer(audioReducer, initialAudioState);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  // Pending upload payload — survives navigation for Retry (spec §2).
  const pendingRef = useRef<{
    userId: string; noteId: string; recordingId: string; blob: Blob;
    mimeType: string; durationSeconds: number;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRetriedRef = useRef(false);
  const stateRef = useRef(state);
  // Refs must not be written during render (react-hooks/refs); commit the
  // latest state to the ref right after render instead. Callbacks below only
  // read stateRef.current when invoked later, never during this render, so
  // the one-render lag before the effect runs is not observable.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const runUpload = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    uploadRecording(pending, (fraction) =>
      dispatch({ type: 'UPLOAD_PROGRESS', progress: fraction }),
    )
      .then(() => {
        pendingRef.current = null;
        dispatch({ type: 'UPLOAD_DONE' });
      })
      .catch((err: unknown) => {
        dispatch({ type: 'UPLOAD_FAILED', error: err instanceof Error ? err.message : 'upload failed' });
        toast.error('Recording upload failed — retry from the note.');
      });
  }, []);

  const teardownCapture = useCallback(() => {
    clearTick();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const startRecording = useCallback(
    async (noteId: string): Promise<'ok' | 'permission-denied' | 'busy'> => {
      if (!user || stateRef.current.recorder) return 'busy';
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return 'permission-denied';
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'; // Safari
      const container = mimeType.startsWith('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const wasCancelled = cancelledRef.current;
        const elapsed = stateRef.current.recorder?.elapsedSec ?? 0;
        teardownCapture();
        if (wasCancelled) {
          chunksRef.current = [];
          dispatch({ type: 'RECORDER_CLEAR' });
          return;
        }
        const blob = new Blob(chunksRef.current, { type: container });
        chunksRef.current = [];
        pendingRef.current = {
          userId: user.id, noteId, recordingId: uuidv4(), blob,
          mimeType: container, durationSeconds: elapsed,
        };
        dispatch({ type: 'RECORD_STOP' });
        runUpload();
      };
      // Mic unplugged etc: salvage the chunks collected so far (spec §2) —
      // onstop fires next and routes them into the normal upload path.
      recorder.onerror = () => {
        toast.error('Recording interrupted — saving what was captured.');
        if (recorder.state !== 'inactive') recorder.stop();
      };

      recorder.start(1000); // timeslice: chunks accumulate in memory
      dispatch({ type: 'RECORD_START', noteId, mimeType: container });
      tickRef.current = setInterval(() => dispatch({ type: 'RECORD_TICK', seconds: 1 }), 1000);
      return 'ok';
    },
    [user, runUpload, teardownCapture],
  );

  const pauseRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === 'recording') {
      r.pause();
      dispatch({ type: 'RECORD_PAUSE' });
    }
  }, []);

  const resumeRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r?.state === 'paused') {
      r.resume();
      dispatch({ type: 'RECORD_RESUME' });
    }
  }, []);

  const stopRecording = useCallback(() => {
    const r = mediaRecorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    const r = mediaRecorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const retryUpload = useCallback(() => {
    if (stateRef.current.recorder?.status !== 'failed') return;
    dispatch({ type: 'RECORD_STOP' }); // back to uploading
    runUpload();
  }, [runUpload]);

  const discardRecording = useCallback(() => {
    pendingRef.current = null;
    dispatch({ type: 'RECORDER_CLEAR' });
  }, []);

  // 30-minute cap: auto-stop SAVES, never discards (spec §2).
  useEffect(() => {
    if (state.recorder?.status === 'recording' && state.recorder.elapsedSec >= MAX_RECORDING_SECONDS) {
      toast('Recording reached the 30-minute limit and was saved.');
      stopRecording();
    }
  }, [state.recorder?.status, state.recorder?.elapsedSec, stopRecording]);

  // ── Playback ────────────────────────────────────────────────────────
  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.addEventListener('timeupdate', () =>
      dispatch({ type: 'POSITION', seconds: audio.currentTime }),
    );
    // Ends → stay paused-at-end so replay is allowed (spec §3).
    audio.addEventListener('ended', () => dispatch({ type: 'PLAYBACK_PAUSED' }));
    audio.addEventListener('error', () => {
      const track = stateRef.current.track;
      if (!track) return;
      if (urlRetriedRef.current) {
        toast.error('Could not play this recording.');
        dispatch({ type: 'CLOSE' });
        return;
      }
      urlRetriedRef.current = true;
      const resumeAt = stateRef.current.positionSec;
      void signedRecordingUrl(track.storagePath).then((url) => {
        if (!url) return;
        audio.src = url;
        audio.currentTime = resumeAt;
        void audio.play();
      });
    });
    audioRef.current = audio;
    return audio;
  }, []);

  const playRecording = useCallback(
    async (rec: NoteRecording) => {
      if (stateRef.current.mode === 'recording') return; // exclusivity
      const url = await signedRecordingUrl(rec.storagePath);
      if (!url) {
        toast.error('Could not load this recording.');
        return;
      }
      const audio = ensureAudio();
      urlRetriedRef.current = false;
      audio.src = url;
      audio.playbackRate = stateRef.current.speed;
      audio.currentTime = 0;
      dispatch({
        type: 'PLAY_TRACK',
        track: {
          recordingId: rec.id, noteId: rec.noteId, label: recordingLabel(rec),
          durationSeconds: rec.durationSeconds, storagePath: rec.storagePath,
        },
      });
      void audio.play();
    },
    [ensureAudio],
  );

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !stateRef.current.track) return;
    if (stateRef.current.mode === 'playing') {
      audio.pause();
      dispatch({ type: 'PLAYBACK_PAUSED' });
    } else {
      void audio.play();
      dispatch({ type: 'PLAYBACK_PLAYING' });
    }
  }, []);

  const seekTo = useCallback((sec: number) => {
    const audio = audioRef.current;
    const track = stateRef.current.track;
    if (!audio || !track) return;
    const clamped = Math.min(Math.max(sec, 0), track.durationSeconds);
    audio.currentTime = clamped;
    dispatch({ type: 'POSITION', seconds: clamped });
  }, []);

  const skipBy = useCallback(
    (deltaSec: number) => seekTo(stateRef.current.positionSec + deltaSec),
    [seekTo],
  );

  const setSpeed = useCallback((speed: number) => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    dispatch({ type: 'SPEED', speed });
  }, []);

  const closeDock = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.src = '';
    dispatch({ type: 'CLOSE' });
  }, []);

  const stopIfCurrent = useCallback(
    (recordingId: string) => {
      if (stateRef.current.track?.recordingId === recordingId) closeDock();
    },
    [closeDock],
  );

  // Native leave-confirmation while capturing or upload-pending (spec §2).
  const captureActive =
    state.mode === 'recording' ||
    state.recorder?.status === 'uploading' ||
    state.recorder?.status === 'failed';
  useEffect(() => {
    if (!captureActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [captureActive]);

  const value = useMemo<RecordingsAudioValue>(
    () => ({
      ...state,
      startRecording, pauseRecording, resumeRecording, stopRecording, cancelRecording,
      retryUpload, discardRecording, playRecording, togglePlayback,
      seekTo, skipBy, setSpeed, closeDock, stopIfCurrent,
    }),
    [
      state, startRecording, pauseRecording, resumeRecording, stopRecording,
      cancelRecording, retryUpload, discardRecording, playRecording,
      togglePlayback, seekTo, skipBy, setSpeed, closeDock, stopIfCurrent,
    ],
  );

  return (
    <RecordingsAudioContext.Provider value={value}>{children}</RecordingsAudioContext.Provider>
  );
}
