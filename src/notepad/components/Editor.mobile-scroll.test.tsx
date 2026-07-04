// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Complete editor mock — includes on/off (the stale toolbar-placement mock omits these).
const fakeEditor = {
  on: () => {},
  off: () => {},
  chain: () => ({
    focus: () => ({
      undo: () => ({ run() {} }),
      redo: () => ({ run() {} }),
      toggleHeading: () => ({ run() {} }),
      setParagraph: () => ({ run() {} }),
    }),
  }),
  can: () => ({ undo: () => true, redo: () => true }),
  isActive: () => false,
  commands: { focus: () => {} },
};
vi.mock('../context/useNoteCollection', () => ({
  useNoteCollection: () => ({
    notes: [],
    activeNote: { id: 'n1', title: 'T', createdAt: new Date().toISOString(), tags: [] },
    collection: { openNote: vi.fn() },
  }),
}));
vi.mock('../context/useNotepadActions', () => ({ useNotepadActions: () => ({ updateNote: vi.fn() }) }));
vi.mock('../context/useReferenceGraph', () => ({ useReferenceGraph: () => ({ graph: null }) }));
vi.mock('../bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('../editor/use-note-editor', () => ({ useNoteEditor: () => ({ editor: fakeEditor }) }));
vi.mock('../editor/use-note-link-popup', () => ({
  useNoteLinkPopup: () => ({ popup: null, search: '', setSearch: vi.fn(), filteredNotes: [], dismiss: vi.fn(), insert: vi.fn() }),
}));
vi.mock('../editor/use-verse-tooltip', () => ({
  useVerseTooltip: () => ({ tooltip: null, onMouseOver: vi.fn(), onMouseOut: vi.fn() }),
}));
vi.mock('@tiptap/react', () => ({ EditorContent: () => <div data-testid="editor-content" /> }));
vi.mock('../../auth/context/useAccountProfile', () => ({ useAccountProfile: () => ({ profile: null }) }));
vi.mock('../recordings/RecordingsStrip', () => ({ RecordingsStrip: () => null }));
vi.mock('../decorations/DecorationLayer', () => ({ DecorationLayer: () => null }));
vi.mock('../decorations/useDecorations', () => ({ useDecorations: () => ({ decorations: [], applyDecoration: vi.fn() }) }));
vi.mock('../decorations/DecorationTray', () => ({ DecorationTray: () => null }));
vi.mock('./HighlightSwatchPopover', () => ({ HighlightSwatchPopover: () => null }));

import { NotepadEditor } from './Editor';

afterEach(cleanup);

describe('NotepadEditor mobile toolbar scroll', () => {
  it('makes the bottom toolbar horizontally scrollable', () => {
    const { container } = render(<NotepadEditor toolbarPlacement="bottom" />);
    const bar = container.querySelector('[data-toolbar-placement="bottom"]') as HTMLElement;
    expect(bar.style.overflowX).toBe('auto');
    // Horizontal-only: overflow-y pinned to hidden so the toolbar can't scroll/clip vertically.
    expect(bar.style.overflowY).toBe('hidden');
    expect(bar.style.minWidth).toBe('0px');
    expect(bar.className).toContain('scrollbar-hide');
  });

  it('does NOT add horizontal scroll to the top (desktop) toolbar', () => {
    const { container } = render(<NotepadEditor />);
    const bar = container.querySelector('[data-toolbar-placement="top"]') as HTMLElement;
    expect(bar.style.overflowX).toBe('');
    expect(bar.className).not.toContain('scrollbar-hide');
  });

  it('clamps the writing pad to vertical-only scroll with tighter padding on mobile', () => {
    const { container, getByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);
    const scroll = getByTestId('editor-scroll') as HTMLElement;
    expect(scroll.style.overflowY).toBe('auto');
    expect(scroll.style.overflowX).toBe('hidden');
    expect(scroll.style.padding).toBe('2rem 1.25rem');
    // Editor column is clamped so the wide toolbar can't push it past the viewport.
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.minWidth).toBe('0px');
    expect(root.style.maxWidth).toBe('100%');
  });

  it('keeps the desktop writing pad padding and no horizontal clamp', () => {
    const { getByTestId } = render(<NotepadEditor />);
    const scroll = getByTestId('editor-scroll') as HTMLElement;
    expect(scroll.style.padding).toBe('2rem 2.5rem');
    expect(scroll.style.overflowX).toBe('');
  });

  it('portals the heading dropdown out of the toolbar on mobile', () => {
    const { container } = render(<NotepadEditor toolbarPlacement="bottom" />);
    const bar = container.querySelector('[data-toolbar-placement="bottom"]') as HTMLElement;
    fireEvent.click(bar.querySelector('[title="Heading"]') as HTMLElement);
    const menu = document.querySelector('[data-testid="heading-menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    // Escapes the scroll-clipping toolbar.
    expect(bar.contains(menu)).toBe(false);
  });

  it('keeps the heading dropdown inline inside the desktop toolbar', () => {
    const { container } = render(<NotepadEditor />);
    const bar = container.querySelector('[data-toolbar-placement="top"]') as HTMLElement;
    fireEvent.click(bar.querySelector('[title="Heading"]') as HTMLElement);
    const menu = document.querySelector('[data-testid="heading-menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(bar.contains(menu)).toBe(true);
  });
});
