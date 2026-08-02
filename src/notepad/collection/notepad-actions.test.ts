import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NoteCollection } from './note-collection';
import { FolderHierarchy } from './folder-hierarchy';
import { NotepadActions } from './notepad-actions';
import { FakeStorageAdapter, resetFakeAdapterIds } from './fake-storage-adapter';
import { ReferenceGraph } from '../graph/reference-graph';
import { createInMemoryStorage } from '../graph/in-memory-storage';
import { createInMemoryVerseFetcher } from '../graph/in-memory-verse-fetcher';

function seedNote(adapter: FakeStorageAdapter, id: string, folderId: string) {
  adapter.notes.push({
    id, title: id, content: '', folderId, type: 'devotion', tags: [], wordCount: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
}

function seedFolder(adapter: FakeStorageAdapter, id: string) {
  adapter.folders.push({ id, name: id, parentId: null, order: adapter.folders.length });
}

describe('NotepadActions', () => {
  let adapter: FakeStorageAdapter;
  let notes: NoteCollection;
  let folders: FolderHierarchy;
  let referenceGraph: ReferenceGraph;
  let actions: NotepadActions;

  beforeEach(() => {
    resetFakeAdapterIds();
    adapter = new FakeStorageAdapter();
    notes = new NoteCollection(adapter);
    folders = new FolderHierarchy(adapter);
    referenceGraph = new ReferenceGraph(createInMemoryVerseFetcher({}), createInMemoryStorage());
    actions = new NotepadActions(adapter, notes, folders, referenceGraph);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('init cascades to both modules', async () => {
    seedNote(adapter, 'n1', 'root');
    seedFolder(adapter, 'f1');
    await actions.init();
    expect(notes.getSnapshot().notes.map((n) => n.id)).toEqual(['n1']);
    expect(folders.getSnapshot().folders.map((f) => f.id)).toEqual(['f1']);
  });

  it('deleteFolder reparents child notes to root and removes the folder', async () => {
    seedFolder(adapter, 'f1');
    seedNote(adapter, 'a', 'f1');
    seedNote(adapter, 'b', 'f1');
    seedNote(adapter, 'c', 'root');
    await actions.init();

    await actions.deleteFolder('f1');

    expect(folders.getSnapshot().folders.map((f) => f.id)).toEqual([]);
    const notesAfter = notes.getSnapshot().notes;
    expect(notesAfter.find((n) => n.id === 'a')?.folderId).toBe('root');
    expect(notesAfter.find((n) => n.id === 'b')?.folderId).toBe('root');
    expect(notesAfter.find((n) => n.id === 'c')?.folderId).toBe('root');
  });

  it('deleteFolder computes affected ids BEFORE deleting the folder', async () => {
    seedFolder(adapter, 'f1');
    seedNote(adapter, 'a', 'f1');
    await actions.init();

    await actions.deleteFolder('f1');

    expect(notes.getSnapshot().notes.find((n) => n.id === 'a')?.folderId).toBe('root');
  });

  it('importNotes preserves ids via adapter.importNote and refetches', async () => {
    await actions.init();
    await actions.importNotes([
      { id: 'imp-x', title: 'X', content: '', folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'imp-y', title: 'Y', content: '', folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    const result = notes.getSnapshot().notes;
    expect(result.map((n) => n.title)).toEqual(['X', 'Y']);
    expect(result.map((n) => n.id)).toEqual(['imp-x', 'imp-y']);
  });

  it('rebindAdapter rebinds both modules and re-inits', async () => {
    seedNote(adapter, 'old', 'root');
    await actions.init();
    expect(notes.getSnapshot().notes.map((n) => n.id)).toEqual(['old']);

    const next = new FakeStorageAdapter();
    seedNote(next, 'new', 'root');
    await actions.rebindAdapter(next);

    expect(notes.getSnapshot().notes.map((n) => n.id)).toEqual(['new']);
  });

  // ---------------------------------------------------------------------------
  describe('updateNote', () => {
    it('triggers referenceGraph.syncNote when content is updated', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const syncSpy = vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      await actions.updateNote('n1', { content: '{"type":"doc"}' });

      expect(syncSpy).toHaveBeenCalledTimes(1);
      expect(syncSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }));
    });

    it('does NOT trigger referenceGraph.syncNote when only title is updated', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const syncSpy = vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      await actions.updateNote('n1', { title: 'New Title' });

      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('does NOT trigger referenceGraph.syncNote when only folderId is updated', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const syncSpy = vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      await actions.updateNote('n1', { folderId: 'other-folder' });

      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('does NOT trigger referenceGraph.syncNote when only tags are updated', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const syncSpy = vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      await actions.updateNote('n1', { tags: ['faith'] });

      expect(syncSpy).not.toHaveBeenCalled();
    });

    it('triggers referenceGraph.syncNote when content is updated alongside other fields', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const syncSpy = vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      await actions.updateNote('n1', { content: '{"type":"doc"}', title: 'Updated Title' });

      expect(syncSpy).toHaveBeenCalledTimes(1);
    });

    it('triggers referenceGraph.syncNote even when content is an empty string', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const syncSpy = vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      await actions.updateNote('n1', { content: '' });

      // content !== undefined is true for '', so sync IS triggered
      expect(syncSpy).toHaveBeenCalledTimes(1);
    });

    it('returns the updated note', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      vi.spyOn(referenceGraph, 'syncNote').mockResolvedValue(undefined);

      const result = await actions.updateNote('n1', { title: 'Fresh Title' });

      expect(result.id).toBe('n1');
      expect(result.title).toBe('Fresh Title');
    });
  });

  // ---------------------------------------------------------------------------
  describe('deleteNote', () => {
    it('triggers referenceGraph.deleteReferencesFor with the note id', async () => {
      seedNote(adapter, 'n1', 'root');
      await actions.init();

      const deleteSpy = vi.spyOn(referenceGraph, 'deleteReferencesFor');

      await actions.deleteNote('n1');

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith('n1');
    });

    it('removes the note from the collection after deletion', async () => {
      seedNote(adapter, 'n1', 'root');
      seedNote(adapter, 'n2', 'root');
      await actions.init();

      vi.spyOn(referenceGraph, 'deleteReferencesFor');

      await actions.deleteNote('n1');

      expect(notes.getSnapshot().notes.map((n) => n.id)).not.toContain('n1');
      expect(notes.getSnapshot().notes.map((n) => n.id)).toContain('n2');
    });
  });

  // ---------------------------------------------------------------------------
  describe('init', () => {
    it('does NOT call repairNoteLinks when the notes array is empty', async () => {
      // No notes seeded — notes list will be empty after notes.init()
      const repairSpy = vi.spyOn(referenceGraph, 'repairNoteLinks').mockReturnValue({
        rewires: [], rewiredLinks: 0, orphans: 0,
      });

      await actions.init();

      expect(repairSpy).not.toHaveBeenCalled();
    });

    it('calls repairNoteLinks before referenceGraph.init when notes exist (no rewires)', async () => {
      seedNote(adapter, 'n1', 'root');

      const callOrder: string[] = [];

      const repairSpy = vi.spyOn(referenceGraph, 'repairNoteLinks').mockImplementation(() => {
        callOrder.push('repair');
        return { rewires: [], rewiredLinks: 0, orphans: 0 };
      });

      const graphInitSpy = vi.spyOn(referenceGraph, 'init').mockImplementation(async () => {
        callOrder.push('graphInit');
      });

      await actions.init();

      expect(repairSpy).toHaveBeenCalledTimes(1);
      expect(graphInitSpy).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['repair', 'graphInit']);
    });

    it('does NOT call notes.updateNote when repairNoteLinks returns no rewires', async () => {
      seedNote(adapter, 'n1', 'root');
      // A genuine user folder makes the one-time type-folder backfill back off,
      // so the only updateNote calls in scope are the repair pass's (here: none).
      seedFolder(adapter, 'f1');

      vi.spyOn(referenceGraph, 'repairNoteLinks').mockReturnValue({
        rewires: [], rewiredLinks: 0, orphans: 0,
      });
      vi.spyOn(referenceGraph, 'init').mockResolvedValue(undefined);

      const updateSpy = vi.spyOn(notes, 'updateNote');

      await actions.init();

      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('persists each rewire through notes.updateNote when repairNoteLinks returns rewires', async () => {
      seedNote(adapter, 'n1', 'root');
      seedNote(adapter, 'n2', 'root');
      // A genuine user folder makes the one-time type-folder backfill back off,
      // isolating the two rewire-driven updateNote calls asserted below.
      seedFolder(adapter, 'f1');

      vi.spyOn(referenceGraph, 'repairNoteLinks').mockReturnValue({
        rewires: [
          { noteId: 'n1', content: '{"new":"a"}' },
          { noteId: 'n2', content: '{"new":"b"}' },
        ],
        rewiredLinks: 3,
        orphans: 0,
      });
      vi.spyOn(referenceGraph, 'init').mockResolvedValue(undefined);

      const updateSpy = vi.spyOn(notes, 'updateNote');

      await actions.init();

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy).toHaveBeenNthCalledWith(1, 'n1', { content: '{"new":"a"}' });
      expect(updateSpy).toHaveBeenNthCalledWith(2, 'n2', { content: '{"new":"b"}' });
    });

    it('calls referenceGraph.init with the current note list', async () => {
      seedNote(adapter, 'n1', 'root');
      seedNote(adapter, 'n2', 'root');

      vi.spyOn(referenceGraph, 'repairNoteLinks').mockReturnValue({
        rewires: [], rewiredLinks: 0, orphans: 0,
      });

      const graphInitSpy = vi.spyOn(referenceGraph, 'init').mockResolvedValue(undefined);

      await actions.init();

      expect(graphInitSpy).toHaveBeenCalledTimes(1);
      const passedNotes = graphInitSpy.mock.calls[0][0];
      expect(passedNotes.map((n: { id: string }) => n.id)).toEqual(['n1', 'n2']);
    });
  });

  // ---------------------------------------------------------------------------
  describe('importNotes', () => {
    it('calls referenceGraph.syncAll after the bulk insert', async () => {
      await actions.init();

      const syncAllSpy = vi.spyOn(referenceGraph, 'syncAll').mockResolvedValue(undefined);

      await actions.importNotes([
        { id: 'a', title: 'A', content: '', folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'b', title: 'B', content: '', folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ]);

      expect(syncAllSpy).toHaveBeenCalledTimes(1);
    });

    it('calls referenceGraph.syncAll with the post-refetch note list', async () => {
      await actions.init();

      const syncAllSpy = vi.spyOn(referenceGraph, 'syncAll').mockResolvedValue(undefined);

      await actions.importNotes([
        { id: 'a', title: 'A', content: '', folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ]);

      const passedNotes = syncAllSpy.mock.calls[0][0];
      expect(passedNotes).toHaveLength(1);
      expect(passedNotes[0].title).toBe('A');
    });
  });

  // ---------------------------------------------------------------------------
  describe('rebindAdapter', () => {
    it('cascades rebindAdapter to notes/folders and reset to referenceGraph', async () => {
      seedNote(adapter, 'old', 'root');
      await actions.init();

      const notesRebindSpy = vi.spyOn(notes, 'rebindAdapter');
      const foldersRebindSpy = vi.spyOn(folders, 'rebindAdapter');
      const graphResetSpy = vi.spyOn(referenceGraph, 'reset');

      const next = new FakeStorageAdapter();
      await actions.rebindAdapter(next);

      expect(notesRebindSpy).toHaveBeenCalledWith(next);
      expect(foldersRebindSpy).toHaveBeenCalledWith(next);
      expect(graphResetSpy).toHaveBeenCalledTimes(1);
    });

    it('re-runs init after rebinding (notes are refreshed from the new adapter)', async () => {
      seedNote(adapter, 'old', 'root');
      await actions.init();

      // notes.init is called during the first init and again after rebind.
      const notesInitSpy = vi.spyOn(notes, 'init');

      const next = new FakeStorageAdapter();
      seedNote(next, 'new', 'root');
      await actions.rebindAdapter(next);

      // init() is called once more after rebind
      expect(notesInitSpy).toHaveBeenCalledTimes(1);
      expect(notes.getSnapshot().notes.map((n) => n.id)).toEqual(['new']);
    });

    it('re-runs init: folders are refreshed from the new adapter', async () => {
      seedFolder(adapter, 'old-folder');
      seedNote(adapter, 'n1', 'root');
      await actions.init();
      expect(folders.getSnapshot().folders.map((f) => f.id)).toContain('old-folder');

      const next = new FakeStorageAdapter();
      seedFolder(next, 'new-folder');
      await actions.rebindAdapter(next);

      expect(folders.getSnapshot().folders.map((f) => f.id)).toEqual(['new-folder']);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-module integration tests with REAL ReferenceGraph (no mocks).
  // These verify that the orchestration in NotepadActions actually produces
  // correct end-state — not just that the right methods are called. The spy
  // tests above catch sequencing bugs; these catch wrong-shape and
  // wrong-state-after-cascade bugs.
  // ---------------------------------------------------------------------------
  describe('cross-module integration', () => {
    function noteLinkContent(targetNoteId: string): string {
      return JSON.stringify({
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: 'See also',
            marks: [{ type: 'noteLink', attrs: { noteId: targetNoteId } }],
          }],
        }],
      });
    }

    function orphanNoteLinkContent(noteId: string, noteTitle: string): string {
      return JSON.stringify({
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: 'See also',
            marks: [{ type: 'noteLink', attrs: { noteId, noteTitle } }],
          }],
        }],
      });
    }

    it('updateNote with noteLink content creates an explicit reference in the graph', async () => {
      seedNote(adapter, 'src', 'root');
      seedNote(adapter, 'dst', 'root');
      await actions.init();

      await actions.updateNote('src', { content: noteLinkContent('dst') });

      const refs = referenceGraph.getReferencesBy({ source: 'src' });
      expect(refs).toHaveLength(1);
      expect(refs[0].target).toBe('dst');
      expect(refs[0].type).toBe('explicit');
    });

    it('deleteNote removes the note\'s outbound references from the graph', async () => {
      seedNote(adapter, 'src', 'root');
      seedNote(adapter, 'dst', 'root');
      await actions.init();
      await actions.updateNote('src', { content: noteLinkContent('dst') });
      expect(referenceGraph.getReferencesBy({ source: 'src' })).toHaveLength(1);

      await actions.deleteNote('src');

      expect(referenceGraph.getReferencesBy({ source: 'src' })).toEqual([]);
      expect(referenceGraph.getReferencesBy({ target: 'src' })).toEqual([]);
    });

    it('importNotes syncs imported notes\' references into the graph', async () => {
      seedNote(adapter, 'pre-existing', 'root');
      await actions.init();
      expect(referenceGraph.getReferences()).toHaveLength(0);

      await actions.importNotes([
        { id: 'imp-a', title: 'A', content: '', folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'imp-b', title: 'B', content: noteLinkContent('imp-a'), folderId: 'root', type: 'devotion', tags: [], wordCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ]);

      const refs = referenceGraph.getReferencesBy({ source: 'imp-b' });
      expect(refs).toHaveLength(1);
      expect(refs[0].target).toBe('imp-a');
      expect(refs[0].type).toBe('explicit');
    });

    it('init repair pass rewrites in-memory NoteCollection content for orphan noteLinks', async () => {
      // noteA has an orphan noteLink whose noteTitle matches noteB's title.
      adapter.notes.push({
        id: 'note-A',
        title: 'Note A',
        content: orphanNoteLinkContent('deleted-id', 'Note B'),
        folderId: 'root',
        type: 'devotion',
        tags: [],
        wordCount: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      seedNote(adapter, 'note-B', 'root');
      // Rename note-B so its title matches the orphan's noteTitle.
      adapter.notes[adapter.notes.length - 1].title = 'Note B';

      await actions.init();

      // The repair pass should have rewired noteA's content to point at note-B.
      // Crucially: this assertion reads from NoteCollection (in-memory), not from
      // the adapter. It verifies that the rewires flowed through NoteCollection.updateNote
      // rather than around it via a direct adapter write.
      const noteA = notes.getSnapshot().notes.find((n) => n.id === 'note-A');
      expect(noteA).toBeDefined();
      const doc = JSON.parse(noteA!.content) as {
        content: Array<{ content: Array<{ marks: Array<{ type: string; attrs: { noteId: string } }> }> }>;
      };
      const mark = doc.content[0].content[0].marks.find((m) => m.type === 'noteLink');
      expect(mark?.attrs.noteId).toBe('note-B');

      // And the graph should have the explicit reference after init's syncAll.
      const refs = referenceGraph.getReferencesBy({ source: 'note-A' });
      expect(refs.find((r) => r.target === 'note-B' && r.type === 'explicit')).toBeDefined();
    });
  });
});
