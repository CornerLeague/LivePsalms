// @vitest-environment jsdom
/* eslint-disable react-hooks/globals */
// src/notepad/recordings/RecordingsDock.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { RecordingsDock } from './RecordingsDock';
import { RecordingsAudioProvider, useRecordingsAudio, type RecordingsAudioValue } from './audio-context';
import { installMediaFakes, FakeAudio } from './fakes';
import type { NoteRecording } from './recordings-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' }, adapter: null, session: null }),
}));
const client = vi.hoisted(() => ({ signedRecordingUrl: vi.fn(), uploadRecording: vi.fn() }));
vi.mock('./recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordings-client')>()),
  signedRecordingUrl: client.signedRecordingUrl,
  uploadRecording: client.uploadRecording,
}));

const rec: NoteRecording = {
  id: 'rec-1', noteId: 'note-1', title: 'Psalm 23', durationSeconds: 120,
  storagePath: 'user-1/note-1/rec-1.webm', mimeType: 'audio/webm',
  sizeBytes: 100, createdAt: '2026-07-03T12:00:00Z',
};

let ctx: RecordingsAudioValue;
 
function Capture() { ctx = useRecordingsAudio(); return null; }

function mount(onOpenNote = vi.fn()) {
  render(
    <RecordingsAudioProvider>
      <Capture />
      <RecordingsDock variant="desktop" onOpenNote={onOpenNote} />
    </RecordingsAudioProvider>,
  );
  return onOpenNote;
}

let fakes: ReturnType<typeof installMediaFakes>;
beforeEach(() => {
  cleanup();
  fakes = installMediaFakes();
  client.signedRecordingUrl.mockResolvedValue('https://signed.example/a.webm');
});
afterEach(() => {
  cleanup();
  fakes.restore();
  vi.clearAllMocks();
});

describe('RecordingsDock', () => {
  it('renders nothing while idle', () => {
    mount();
    expect(screen.queryByTestId('recordings-dock')).toBeNull();
  });

  it('shows the recorder bar with a timer while recording', async () => {
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    expect(screen.getByTestId('recordings-dock')).toBeInTheDocument();
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause recording' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save recording' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard recording' })).toBeInTheDocument();
    // Clean up: cancel recording for next tests
    fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
  });

  it('player bar: play/pause, ±15s skip, close', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[FakeAudio.instances.length - 1];

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(audio.pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(audio.play).toHaveBeenCalledTimes(2); // initial + resume

    act(() => ctx.seekTo(30));
    fireEvent.click(screen.getByRole('button', { name: 'Back 15 seconds' }));
    expect(audio.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 15 seconds' }));
    expect(audio.currentTime).toBe(30);

    fireEvent.click(screen.getByRole('button', { name: 'Close player' }));
    expect(screen.queryByTestId('recordings-dock')).toBeNull();
  });

  it('scrubber seeks and shows elapsed/total', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[FakeAudio.instances.length - 1];
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '45' } });
    expect(audio.currentTime).toBe(45);
    expect(screen.getByText('0:45')).toBeInTheDocument();
  });

  it('speed control applies the playback rate', async () => {
    mount();
    await act(async () => { await ctx.playRecording(rec); });
    const audio = FakeAudio.instances[FakeAudio.instances.length - 1];
    // Cycle: 1× → 1.25×
    fireEvent.click(screen.getByRole('button', { name: 'Playback speed' }));
    expect(audio.playbackRate).toBe(1.25);
    expect(screen.getByText('1.25×')).toBeInTheDocument();
  });

  it('clicking the source note name navigates', async () => {
    const onOpenNote = mount();
    await act(async () => { await ctx.playRecording(rec); });
    fireEvent.click(screen.getByRole('button', { name: 'Go to note' }));
    expect(onOpenNote).toHaveBeenCalledWith('note-1');
  });

  // ── Note-agnostic uploading/failed surface (PR #73, adversarial "lost real
  //    session" gap: a session started in note A must stay recoverable app-wide,
  //    even when the active note is different, deleted, or absent). ──────────

  it('shows an uploading progress bar app-wide (independent of active note)', async () => {
    // Never-resolving upload so the session parks in "uploading".
    client.uploadRecording.mockReturnValue(new Promise(() => {}));
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('uploading');
    expect(screen.getByTestId('recordings-dock')).toBeInTheDocument();
    expect(screen.getByText('Uploading recording…')).toBeInTheDocument();
  });

  it('failed upload: dock exposes Retry / Discard / Open note reachable from any note', async () => {
    client.uploadRecording.mockRejectedValueOnce(new Error('offline'));
    const onOpenNote = mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('failed');

    // The dock (which renders app-wide, regardless of which note is active)
    // surfaces the full recovery affordance.
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }));
    expect(onOpenNote).toHaveBeenCalledWith('note-1');

    // Retry re-uploads the same session; on success the dock clears.
    client.uploadRecording.mockResolvedValueOnce(rec);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ctx.recorder).toBeNull();
    expect(screen.queryByTestId('recordings-dock')).toBeNull();
  });

  it('failed upload: Discard from the dock clears the session without re-uploading', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Discard failed recording' }));
    expect(ctx.recorder).toBeNull();
    expect(screen.queryByTestId('recordings-dock')).toBeNull();
    // Discard must not resurrect the upload.
    act(() => ctx.retryUpload());
    expect(client.uploadRecording).not.toHaveBeenCalled();
  });

  it('active playback takes precedence over a pending upload in the dock', async () => {
    client.uploadRecording.mockReturnValue(new Promise(() => {})); // parks in uploading
    mount();
    await act(async () => { await ctx.startRecording('note-1'); });
    await act(async () => {
      ctx.stopRecording();
      await Promise.resolve();
    });
    expect(ctx.recorder?.status).toBe('uploading');
    // Start playback of a saved recording — the player bar must win.
    await act(async () => { await ctx.playRecording(rec); });
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
    expect(screen.queryByText('Uploading recording…')).toBeNull();
  });
});
