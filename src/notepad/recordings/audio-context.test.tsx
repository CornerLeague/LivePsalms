// @vitest-environment jsdom
// src/notepad/recordings/audio-context.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import {
  audioReducer,
  initialAudioState,
  recordingLabel,
  RecordingsAudioProvider,
  useRecordingsAudio,
  type AudioState,
  type RecordingsAudioValue,
} from './audio-context';
import { installMediaFakes, FakeAudio, FakeMediaRecorder } from './fakes';
import type { NoteRecording } from './recordings-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
// Mutable current-user holder so the cross-user test can flip `user.id` in place
// (mirrors AuthSession's useSyncExternalStore update with no remount). Defaults
// to user-1 for every other test.
const auth = vi.hoisted(() => ({ userId: 'user-1' as string | null }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({
    user: auth.userId ? { id: auth.userId } : null,
    adapter: null,
    session: null,
  }),
}));
const client = vi.hoisted(() => ({
  uploadRecording: vi.fn(),
  signedRecordingUrl: vi.fn(),
}));
vi.mock('./recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordings-client')>()),
  uploadRecording: client.uploadRecording,
  signedRecordingUrl: client.signedRecordingUrl,
}));
import { toast } from 'sonner';

const rec: NoteRecording = {
  id: 'rec-1', noteId: 'note-1', title: '', durationSeconds: 60,
  storagePath: 'user-1/note-1/rec-1.webm', mimeType: 'audio/webm',
  sizeBytes: 100, createdAt: '2026-07-03T12:00:00Z',
};
const track = {
  recordingId: 'rec-1', noteId: 'note-1', label: 'Jul 3, 2026',
  durationSeconds: 60, storagePath: 'user-1/note-1/rec-1.webm',
};

describe('audioReducer (pure)', () => {
  const recordingState: AudioState = audioReducer(initialAudioState, {
    type: 'RECORD_START', noteId: 'note-1', mimeType: 'audio/webm',
  });

  it('RECORD_START enters recording mode and clears playback', () => {
    const playing = audioReducer(initialAudioState, { type: 'PLAY_TRACK', track });
    const next = audioReducer(playing, { type: 'RECORD_START', noteId: 'n2', mimeType: 'audio/webm' });
    expect(next.mode).toBe('recording');
    expect(next.track).toBeNull();
  });

  it('RECORD_START is ignored while a recorder session exists', () => {
    const next = audioReducer(recordingState, { type: 'RECORD_START', noteId: 'other', mimeType: 'audio/mp4' });
    expect(next.recorder?.noteId).toBe('note-1');
  });

  it('PLAY_TRACK is ignored while recording (exclusivity)', () => {
    const next = audioReducer(recordingState, { type: 'PLAY_TRACK', track });
    expect(next.track).toBeNull();
    expect(next.mode).toBe('recording');
  });

  it('RECORD_TICK accumulates only while status is recording', () => {
    let s = audioReducer(recordingState, { type: 'RECORD_TICK', seconds: 5 });
    expect(s.recorder?.elapsedSec).toBe(5);
    s = audioReducer(s, { type: 'RECORD_PAUSE' });
    s = audioReducer(s, { type: 'RECORD_TICK', seconds: 10 });
    expect(s.recorder?.elapsedSec).toBe(5);
    s = audioReducer(s, { type: 'RECORD_RESUME' });
    s = audioReducer(s, { type: 'RECORD_TICK', seconds: 3 });
    expect(s.recorder?.elapsedSec).toBe(8);
  });

  it('RECORD_STOP moves to uploading and mode idle; UPLOAD_DONE clears and bumps savedVersion', () => {
    let s = audioReducer(recordingState, { type: 'RECORD_STOP' });
    expect(s.mode).toBe('idle');
    expect(s.recorder?.status).toBe('uploading');
    s = audioReducer(s, { type: 'UPLOAD_DONE' });
    expect(s.recorder).toBeNull();
    expect(s.savedVersion).toBe(1);
  });

  it('CLOSE resets playback to idle', () => {
    const playing = audioReducer(initialAudioState, { type: 'PLAY_TRACK', track });
    const next = audioReducer(playing, { type: 'CLOSE' });
    expect(next).toMatchObject({ mode: 'idle', track: null, positionSec: 0 });
  });
});

describe('recordingLabel', () => {
  it('prefers the title, falls back to a date label', () => {
    expect(recordingLabel({ title: 'Psalm 23', createdAt: rec.createdAt })).toBe('Psalm 23');
    expect(recordingLabel({ title: '', createdAt: rec.createdAt })).toBe('Jul 3, 2026');
  });
});

describe('RecordingsAudioProvider', () => {
  let ctx: RecordingsAudioValue;
  function Capture() {
    // Test-only harness: captures the hook value into an outer variable so
    // assertions can drive it from `act()` blocks below. Not real render
    // logic, so the intentional reassignment is safe here.
    // eslint-disable-next-line react-hooks/globals -- see comment above
    ctx = useRecordingsAudio();
    return null;
  }
  let fakes: ReturnType<typeof installMediaFakes>;

  beforeEach(() => {
    auth.userId = 'user-1';
    vi.useFakeTimers();
    fakes = installMediaFakes();
    client.uploadRecording.mockResolvedValue(rec);
    client.signedRecordingUrl.mockResolvedValue('https://signed.example/a.webm');
  });
  afterEach(() => {
    fakes.restore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function mount() {
    render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
  }

  it('useRecordingsAudio throws outside the provider', () => {
    function Bare() { useRecordingsAudio(); return null; }
    expect(() => render(<Bare />)).toThrow();
  });

  it('records, then auto-stops and saves at the 30-minute cap', async () => {
    mount();
    await act(async () => {
      expect(await ctx.startRecording('note-1')).toBe('ok');
    });
    expect(ctx.mode).toBe('recording');
    await act(async () => {
      vi.advanceTimersByTime(1800_000);
      await Promise.resolve();
    });
    expect(FakeMediaRecorder.instances[0].stop).toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
    expect(client.uploadRecording).toHaveBeenCalled();
  });

  it('excludes paused time from elapsed duration', async () => {
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    act(() => ctx.pauseRecording());
    await act(async () => { vi.advanceTimersByTime(10_000); });
    act(() => ctx.resumeRecording());
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(ctx.recorder?.elapsedSec).toBe(8);
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
    });
    expect(client.uploadRecording).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 8 }),
      expect.any(Function),
    );
  });

  it('failed upload keeps a retryable session', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed');
    await act(async () => {
      ctx.retryUpload();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder).toBeNull();
    expect(ctx.savedVersion).toBe(1);
  });

  it('plays a recording and retries an expired URL exactly once', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe('https://signed.example/a.webm');
    expect(ctx.mode).toBe('playing');

    audio.currentTime = 30;
    act(() => audio.emit('timeupdate'));
    client.signedRecordingUrl.mockResolvedValue('https://signed.example/fresh.webm');
    await act(async () => {
      audio.emit('error');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(audio.src).toBe('https://signed.example/fresh.webm');
    expect(audio.currentTime).toBe(30);
    expect(client.signedRecordingUrl).toHaveBeenCalledTimes(2);

    await act(async () => {
      audio.emit('error');
      await Promise.resolve();
    });
    expect(client.signedRecordingUrl).toHaveBeenCalledTimes(2); // no third fetch
  });

  it('stopIfCurrent closes the dock only for the matching recording', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    act(() => ctx.stopIfCurrent('other-id'));
    expect(ctx.mode).toBe('playing');
    act(() => ctx.stopIfCurrent('rec-1'));
    expect(ctx.mode).toBe('idle');
    expect(ctx.track).toBeNull();
  });

  it('a concurrent second startRecording call while getUserMedia is pending is a no-op', async () => {
    mount();
    // Pin a distinguishable stop spy on the (single, shared-by-fakes) stream
    // so we can assert it is stopped at most once — i.e. the guard prevents
    // a second acquisition from ever touching the refs.
    const stopTrack = vi.fn();
    fakes.getUserMedia.mockImplementation(() => {
      const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
      return new Promise((resolve) => setTimeout(() => resolve(stream), 10));
    });

    let first: Promise<'ok' | 'permission-denied' | 'busy'>;
    let second: Promise<'ok' | 'permission-denied' | 'busy'>;
    await act(async () => {
      // Fire both calls before either awaits past getUserMedia — the classic
      // double-click/double-tap race.
      first = ctx.startRecording('note-1');
      second = ctx.startRecording('note-1');
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      await Promise.resolve();
    });
    const [firstResult, secondResult] = await Promise.all([first!, second!]);

    expect(firstResult).toBe('ok');
    expect(secondResult).toBe('busy');
    // Only one MediaRecorder/session was ever created.
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(ctx.mode).toBe('recording');

    // Only one tick interval is running: elapsedSec advances at 1/sec, not 2/sec.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(ctx.recorder?.elapsedSec).toBe(3);

    // The mic stream from the (only) acquisition was never stopped by the guard.
    expect(stopTrack).not.toHaveBeenCalled();
  });

  it('discardRecording clears a failed/pending session without re-triggering upload', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed');

    act(() => ctx.discardRecording());

    expect(ctx.recorder).toBeNull();
    expect(ctx.mode).toBe('idle');
    // Discarding must not resurrect the pending upload payload.
    client.uploadRecording.mockClear();
    act(() => ctx.retryUpload());
    expect(client.uploadRecording).not.toHaveBeenCalled();
  });

  it('unmounting mid-recording stops the mic stream and clears the tick interval; unmounting mid-playback pauses and detaches audio', async () => {
    const { unmount } = render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
    await act(async () => {
      expect(await ctx.startRecording('note-1')).toBe('ok');
    });
    // getTracks() normally mints a fresh mock array per call (fakes.ts); pin
    // it to a stable stop() spy so the assertion observes the same call the
    // unmount-cleanup effect makes via teardownCapture().
    const stream = FakeMediaRecorder.instances[0].stream as unknown as {
      getTracks: () => { stop: () => void }[];
    };
    const stopTrack = vi.fn();
    stream.getTracks = () => [{ stop: stopTrack }];
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    unmount();

    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalled();
    // No stray tick fires after unmount.
    const ticksBefore = ctx.recorder?.elapsedSec;
    vi.advanceTimersByTime(5000);
    expect(ctx.recorder?.elapsedSec).toBe(ticksBefore);
    clearIntervalSpy.mockRestore();

    // Separate mount for the playback half: pause + detach on unmount.
    const { unmount: unmountPlayback } = render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[FakeAudio.instances.length - 1];
    expect(audio.paused).toBe(false);

    unmountPlayback();

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('');
  });

  it('unmounting mid-recording salvages the in-flight chunks into the normal upload path (spec §2, data-loss regression)', async () => {
    const { unmount } = render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
    await act(async () => {
      expect(await ctx.startRecording('note-1')).toBe('ok');
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(ctx.recorder?.elapsedSec).toBe(3);

    const stream = FakeMediaRecorder.instances[0].stream as unknown as {
      getTracks: () => { stop: () => void }[];
    };
    const stopTrack = vi.fn();
    stream.getTracks = () => [{ stop: stopTrack }];
    const recorder = FakeMediaRecorder.instances[0];

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    // The recorder was stopped (not just discarded) — onstop fires and
    // assembles the buffered chunks instead of the provider silently
    // dropping the in-flight capture.
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(client.uploadRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: 'note-1',
        userId: 'user-1',
        durationSeconds: 3,
        blob: expect.any(Blob),
      }),
      expect.any(Function),
    );
    // Teardown still happens — via onstop's call to teardownCapture — so the
    // mic is released and no hot stream survives the unmount.
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it('unmounting while paused also salvages the in-flight chunks (paused !== inactive)', async () => {
    const { unmount } = render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
    await act(async () => {
      expect(await ctx.startRecording('note-1')).toBe('ok');
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    act(() => ctx.pauseRecording());
    expect(ctx.recorder?.status).toBe('rec-paused');

    const stream = FakeMediaRecorder.instances[0].stream as unknown as {
      getTracks: () => { stop: () => void }[];
    };
    const stopTrack = vi.fn();
    stream.getTracks = () => [{ stop: stopTrack }];
    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.state).toBe('paused');

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(client.uploadRecording).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: 'note-1', durationSeconds: 2 }),
      expect.any(Function),
    );
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  // ── Hoist + hardening mitigations (PR #73 greptile P1, bar i) ─────────────

  // Harness that mounts the provider at the ROOT (outside the router, as in
  // App.tsx) and exposes navigate(), so route changes never unmount it.
  let navigate: ReturnType<typeof useNavigate>;
  function RouterCapture() {
    // Test-only harness (see Capture above): capture hook + navigate into outer
    // vars so act() blocks can drive them. Intentional reassignment is safe here.
    // eslint-disable-next-line react-hooks/globals -- see comment above
    ctx = useRecordingsAudio();
    // eslint-disable-next-line react-hooks/globals -- see comment above
    navigate = useNavigate();
    return <div data-testid="notebook">notebook</div>;
  }
  function mountRooted(initial = '/notebook') {
    render(
      <RecordingsAudioProvider>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/" element={<Navigate to="/notebook" replace />} />
            <Route path="/notebook" element={<RouterCapture />} />
            <Route path="/notebook/study" element={<div data-testid="study">study</div>} />
          </Routes>
        </MemoryRouter>
      </RecordingsAudioProvider>,
    );
  }

  it('original-gap: a failed session survives navigate-out-and-back and stays retryable with the same blob', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    mountRooted();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording(); // onstop populates pendingRef, runUpload begins → rejects
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed');

    // Navigate OUT to '/' (redirects to /notebook) and back — the root provider
    // must NOT unmount, so the failed session persists.
    await act(async () => { navigate('/notebook/study'); });
    await act(async () => { navigate('/notebook'); });
    expect(ctx.recorder?.status).toBe('failed');

    // Retry re-invokes uploadRecording with the SAME blob/noteId (no re-record).
    client.uploadRecording.mockClear();
    client.uploadRecording.mockResolvedValueOnce(rec);
    await act(async () => {
      ctx.retryUpload();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.uploadRecording).toHaveBeenCalledTimes(1);
    expect(client.uploadRecording).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: 'note-1', userId: 'user-1', blob: expect.any(Blob) }),
      expect.any(Function),
    );
    expect(ctx.recorder).toBeNull();
    expect(ctx.savedVersion).toBe(1);
    // Exactly one capture session ever existed — one provider, no remount.
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('single-instance: navigating between notebook routes preserves reducer identity (no remount)', async () => {
    mountRooted();
    await act(async () => {
      ctx.stopRecording(); // no-op, just anchor a render
      await Promise.resolve();
    });
    // Drive a successful upload so savedVersion bumps to a distinctive value.
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.savedVersion).toBe(1);
    expect(ctx.recorder).toBeNull();

    // Navigate away and back; a remount would reset savedVersion to 0.
    await act(async () => { navigate('/notebook/study'); });
    await act(async () => { navigate('/notebook'); });
    expect(ctx.savedVersion).toBe(1);
  });

  it('re-entrant guard: double-firing retryUpload in one act uploads exactly once', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed');

    client.uploadRecording.mockClear();
    client.uploadRecording.mockResolvedValue(rec);
    // Two synchronous clicks before stateRef flips to 'uploading'.
    await act(async () => {
      ctx.retryUpload();
      ctx.retryUpload();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.uploadRecording).toHaveBeenCalledTimes(1);
  });

  it('cross-user: flipping user.id in place clears the pending session, fires no upload, and disarms beforeunload', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { rerender } = render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed'); // pending payload for user-1

    client.uploadRecording.mockClear();
    // Sign out → different user signs in, all WITHOUT unmounting the provider.
    auth.userId = 'user-2';
    await act(async () => {
      rerender(
        <RecordingsAudioProvider>
          <Capture />
        </RecordingsAudioProvider>,
      );
      await Promise.resolve();
    });

    // (i) the departing user's session is cleared …
    expect(ctx.recorder).toBeNull();
    // (ii) … and even a stray retry uploads NOTHING under the new user.
    act(() => ctx.retryUpload());
    expect(client.uploadRecording).not.toHaveBeenCalled();
    // (iv) the beforeunload guard was torn down once captureActive went false.
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('cross-user: an ACTIVE recording for the departing user stops the mic (no orphaned hot stream) and fires no upload', async () => {
    const { rerender } = render(
      <RecordingsAudioProvider>
        <Capture />
      </RecordingsAudioProvider>,
    );
    await act(async () => { await ctx.startRecording('note-1'); });
    expect(ctx.mode).toBe('recording');
    const stream = FakeMediaRecorder.instances[0].stream as unknown as {
      getTracks: () => { stop: () => void }[];
    };
    const stopTrack = vi.fn();
    stream.getTracks = () => [{ stop: stopTrack }];
    const recorder = FakeMediaRecorder.instances[0];

    client.uploadRecording.mockClear();
    auth.userId = 'user-2';
    await act(async () => {
      rerender(
        <RecordingsAudioProvider>
          <Capture />
        </RecordingsAudioProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mic stopped (via cancelRecording → recorder.stop → teardown), session gone.
    expect(recorder.stop).toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
    expect(ctx.recorder).toBeNull();
    // Cancelled capture must NOT upload the previous user's audio.
    expect(client.uploadRecording).not.toHaveBeenCalled();
  });
});
