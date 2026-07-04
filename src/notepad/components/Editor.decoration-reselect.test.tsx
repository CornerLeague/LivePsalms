// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom has no ResizeObserver; DecorationLayer constructs one on mount and (in
// jsdom, where getBoundingClientRect().width is 0) relies on the first non-zero
// ResizeObserver tick to seed contentWidth. So our stub must INVOKE its callback
// with a sized contentRect — otherwise contentWidth stays 0 and hitTestBehind
// always returns null, making the double-tap path impossible to exercise.
vi.stubGlobal('ResizeObserver', class {
  cb: (entries: Array<{ contentRect: { width: number } }>) => void;
  constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
    this.cb = cb;
  }
  observe() { this.cb([{ contentRect: { width: 600 } }]); }
  unobserve() {}
  disconnect() {}
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
vi.mock('../styles/manifest', () => ({
  STYLE_ASSETS: [],
  getStyleAsset: (id: string) => ({ id, category: 'arrow', thumbUrl: 't', displayUrl: `/d/${id}.webp`, aspectRatio: 2 }),
}));
// ONE decoration sitting BEHIND the text. Its body island is covered by the
// text layer, so it is NOT tap-selectable — only the select-behind path reaches
// it. With contentWidth=600 its box is x:[240,360], y:[80,140] (aspectRatio 2).
const deco = { id: 'dec1', assetId: 'arrow-01', xPct: 0.4, yPx: 80, widthPct: 0.2, rotation: 0, z: 1, behindText: true };
vi.mock('../decorations/useDecorations', () => ({
  useDecorations: () => ({
    decorations: [deco],
    add: vi.fn(), update: vi.fn(), remove: vi.fn(), duplicate: vi.fn(),
    bringToFront: vi.fn(), sendToBack: vi.fn(),
  }),
}));

import { NotepadEditor } from './Editor';

afterEach(cleanup);

describe('NotepadEditor behind-text decoration re-select (mobile)', () => {
  it('double-tap on the editor content selects the topmost behind-text decoration under the tap', () => {
    const { getByTestId, queryByTestId } = render(
      <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={120} />,
    );

    // getBoundingClientRect of the decoration-canvas drives hitTestBehind's
    // origin; pin it to (0,0) so canvas px == client px in this test.
    const canvas = getByTestId('decoration-canvas');
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;

    // The editor content div is the parent of EditorContent's stub; the click
    // handler that owns the double-tap detector lives there.
    const content = getByTestId('editor-content').parentElement!;

    expect(queryByTestId('decoration-toolbar')).toBeNull();

    // Tap point (250,100) is inside the behind-text box x:[240,360] y:[80,140].
    const tap = { clientX: 250, clientY: 100 };
    // First tap: nothing selected (records the tap for double-tap detection).
    fireEvent.click(content, tap);
    expect(queryByTestId('decoration-toolbar')).toBeNull();
    // Second tap shortly after, same point: detected as a double-tap → selects
    // the behind-text decoration → decoration toolbar swaps in.
    fireEvent.click(content, tap);

    expect(getByTestId('decoration-toolbar')).not.toBeNull();
  });
});
