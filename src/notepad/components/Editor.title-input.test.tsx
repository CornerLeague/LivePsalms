// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom has no ResizeObserver; DecorationLayer (rendered inside the editor) needs it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

// Mutable holder so each test can control the active note + the updateNote spy.
const state = vi.hoisted(() => ({
  activeNote: {
    id: 'n1',
    title: 'Alpha',
    content: '',
    folderId: 'root',
    type: 'general',
    tags: [] as string[],
    wordCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  // Default to a never-resolving save: proves the visible value is decoupled
  // from the async persistence (the mobile typing-lag root cause).
  updateNote: vi.fn((): Promise<unknown> => new Promise(() => {})),
}));

const fakeEditor = {
  chain: () => ({ focus: () => ({ undo: () => ({ run() {} }), redo: () => ({ run() {} }) }) }),
  can: () => ({ undo: () => true, redo: () => true }),
  isActive: () => false,
  on: () => {},
  off: () => {},
};

vi.mock('../context/useNoteCollection', () => ({
  useNoteCollection: () => ({
    notes: [],
    activeNote: state.activeNote,
    collection: { openNote: vi.fn() },
  }),
}));
vi.mock('../context/useNotepadActions', () => ({
  useNotepadActions: () => ({ updateNote: state.updateNote }),
}));
vi.mock('../context/useReferenceGraph', () => ({ useReferenceGraph: () => ({ graph: null }) }));
vi.mock('../editor/use-note-editor', () => ({ useNoteEditor: () => ({ editor: fakeEditor }) }));
vi.mock('../editor/use-note-link-popup', () => ({
  useNoteLinkPopup: () => ({ popup: null, search: '', setSearch: vi.fn(), filteredNotes: [], dismiss: vi.fn(), insert: vi.fn() }),
}));
vi.mock('../editor/use-verse-tooltip', () => ({
  useVerseTooltip: () => ({ tooltip: null, onMouseOver: vi.fn(), onMouseOut: vi.fn() }),
}));
vi.mock('../bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('@tiptap/react', () => ({ EditorContent: () => <div data-testid="editor-content" /> }));
vi.mock('../../auth/context/useAccountProfile', () => ({ useAccountProfile: () => ({ profile: null }) }));
vi.mock('../recordings/RecordingsStrip', () => ({ RecordingsStrip: () => null }));

import { NotepadEditor } from './Editor';

afterEach(() => {
  cleanup();
  state.updateNote.mockClear();
});

function titleField(container: HTMLElement): HTMLTextAreaElement {
  return container.querySelector('textarea[placeholder="Untitled"]') as HTMLTextAreaElement;
}

describe('NotepadEditor title input', () => {
  it('disables the disruptive mobile keyboard features on the title', () => {
    const { container } = render(<NotepadEditor />);
    const title = titleField(container);
    expect(title.getAttribute('autocorrect')).toBe('off');
    expect(title.getAttribute('spellcheck')).toBe('false');
    expect(title.getAttribute('autocapitalize')).toBe('sentences');
  });

  it('shows typed characters immediately, even while the save is still pending', () => {
    const { container } = render(<NotepadEditor />);
    const title = titleField(container);

    fireEvent.change(title, { target: { value: 'Alpha Beta' } });

    // updateNote is the never-resolving mock; the field must still reflect input.
    expect(title.value).toBe('Alpha Beta');
  });

  it('debounces persistence — no save fires on the keystroke itself', () => {
    const { container } = render(<NotepadEditor />);
    const title = titleField(container);

    fireEvent.change(title, { target: { value: 'Alpha Beta' } });

    expect(state.updateNote).not.toHaveBeenCalled();
  });

  it('flushes the pending title save on blur', () => {
    const { container } = render(<NotepadEditor />);
    const title = titleField(container);

    fireEvent.change(title, { target: { value: 'Committed' } });
    fireEvent.blur(title);

    expect(state.updateNote).toHaveBeenCalledTimes(1);
    expect(state.updateNote).toHaveBeenCalledWith('n1', { title: 'Committed' });
  });
});
