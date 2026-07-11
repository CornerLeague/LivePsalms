// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// Stable spy so we can assert the verse handler fires on tap.
const verseSpies = vi.hoisted(() => ({ onMouseOver: vi.fn() }));
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
vi.mock('../bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('../editor/use-note-editor', () => ({ useNoteEditor: () => ({ editor: fakeEditor }) }));
vi.mock('../editor/use-note-link-popup', () => ({
  useNoteLinkPopup: () => ({ popup: null, search: '', setSearch: vi.fn(), filteredNotes: [], dismiss: vi.fn(), insert: vi.fn() }),
}));
vi.mock('../editor/use-verse-tooltip', () => ({
  useVerseTooltip: () => ({ tooltip: null, onMouseOver: verseSpies.onMouseOver, onMouseOut: vi.fn() }),
}));
vi.mock('@tiptap/react', () => ({ EditorContent: () => <div data-testid="editor-content" /> }));
vi.mock('../../auth/context/useAccountProfile', () => ({
  useAccountProfile: () => ({ profile: null }),
}));
vi.mock('../recordings/RecordingsStrip', () => ({ RecordingsStrip: () => null }));

import { NotepadEditor } from './Editor';

beforeEach(() => verseSpies.onMouseOver.mockClear());
afterEach(cleanup);

describe('NotepadEditor toolbarPlacement', () => {
  it('defaults to top placement', () => {
    const { container } = render(<NotepadEditor />);
    const bar = container.querySelector('[data-toolbar-placement]');
    expect(bar?.getAttribute('data-toolbar-placement')).toBe('top');
  });

  it('renders a bottom-pinned toolbar when toolbarPlacement="bottom"', () => {
    const { container } = render(<NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={120} />);
    const bar = container.querySelector('[data-toolbar-placement]') as HTMLElement;
    expect(bar.getAttribute('data-toolbar-placement')).toBe('bottom');
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.bottom).toBe('120px');
  });

  it('lifts the bottom toolbar above the dock clearance when showBottomDock is set', () => {
    const { container } = render(
      <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={0} showBottomDock />,
    );
    const toolbar = container.querySelector('[data-toolbar-placement="bottom"]') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.style.bottom).toContain('--mobile-dock-clearance');
    expect(toolbar.style.bottom).toContain('max(');
  });

  it('does NOT fire the verse handler on content tap in top placement (desktop unchanged)', () => {
    const { getByTestId } = render(<NotepadEditor />);
    fireEvent.click(getByTestId('editor-content').parentElement as HTMLElement);
    expect(verseSpies.onMouseOver).not.toHaveBeenCalled();
  });

  it('fires the verse handler on content tap in bottom placement (mobile tap tooltip)', () => {
    const { getByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);
    fireEvent.click(getByTestId('editor-content').parentElement as HTMLElement);
    expect(verseSpies.onMouseOver).toHaveBeenCalled();
  });
});
