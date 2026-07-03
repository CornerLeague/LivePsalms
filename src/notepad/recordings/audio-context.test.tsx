// @vitest-environment jsdom
// src/notepad/recordings/audio-context.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
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
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' }, adapter: null, session: null }),
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
});
