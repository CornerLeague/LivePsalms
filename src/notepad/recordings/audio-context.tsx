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
import { savePending, deletePending, loadPendingForUser } from './pending-store';

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
  | { type: 'RESTORE_PENDING'; noteId: string; mimeType: string; durationSeconds: number; error: string | null }
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
    case 'RESTORE_PENDING':
      // Rehydrate a durable pending row (survived reload/crash) as a FAILED
      // session so the dock surfaces Retry/Discard. No-op if a recorder slot is
      // already occupied — a live capture or an already-restored session must
      // never be clobbered (the effect also re-checks, but the reducer is the
      // authoritative guard).
      if (state.recorder) return state;
      return {
        ...state,
        recorder: {
          noteId: action.noteId,
          status: 'failed',
          elapsedSec: action.durationSeconds,
          uploadProgress: 0,
          error: action.error,
          mimeType: action.mimeType,
        },
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
  // Synchronous re-entrancy claim: stateRef.current.recorder only reflects a
  // session AFTER the RECORD_START dispatch completes, leaving the button
  // enabled through the whole getUserMedia latency window. This ref is set
  // synchronously before any await, so a second concurrent call is rejected
  // immediately instead of racing to create a second capture session.
  const acquiringRef = useRef(false);
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
  // Synchronous re-entrancy claim for uploads: stateRef.current.recorder only
  // flips to 'uploading' after the RECORD_STOP dispatch is committed, so a
  // double-clicked Retry (RecordingsStrip.tsx) could fire two concurrent
  // uploadRecording() on the same recordingId in the render-lag window. Mirrors
  // acquiringRef's claim-before-await idiom; cleared in BOTH .then and .catch.
  const uploadingRef = useRef(false);
  const stateRef = useRef(state);
  // The provider is now hoisted to the app root (App.tsx) and never unmounts on
  // navigation, so it persists across sign-out→sign-in (AuthSession flips `user`
  // in place via useSyncExternalStore, no remount). userRef gives the upload
  // callbacks the CURRENT user id without a stale closure, so a pending payload
  // from user A is never uploaded under user B's session (see the cross-user
  // effect below and the re-checks in runUpload/retryUpload).
  const userRef = useRef(user);
  // Refs must not be written during render (react-hooks/refs); commit the
  // latest state to the ref right after render instead. Callbacks below only
  // read stateRef.current when invoked later, never during this render, so
  // the one-render lag before the effect runs is not observable.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const clearTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const runUpload = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    // Defense in depth against a cross-user race: if the active user changed
    // (sign-out→sign-in) and the cross-user effect hasn't cleared this payload
    // yet, refuse to upload user A's audio into user B's session. Discard-only —
    // the guard effect owns clearing the reducer state.
    if (pending.userId !== userRef.current?.id) {
      pendingRef.current = null;
      return;
    }
    if (uploadingRef.current) return; // synchronous re-entrancy claim
    uploadingRef.current = true;
    uploadRecording(pending, (fraction) =>
      dispatch({ type: 'UPLOAD_PROGRESS', progress: fraction }),
    )
      .then(() => {
        uploadingRef.current = false;
        pendingRef.current = null;
        // Durable row is now redundant — the recording is safely uploaded.
        // Fire-and-forget; pending-store swallows its own failures, so this can
        // never throw into the upload success path.
        void deletePending(pending.recordingId);
        dispatch({ type: 'UPLOAD_DONE' });
      })
      .catch((err: unknown) => {
        uploadingRef.current = false;
        const message = err instanceof Error ? err.message : 'upload failed';
        // Reflect the failure in the durable row so a later reload rehydrates
        // with the real error. Fire-and-forget (swallow-and-warn internally).
        void savePending({ ...pending, error: message, createdAt: Date.now() });
        dispatch({ type: 'UPLOAD_FAILED', error: message });
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
      if (!user || stateRef.current.recorder || acquiringRef.current) return 'busy';
      acquiringRef.current = true; // synchronous claim, before the getUserMedia await
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        acquiringRef.current = false;
        return 'permission-denied';
      }
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'; // Safari
      const container = mimeType.startsWith('audio/webm') ? 'audio/webm' : 'audio/mp4';
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        acquiringRef.current = false;
        return 'permission-denied';
      }
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
        const pending = {
          userId: user.id, noteId, recordingId: uuidv4(), blob,
          mimeType: container, durationSeconds: elapsed,
        };
        pendingRef.current = pending;
        // Persist the pending payload the moment recording STOPS, so it survives
        // a hard reload/crash before the upload finishes (rehydrates as `failed`,
        // recoverable via the dock). Fire-and-forget on the hot path — the
        // pending-store swallows its own failures and can never throw here.
        void savePending({ ...pending, error: null, createdAt: Date.now() });
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
      // Setup is complete: stateRef.current.recorder will be truthy once this
      // dispatch is committed, so the ordinary guard takes over from here.
      acquiringRef.current = false;
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
    // Cross-user re-check before we flip the reducer back to 'uploading': if the
    // pending payload belongs to a different user than the current session,
    // discard rather than upload under the wrong identity (mirrors runUpload).
    const pending = pendingRef.current;
    if (!pending || pending.userId !== userRef.current?.id) {
      pendingRef.current = null;
      dispatch({ type: 'RECORDER_CLEAR' });
      return;
    }
    if (uploadingRef.current) return; // a retry is already in flight
    dispatch({ type: 'RECORD_STOP' }); // back to uploading
    runUpload();
  }, [runUpload]);

  const discardRecording = useCallback(() => {
    // Intentional destroy: also drop the durable row so it never rehydrates.
    // Fire-and-forget (swallow-and-warn internally).
    const recordingId = pendingRef.current?.recordingId;
    if (recordingId) void deletePending(recordingId);
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

  // Cross-user safety (MANDATORY). Because the provider is hoisted to the app
  // root it survives sign-out→sign-in: AuthSession flips `user` in place with NO
  // remount, so the salvage-on-unmount effect does NOT fire on this transition.
  // Any recorder session belonging to the departing user must be torn down here
  // — never carried into, uploaded under, or shown to the next user. A live mic
  // is stopped via cancelRecording() (sets cancelledRef so onstop DISCARDS
  // instead of salvaging into the wrong account and releases the stream), so no
  // orphaned hot mic survives the identity change.
  const prevUserIdRef = useRef(user?.id ?? null);
  useEffect(() => {
    const prevId = prevUserIdRef.current;
    const nextId = user?.id ?? null;
    if (prevId === nextId) return;
    prevUserIdRef.current = nextId;
    // Only act when a session from the departing user is present. A pending
    // payload (uploading/failed) is keyed by userId; an in-flight capture has
    // no payload yet but its recorder belongs to the previous identity.
    const pending = pendingRef.current;
    const hasStaleSession =
      (pending && pending.userId !== nextId) || (!pending && stateRef.current.recorder != null);
    if (!hasStaleSession) return;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      cancelRecording(); // stop mic + discard (no salvage into the wrong user)
    }
    pendingRef.current = null;
    uploadingRef.current = false;
    dispatch({ type: 'RECORDER_CLEAR' });
  }, [user?.id, cancelRecording]);

  // Rehydrate a durable pending row (survived a hard reload/crash) once a user
  // id is available. Declared AFTER the cross-user guard so, on a sign-out→
  // sign-in identity flip, the guard's SYNCHRONOUS teardown of the departing
  // user's session runs first; this effect then loads only the CURRENT user's
  // rows (loadPendingForUser filters by id — that scoping is what isolates
  // users, so we never restore or delete another user's row here).
  //
  // Restore as `failed` (never auto-upload — a silent background write on app
  // load is surprising; Retry is one tap in the dock). Both guards matter: skip
  // if a live/pending session already exists BEFORE the load, and re-check AFTER
  // the async load resolves (a live capture may have started, or the guard may
  // have run) so we never clobber it. `cancelled` drops a stale load whose
  // effect re-ran (e.g. the user changed again mid-load).
  useEffect(() => {
    const id = user?.id;
    if (!id) return;
    if (stateRef.current.recorder || stateRef.current.mode !== 'idle') return;
    let cancelled = false;
    void loadPendingForUser(id).then((rows) => {
      if (cancelled || rows.length === 0) return;
      // Re-check for a live session that appeared while the load was in flight.
      if (stateRef.current.recorder || stateRef.current.mode !== 'idle') return;
      // Confirm the identity is still the one we loaded for (defense in depth
      // against a same-tick user flip the cleanup didn't cancel).
      if (userRef.current?.id !== id) return;
      const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      const [newest, ...rest] = sorted;
      // Under the one-slot invariant there should be at most one row; a crash
      // between save and delete can orphan extras. Restore the newest, drop the
      // rest (warn each) so they never resurface.
      for (const stale of rest) {
        console.warn('[recordings] dropping orphaned pending row', stale.recordingId);
        void deletePending(stale.recordingId);
      }
      pendingRef.current = {
        userId: newest.userId, noteId: newest.noteId, recordingId: newest.recordingId,
        blob: newest.blob, mimeType: newest.mimeType, durationSeconds: newest.durationSeconds,
      };
      dispatch({
        type: 'RESTORE_PENDING',
        noteId: newest.noteId,
        mimeType: newest.mimeType,
        durationSeconds: newest.durationSeconds,
        error: newest.error,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  // Provider-unmount safety net. With the provider hoisted to the app root
  // (App.tsx), in-app navigation no longer unmounts it — this cleanup now fires
  // only on real app teardown (full page unload/close) and in tests. Kept as
  // belt-and-suspenders: internal paths (onstop, beforeunload, teardownCapture)
  // already clean up in every normal flow, but a bare teardownCapture() on any
  // remaining unmount would silently discard an in-flight capture: it stops the stream
  // and nulls mediaRecorderRef WITHOUT ever calling recorder.stop(), so
  // onstop never fires and the chunks in chunksRef are lost.
  //
  // Salvage instead (mirrors the onerror handler's "spec §2" comment above:
  // "Mic unplugged etc: salvage the chunks collected so far — onstop fires
  // next and routes them into the normal upload path"). If a capture is
  // active (state 'recording' or 'paused' — anything !== 'inactive'), call
  // recorder.stop() and let onstop do its normal job: it flushes the final
  // buffered timeslice chunk, runs teardownCapture() itself, assembles the
  // blob, sets pendingRef, dispatches RECORD_STOP, and calls runUpload().
  // That upload (and its success/failure toast) survives the unmount —
  // sonner's Toaster mounts above this provider, and a post-unmount dispatch
  // is a safe no-op in React 18+.
  //
  // Ordering is the point: do NOT stop the stream tracks before calling
  // recorder.stop() — that is the bug this replaces. Stopping the tracks
  // first can drop the final buffered chunk, and in browsers that don't
  // fire 'stop' on track-end it drops everything.
  //
  // Only fall back to a bare teardownCapture() when there is no active
  // recorder — that still covers a stray stream/tick left over without a
  // capture in flight.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop(); // onstop salvages chunks + tears down + uploads
      } else {
        teardownCapture();
      }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
  }, [teardownCapture]);

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
