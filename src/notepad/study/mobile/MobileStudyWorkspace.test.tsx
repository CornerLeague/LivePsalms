// src/notepad/study/mobile/MobileStudyWorkspace.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const openNote = vi.fn();
let activeNote: { id: string } | null = null;

vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ notes: [], activeNote, collection: { openNote } }),
}));
vi.mock('../useEnsureStudyFolder', () => ({ useEnsureStudyFolder: () => {} }));
vi.mock('../panes/StudyReader', () => ({ StudyReader: () => <div>reader-pane</div> }));
vi.mock('../panes/StudySidePanel', () => ({ StudySidePanel: () => <div>side-panel</div> }));
vi.mock('../panes/ApparatusRail', () => ({ ApparatusRail: () => <div>apparatus</div> }));
vi.mock('../StudyModeToggle', () => ({ StudyModeToggle: () => <div>mode-toggle</div> }));
vi.mock('./MobileStudyEditorView', () => ({
  MobileStudyEditorView: (p: { onBack: () => void }) => <button onClick={p.onBack}>editor-back</button>,
}));
vi.mock('@/notepad/recordings/RecordingsDock', () => ({ RecordingsDock: () => <div>recordings-dock</div> }));

import { MobileStudyWorkspace } from './MobileStudyWorkspace';

afterEach(() => {
  cleanup();
  activeNote = null;
  openNote.mockClear();
});

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <MobileStudyWorkspace />
    </MemoryRouter>,
  );
}

describe('MobileStudyWorkspace', () => {
  it('lands on the Reader tab with the toggle and tab bar visible', () => {
    renderWorkspace();
    expect(screen.getByText('mode-toggle')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /reader/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the Context tab when tapped', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    expect(screen.getByRole('tab', { name: /context/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the full-focus editor (no toggle, no tab bar) when a note is active', () => {
    activeNote = { id: 'n1' };
    renderWorkspace();
    expect(screen.getByText('editor-back')).toBeInTheDocument();
    expect(screen.queryByText('mode-toggle')).toBeNull();
    expect(screen.queryByRole('tab', { name: /reader/i })).toBeNull();
    fireEvent.click(screen.getByText('editor-back'));
    expect(openNote).toHaveBeenCalledWith(null);
  });
});
