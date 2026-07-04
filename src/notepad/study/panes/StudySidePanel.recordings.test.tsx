// @vitest-environment jsdom
// src/notepad/study/panes/StudySidePanel.recordings.test.tsx
//
// Regression test for the P1 crash where the study route rendered
// NotepadEditor -> RecordingsStrip without a RecordingsAudioProvider
// ancestor. StudySidePanel.test.tsx and MobileStudyEditorView.test.tsx both
// mock NotepadEditor entirely, so neither exercises the real
// RecordingsStrip/useRecordingsAudio wiring and neither would have caught
// this crash. This file renders the REAL RecordingsStrip (unmocked) under
// the same RecordingsAudioProvider the app now supplies once at the root (see
// src/App.tsx, hoisted above <Routes>), so a regression in provider placement
// fails here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecordingsAudioProvider } from '../../recordings/audio-context';
import { RecordingsStrip } from '../../recordings/RecordingsStrip';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: { id: 'user-1' }, adapter: null, session: null }),
}));

const client = vi.hoisted(() => ({ listRecordings: vi.fn() }));
vi.mock('../../recordings/recordings-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../recordings/recordings-client')>()),
  listRecordings: client.listRecordings,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecordingsStrip under the study route provider stack', () => {
  it('renders without throwing when wrapped in RecordingsAudioProvider (the fix)', async () => {
    client.listRecordings.mockResolvedValue([]);
    expect(() =>
      render(
        <RecordingsAudioProvider>
          <RecordingsStrip noteId="note-1" />
        </RecordingsAudioProvider>,
      ),
    ).not.toThrow();
    expect(await screen.findByRole('button', { name: 'Record voice note' })).toBeInTheDocument();
  });

  it('throws outside RecordingsAudioProvider (documents the contract that made this a P1 crash)', () => {
    client.listRecordings.mockResolvedValue([]);
    expect(() => render(<RecordingsStrip noteId="note-1" />)).toThrow(
      'useRecordingsAudio must be used within RecordingsAudioProvider',
    );
  });
});
