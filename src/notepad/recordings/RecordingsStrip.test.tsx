// @vitest-environment jsdom
// src/notepad/recordings/RecordingsStrip.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { RecordingsStrip } from './RecordingsStrip';
import { initialAudioState } from './audio-context';
import type { NoteRecording } from './recordings-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const auth = vi.hoisted(() => ({ user: { id: 'user-1' } as { id: string } | null }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: auth.user, adapter: null, session: null }),
}));

const client = vi.hoisted(() => ({
  listRecordings: vi.fn(),
  renameRecording: vi.fn(),
  deleteRecording: vi.fn(),
}));
vi.mock('./recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordings-client')>()),
  listRecordings: client.listRecordings,
  renameRecording: client.renameRecording,
  deleteRecording: client.deleteRecording,
}));

const audio = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock('./audio-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audio-context')>()),
  useRecordingsAudio: () => audio.value,
}));

const rec: NoteRecording = {
  id: 'rec-1', noteId: 'note-1', title: '', durationSeconds: 83,
  storagePath: 'user-1/note-1/rec-1.webm', mimeType: 'audio/webm',
  sizeBytes: 100, createdAt: '2026-07-03T12:00:00Z',
};

beforeEach(() => {
  auth.user = { id: 'user-1' };
  client.listRecordings.mockResolvedValue([rec]);
  client.renameRecording.mockResolvedValue(undefined);
  client.deleteRecording.mockResolvedValue(undefined);
  audio.value = {
    ...initialAudioState,
    startRecording: vi.fn(async () => 'ok'),
    playRecording: vi.fn(async () => undefined),
    retryUpload: vi.fn(),
    discardRecording: vi.fn(),
    stopIfCurrent: vi.fn(),
  };
});
afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('RecordingsStrip visibility states', () => {
  it('signed out: muted sign-in nudge, no Record button', async () => {
    auth.user = null;
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Sign in to record voice notes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
  });

  it('signed in, no recordings: compact Record button only', async () => {
    client.listRecordings.mockResolvedValue([]);
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByRole('button', { name: 'Record voice note' })).toBeInTheDocument();
    expect(screen.queryByTestId('recording-chip')).toBeNull();
  });

  it('with recordings: chips + Record button, date-label fallback and duration', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Jul 3, 2026')).toBeInTheDocument();
    expect(screen.getByText('1:23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record voice note' })).toBeInTheDocument();
  });
});

describe('chip interactions', () => {
  it('clicking a chip plays it', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByText('Jul 3, 2026'));
    expect(audio.value.playRecording).toHaveBeenCalledWith(rec);
  });

  it('inline rename: Enter saves', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recording options' }));
    fireEvent.click(await screen.findByText('Rename'));
    const input = screen.getByRole('textbox', { name: 'Recording title' });
    fireEvent.change(input, { target: { value: 'Evening prayer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(client.renameRecording).toHaveBeenCalledWith('rec-1', 'Evening prayer'));
    expect(await screen.findByText('Evening prayer')).toBeInTheDocument();
  });

  it('inline rename: Escape cancels', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recording options' }));
    fireEvent.click(await screen.findByText('Rename'));
    const input = screen.getByRole('textbox', { name: 'Recording title' });
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(client.renameRecording).not.toHaveBeenCalled();
    expect(screen.getByText('Jul 3, 2026')).toBeInTheDocument();
  });

  it('delete: AlertDialog confirm stops playback then deletes', async () => {
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recording options' }));
    fireEvent.click(await screen.findByText('Delete'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(client.deleteRecording).toHaveBeenCalledWith(rec));
    expect(audio.value.stopIfCurrent).toHaveBeenCalledWith('rec-1');
    await waitFor(() => expect(screen.queryByTestId('recording-chip')).toBeNull());
  });
});

describe('recording / upload states', () => {
  it('mic permission denied shows the inline blocked message', async () => {
    (audio.value.startRecording as ReturnType<typeof vi.fn>).mockResolvedValue('permission-denied');
    render(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record voice note' }));
    expect(
      await screen.findByText('Microphone access is blocked — enable it in your browser settings'),
    ).toBeInTheDocument();
  });

  it('while recording on this note: Record button replaced, chips inert', async () => {
    audio.value = {
      ...audio.value,
      mode: 'recording',
      recorder: { noteId: 'note-1', status: 'recording', elapsedSec: 3, uploadProgress: 0, error: null, mimeType: 'audio/webm' },
    };
    render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Recording…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record voice note' })).toBeNull();
    fireEvent.click(screen.getByText('Jul 3, 2026'));
    expect(audio.value.playRecording).not.toHaveBeenCalled();
  });

  it('pending chip shows progress, then Retry / Discard on failure', async () => {
    audio.value = {
      ...audio.value,
      recorder: { noteId: 'note-1', status: 'uploading', elapsedSec: 8, uploadProgress: 0.4, error: null, mimeType: 'audio/webm' },
    };
    const { rerender } = render(<RecordingsStrip noteId="note-1" />);
    expect(await screen.findByText('Uploading… 40%')).toBeInTheDocument();

    audio.value = {
      ...audio.value,
      recorder: { ...(audio.value.recorder as object), status: 'failed', error: 'offline' } as never,
    };
    rerender(<RecordingsStrip noteId="note-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(audio.value.retryUpload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard failed recording' }));
    expect(audio.value.discardRecording).toHaveBeenCalled();
  });
});
