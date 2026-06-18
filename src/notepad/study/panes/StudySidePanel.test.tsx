// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/notepad/components/Editor', () => ({ NotepadEditor: () => <div>editor</div> }));
vi.mock('./LamplightStudyPanel', () => ({ LamplightStudyPanel: () => <div>chat-panel</div> }));

const createNote = vi.fn();
let activeNote: { id: string; title: string } | null = { id: 'n1', title: 'X' };
vi.mock('@/notepad/context/useNoteCollection', () => ({
  useNoteCollection: () => ({ activeNote, collection: { createNote } }),
}));

import { StudySidePanel } from './StudySidePanel';

beforeEach(() => {
  vi.clearAllMocks();
  activeNote = { id: 'n1', title: 'X' };
});
afterEach(cleanup);

describe('StudySidePanel', () => {
  it('defaults to the Notes tab and renders the editor when a note is active', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />);
    expect(screen.getByRole('tab', { name: /notes/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /chat/i }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('editor')).toBeTruthy();
  });

  it('switches to the Chat tab on click', () => {
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('tab', { name: /chat/i }));
    expect(screen.getByRole('tab', { name: /chat/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /notes/i }).getAttribute('aria-selected')).toBe('false');
  });

  it('offers a New note button that creates + activates a note when none is open', () => {
    activeNote = null;
    render(<StudySidePanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /new note/i }));
    expect(createNote).toHaveBeenCalledWith('root', 'general');
  });
});
