// @vitest-environment jsdom
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Editor mock that captures event handlers so tests can drive selectionUpdate,
// and exposes a mutable selection. coordsAtPos drives pill positioning.
const handlers: Record<string, Array<() => void>> = {};
const setStyleHighlight = vi.fn(() => ({ run() {} }));
const unsetStyleHighlight = vi.fn(() => ({ run() {} }));
// Mutable coords — mutate fields in-place so the formatter can't turn `let` into `const`.
const coords = { top: 200, bottom: 220, left: 30, right: 40 };
function resetCoords() {
  coords.top = 200;
  coords.bottom = 220;
  coords.left = 30;
  coords.right = 40;
}
const fakeEditor = {
  state: { selection: { from: 0, to: 0 } },
  view: { coordsAtPos: () => coords },
  on: (event: string, cb: () => void) => {
    (handlers[event] ||= []).push(cb);
  },
  off: (event: string, cb: () => void) => {
    handlers[event] = (handlers[event] || []).filter((h) => h !== cb);
  },
  chain: () => ({
    focus: () => ({
      setStyleHighlight, unsetStyleHighlight,
      undo: () => ({ run() {} }), redo: () => ({ run() {} }),
      toggleHeading: () => ({ run() {} }), setParagraph: () => ({ run() {} }),
    }),
  }),
  can: () => ({ undo: () => true, redo: () => true }),
  isActive: () => false,
  commands: { focus: () => {} },
};

function fireSelection(from: number, to: number) {
  fakeEditor.state.selection = { from, to };
  // React 19 only flushes state updates triggered inside act(); the editor's
  // selectionUpdate listener is invoked directly here, so wrap it.
  act(() => {
    (handlers.selectionUpdate || []).forEach((h) => h());
  });
}

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
vi.mock('./HighlightSwatchPopover', () => ({ HighlightSwatchPopover: () => <div data-testid="swatch-popover" /> }));
// Render a visible, interactive marker so the pill's presence + pick/remove are assertable.
// The anchor prop is exposed via data attributes so tests can assert which branch was taken.
vi.mock('./HighlightPill', () => ({
  HighlightPill: ({
    anchor,
    onPick,
    onRemove,
  }: {
    anchor: { top?: number; bottom?: number; left: number };
    onPick: (id: string) => void;
    onRemove: () => void;
  }) => (
    <div
      data-testid="highlight-pill"
      data-anchor-top={anchor.top ?? ''}
      data-anchor-bottom={anchor.bottom ?? ''}
      data-anchor-left={anchor.left}
    >
      <button data-testid="pill-swatch" onClick={() => onPick('highlight-01')}>
        pick
      </button>
      <button data-testid="pill-remove" onClick={onRemove}>
        remove
      </button>
    </div>
  ),
}));

import { NotepadEditor } from './Editor';

afterEach(() => {
  cleanup();
  setStyleHighlight.mockClear();
  unsetStyleHighlight.mockClear();
  vi.useRealTimers();
  resetCoords();
});

describe('NotepadEditor mobile highlight pill', () => {
  it('does NOT show the pill immediately on selection; shows it after the settle debounce', () => {
    vi.useFakeTimers();
    const { queryByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);
    fireSelection(2, 8);
    expect(queryByTestId('highlight-pill')).toBeNull(); // not yet — still "moving"
    act(() => { vi.advanceTimersByTime(250); });
    expect(queryByTestId('highlight-pill')).not.toBeNull(); // settled
  });

  it('hides the pill when the selection collapses', () => {
    vi.useFakeTimers();
    const { queryByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);
    fireSelection(2, 8);
    act(() => { vi.advanceTimersByTime(250); });
    expect(queryByTestId('highlight-pill')).not.toBeNull();
    fireSelection(5, 5);
    expect(queryByTestId('highlight-pill')).toBeNull();
  });

  it('applies a highlight via setStyleHighlight when a pill swatch is tapped', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);
    fireSelection(2, 8);
    act(() => { vi.advanceTimersByTime(250); });
    act(() => { fireEvent.click(getByTestId('pill-swatch')); });
    expect(setStyleHighlight).toHaveBeenCalledWith('highlight-01');
  });

  it('removes a highlight via unsetStyleHighlight when the pill remove chip is tapped', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);
    fireSelection(2, 8);
    act(() => { vi.advanceTimersByTime(250); });
    act(() => { fireEvent.click(getByTestId('pill-remove')); });
    expect(unsetStyleHighlight).toHaveBeenCalled();
  });

  it('renders no Highlight toolbar button on mobile', () => {
    const { container } = render(<NotepadEditor toolbarPlacement="bottom" />);
    expect(container.querySelector('[title="Highlight"]')).toBeNull();
  });

  it('does not show the pill on desktop and keeps the auto-open popover', () => {
    const { queryByTestId } = render(<NotepadEditor />);
    fireSelection(2, 8);
    expect(queryByTestId('highlight-pill')).toBeNull();
    expect(queryByTestId('swatch-popover')).not.toBeNull(); // desktop unchanged
  });

  it('anchors the pill above by default and flips below when the selection is near the top', () => {
    vi.useFakeTimers();
    const { getByTestId, queryByTestId } = render(<NotepadEditor toolbarPlacement="bottom" />);

    // Default coords (top: 200, well above PILL_TOP_MARGIN=56) → pill anchored ABOVE
    // (bottom set, no top).
    fireSelection(2, 8);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const above = getByTestId('highlight-pill');
    expect(above.dataset.anchorBottom).not.toBe('');
    expect(above.dataset.anchorTop).toBe('');

    // Near the top of the viewport (top < 56) → pill flips BELOW (top set, no bottom).
    coords.top = 10;
    coords.bottom = 30;
    // Use a different range so the unchanged-range no-op guard doesn't skip it.
    fireSelection(3, 9);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const below = getByTestId('highlight-pill');
    expect(below.dataset.anchorTop).not.toBe('');
    expect(below.dataset.anchorBottom).toBe('');
    expect(queryByTestId('highlight-pill')).not.toBeNull();
  });
});
