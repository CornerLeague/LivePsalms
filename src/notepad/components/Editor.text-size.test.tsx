// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CSSProperties } from 'react';

// jsdom has no ResizeObserver; DecorationLayer (rendered inside the editor) needs it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

// Minimal context + editor mocks so NotepadEditor renders its toolbar.
const fakeEditor = {
  chain: () => ({ focus: () => ({ undo: () => ({ run() {} }), redo: () => ({ run() {} }) }) }),
  can: () => ({ undo: () => true, redo: () => true }),
  isActive: () => false,
  on: () => {},
  off: () => {},
};

const setLocalTextSize = vi.fn();
// Mutable so individual tests can drive the "current" pref value returned by the mock.
const biblePrefs = vi.hoisted(() => ({ textSize: 'base' as string }));

vi.mock('../context/useNoteCollection', () => ({
  useNoteCollection: () => ({
    notes: [],
    activeNote: { id: 'n1', title: 'T', createdAt: new Date().toISOString(), tags: [] },
    collection: { openNote: vi.fn() },
  }),
}));
vi.mock('../context/useNotepadActions', () => ({
  useNotepadActions: () => ({ updateNote: vi.fn() }),
}));
vi.mock('../context/useReferenceGraph', () => ({ useReferenceGraph: () => ({ graph: null }) }));
vi.mock('../bible/prefs/bible-prefs-context', () => ({
  useBiblePrefs: () => ({ translation: 'BSB', textSize: biblePrefs.textSize, setLocalTextSize }),
}));
vi.mock('../editor/use-note-editor', () => ({ useNoteEditor: () => ({ editor: fakeEditor }) }));
vi.mock('../editor/use-note-link-popup', () => ({
  useNoteLinkPopup: () => ({ popup: null, search: '', setSearch: vi.fn(), filteredNotes: [], dismiss: vi.fn(), insert: vi.fn() }),
}));
vi.mock('../editor/use-verse-tooltip', () => ({
  useVerseTooltip: () => ({ tooltip: null, onMouseOver: vi.fn(), onMouseOut: vi.fn() }),
}));
// Forward style/className so the test can inspect the --editor-font-scale var.
vi.mock('@tiptap/react', () => ({
  EditorContent: ({ className, style }: { className?: string; style?: CSSProperties }) => (
    <div data-testid="editor-content" className={className} style={style} />
  ),
}));
vi.mock('../../auth/context/useAccountProfile', () => ({
  useAccountProfile: () => ({ profile: null }),
}));
vi.mock('../recordings/RecordingsStrip', () => ({ RecordingsStrip: () => null }));

import { NotepadEditor } from './Editor';

afterEach(() => {
  cleanup();
  setLocalTextSize.mockClear();
  biblePrefs.textSize = 'base';
});

describe('NotepadEditor text size control', () => {
  it('shows the base "A" glyph and a 1x --editor-font-scale by default', () => {
    render(<NotepadEditor />);
    expect(screen.getByLabelText('Text size')).toHaveTextContent('A');
    const content = screen.getByTestId('editor-content') as HTMLElement;
    expect(content.style.getPropertyValue('--editor-font-scale')).toBe('1');
  });

  it('cycles base -> large on click and reports the change', () => {
    render(<NotepadEditor />);
    fireEvent.click(screen.getByLabelText('Text size'));
    expect(setLocalTextSize).toHaveBeenCalledWith('large');
  });

  it('scales --editor-font-scale up at xlarge', () => {
    biblePrefs.textSize = 'xlarge';
    render(<NotepadEditor />);
    expect(screen.getByLabelText('Text size')).toHaveTextContent('A++');
    const content = screen.getByTestId('editor-content') as HTMLElement;
    expect(content.style.getPropertyValue('--editor-font-scale')).toBe('1.3');
  });
});
