// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom has no ResizeObserver; DecorationLayer constructs one on mount.
vi.stubGlobal('ResizeObserver', class {
  observe() {} unobserve() {} disconnect() {}
});

// Minimal context + editor mocks so NotepadEditor renders, mirroring the
// harness in Editor.decoration-toolbar.test.tsx.
const fakeEditor = {
  chain: () => ({ focus: () => ({ undo: () => ({ run() {} }), redo: () => ({ run() {} }), run() {} }) }),
  can: () => ({ undo: () => true, redo: () => true }),
  isActive: () => false,
  commands: { focus: vi.fn() },
  on: vi.fn(),
  off: vi.fn(),
  state: { selection: { from: 0, to: 0 } },
  view: { coordsAtPos: () => ({ top: 0, bottom: 0, left: 0 }) },
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
// The decoration body renders an <img> only when getStyleAsset returns an asset,
// so provide one for any id (DecorationItem early-returns null otherwise).
vi.mock('../styles/manifest', () => ({
  STYLE_ASSETS: [],
  getStyleAsset: (id: string) => ({ id, category: 'arrow', thumbUrl: 't', displayUrl: `/d/${id}.webp`, aspectRatio: 2 }),
}));
// ONE in-front decoration (z:1, no behindText).
const deco = { id: 'dec1', assetId: 'arrow-01', xPct: 0.4, yPx: 80, widthPct: 0.2, rotation: 0, z: 1 };
vi.mock('../decorations/useDecorations', () => ({
  useDecorations: () => ({
    decorations: [deco],
    add: vi.fn(), update: vi.fn(), remove: vi.fn(), duplicate: vi.fn(),
    bringToFront: vi.fn(), sendToBack: vi.fn(),
  }),
}));

import { NotepadEditor } from './Editor';

afterEach(cleanup);

// The editor content <div> owns the onClick that deselects decorations; it wraps
// the EditorContent stub (data-testid="editor-content"). Select it as that stub's
// parent element.
function getEditorContentEl(container: HTMLElement): HTMLElement {
  const inner = container.querySelector('[data-testid="editor-content"]');
  if (!inner || !inner.parentElement) throw new Error('editor content element not found');
  return inner.parentElement;
}

describe('NotepadEditor mobile tap-selection persistence', () => {
  it('keeps an in-front decoration selected through the trailing synthesized click', () => {
    const { getByTestId, queryByTestId, container } = render(
      <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={120} />,
    );

    // Tap the decoration body → onSelect fires, toolbar swaps in.
    fireEvent.pointerDown(getByTestId('decoration-body-dec1'), { clientX: 250, clientY: 100, pointerId: 1 });
    expect(getByTestId('decoration-toolbar')).not.toBeNull();

    // The browser then fires a synthesized click on the editor content (the island
    // is now pointerEvents:none). Without the guard this deselects; with it, the
    // selection survives.
    fireEvent.click(getEditorContentEl(container), { clientX: 250, clientY: 100 });

    expect(queryByTestId('decoration-toolbar')).not.toBeNull();
  });

  it('consumes only the one trailing click — a subsequent click deselects normally', () => {
    const { getByTestId, queryByTestId, container } = render(
      <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={120} />,
    );

    fireEvent.pointerDown(getByTestId('decoration-body-dec1'), { clientX: 250, clientY: 100, pointerId: 1 });
    expect(getByTestId('decoration-toolbar')).not.toBeNull();

    // First (trailing synthesized) click is swallowed → selection survives.
    fireEvent.click(getEditorContentEl(container), { clientX: 250, clientY: 100 });
    expect(queryByTestId('decoration-toolbar')).not.toBeNull();

    // A genuine SECOND click on empty editor space now deselects (guard consumed).
    fireEvent.click(getEditorContentEl(container), { clientX: 250, clientY: 100 });
    expect(queryByTestId('decoration-toolbar')).toBeNull();
  });
});
