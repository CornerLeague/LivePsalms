// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NoteCollection } from './note-collection';
import { FolderHierarchy } from './folder-hierarchy';
import { NotepadActions } from './notepad-actions';
import { FakeStorageAdapter, resetFakeAdapterIds } from './fake-storage-adapter';
import { ReferenceGraph } from '../graph/reference-graph';
import { createInMemoryStorage } from '../graph/in-memory-storage';
import { createInMemoryVerseFetcher } from '../graph/in-memory-verse-fetcher';
import { setOnboardingSink } from '../onboarding/onboarding-events';
import type { NoteType } from '../types';

function seedNote(adapter: FakeStorageAdapter, id: string, type: NoteType, folderId = 'root') {
  adapter.notes.push({
    id,
    title: id,
    content: '',
    folderId,
    type,
    tags: [],
    wordCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
}

describe('NotepadActions — type-folder backfill', () => {
  let adapter: FakeStorageAdapter;
  let notes: NoteCollection;
  let folders: FolderHierarchy;
  let actions: NotepadActions;

  function wire(a: FakeStorageAdapter) {
    adapter = a;
    notes = new NoteCollection(a);
    folders = new FolderHierarchy(a);
    actions = new NotepadActions(
      a,
      notes,
      folders,
      new ReferenceGraph(createInMemoryVerseFetcher({}), createInMemoryStorage()),
    );
  }

  beforeEach(() => {
    resetFakeAdapterIds();
    localStorage.clear();
    wire(new FakeStorageAdapter());
  });

  afterEach(() => {
    setOnboardingSink(null);
    vi.restoreAllMocks();
  });

  it('turns the legacy type buckets into folders and files the notes', async () => {
    seedNote(adapter, 'n1', 'general');
    seedNote(adapter, 'n2', 'devotion');
    seedNote(adapter, 'n3', 'general');
    await actions.init();

    const created = folders.getSnapshot().folders;
    expect(created.map((f) => f.name)).toEqual(['General', 'Devotions']);

    const byId = new Map(created.map((f) => [f.name, f.id]));
    const filed = new Map(notes.getSnapshot().notes.map((n) => [n.id, n.folderId]));
    expect(filed.get('n1')).toBe(byId.get('General'));
    expect(filed.get('n3')).toBe(byId.get('General'));
    expect(filed.get('n2')).toBe(byId.get('Devotions'));
  });

  it('persists the moves through the adapter, not just in memory', async () => {
    seedNote(adapter, 'n1', 'sermon');
    await actions.init();

    const stored = await adapter.getNotes();
    const sermons = (await adapter.getFolders()).find((f) => f.name === 'Sermons');
    expect(stored[0].folderId).toBe(sermons!.id);
  });

  it('leaves an account that already uses folders untouched', async () => {
    adapter.folders.push({ id: 'mine', name: 'Mine', parentId: null, order: 0 });
    seedNote(adapter, 'n1', 'general');
    await actions.init();

    expect(folders.getSnapshot().folders.map((f) => f.name)).toEqual(['Mine']);
    expect(notes.getSnapshot().notes[0].folderId).toBe('root');
  });

  it('does not tick off the user’s "create a folder" onboarding step', async () => {
    const sink = vi.fn();
    setOnboardingSink(sink);
    seedNote(adapter, 'n1', 'general');
    await actions.init();

    expect(sink).not.toHaveBeenCalledWith('folder-created');
  });

  // Regression: React StrictMode invokes the provider's mount effect twice.
  // Both runs used to load in parallel, each see an empty folder list, and each
  // seed — handing the user two of every folder.
  it('seeds once when init is invoked twice concurrently (StrictMode)', async () => {
    seedNote(adapter, 'n1', 'general');
    seedNote(adapter, 'n2', 'devotion');

    await Promise.all([actions.init(), actions.init()]);

    expect(folders.getSnapshot().folders.map((f) => f.name)).toEqual(['General', 'Devotions']);
    expect((await adapter.getFolders()).map((f) => f.name)).toEqual(['General', 'Devotions']);
  });

  it('declines when another tab seeded the account since this one loaded', async () => {
    seedNote(adapter, 'n1', 'general');
    await notes.init();
    await folders.init();

    // Simulate the other tab's write landing after this instance's snapshot.
    adapter.folders.push({ id: 'other-tab', name: 'General', parentId: null, order: 0 });

    await actions.init();
    expect((await adapter.getFolders()).map((f) => f.id)).toEqual(['other-tab']);
  });

  it('is idempotent — a second init creates nothing further', async () => {
    seedNote(adapter, 'n1', 'general');
    await actions.init();
    const afterFirst = folders.getSnapshot().folders.map((f) => f.id);

    await actions.init();
    expect(folders.getSnapshot().folders.map((f) => f.id)).toEqual(afterFirst);
  });

  it('does not re-seed after the user deletes the seeded folders', async () => {
    seedNote(adapter, 'n1', 'general');
    await actions.init();

    // Deleting the folder returns the note to root — the same shape that
    // triggered the backfill. The per-account marker is what stops a rerun.
    const seeded = folders.getSnapshot().folders[0];
    await actions.deleteFolder(seeded.id);
    expect(notes.getSnapshot().notes[0].folderId).toBe('root');

    await actions.init();
    expect(folders.getSnapshot().folders).toEqual([]);
    expect(notes.getSnapshot().notes[0].folderId).toBe('root');
  });

  it('scopes the marker per account, so a different account still gets seeded', async () => {
    seedNote(adapter, 'n1', 'general');
    await actions.init();

    const other = new FakeStorageAdapter();
    other.scopeId = 'user:someone-else';
    seedNote(other, 'n9', 'theme');
    wire(other);
    await actions.init();

    expect(folders.getSnapshot().folders.map((f) => f.name)).toEqual(['Themes']);
  });

  it('waits for an in-flight init to drain before rebinding — no overlapping runs', async () => {
    // Gate account A's folder load so its init() stays in flight.
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    seedNote(adapter, 'a1', 'general');
    const realGetFolders = adapter.getFolders.bind(adapter);
    adapter.getFolders = async () => {
      await gateA;
      return realGetFolders();
    };

    const initA = actions.init(); // hangs inside folders.init() on gateA
    await Promise.resolve();

    // Sign-in lands before A finished loading: rebind to B mid-flight.
    const b = new FakeStorageAdapter();
    b.scopeId = 'user:b';
    seedNote(b, 'b1', 'devotion');
    let bLoaded = false;
    const realBGetFolders = b.getFolders.bind(b);
    b.getFolders = async () => {
      bLoaded = true;
      return realBGetFolders();
    };

    const rebindP = actions.rebindAdapter(b);
    // The rebind must serialize behind A: B's account is untouched until A drains.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(bLoaded).toBe(false);

    // Let A finish; only then does the rebind swap and initialize B.
    releaseA();
    await initA;
    await rebindP;

    expect(bLoaded).toBe(true);
    // B seeded cleanly — no interleaving corruption, exactly one Devotions folder.
    expect(folders.getSnapshot().folders.map((f) => f.name)).toEqual(['Devotions']);
    expect((await b.getFolders()).filter((f) => f.name === 'Devotions')).toHaveLength(1);
  });

  it('runs on the newly bound account after sign-in', async () => {
    await actions.init();

    const cloud = new FakeStorageAdapter();
    cloud.scopeId = 'user:cloud';
    seedNote(cloud, 'c1', 'devotion');
    await actions.rebindAdapter(cloud);

    expect(folders.getSnapshot().folders.map((f) => f.name)).toEqual(['Devotions']);
    expect(notes.getSnapshot().notes[0].folderId).not.toBe('root');
  });

  it('never blocks init when the backfill fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedNote(adapter, 'n1', 'general');
    adapter.createFolder = () => Promise.reject(new Error('write denied'));

    await expect(actions.init()).resolves.toBeUndefined();
    expect(notes.getSnapshot().notes.map((n) => n.id)).toEqual(['n1']);
    expect(warn).toHaveBeenCalled();
  });

  it('retries on the next load when the backfill failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedNote(adapter, 'n1', 'general');
    const real = adapter.createFolder.bind(adapter);
    adapter.createFolder = () => Promise.reject(new Error('offline'));
    await actions.init();
    expect(folders.getSnapshot().folders).toEqual([]);

    adapter.createFolder = real;
    await actions.init();
    expect(folders.getSnapshot().folders.map((f) => f.name)).toEqual(['General']);
  });

  it('resumes a partial folder-creation failure without duplicating folders', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedNote(adapter, 'n1', 'general');
    seedNote(adapter, 'n2', 'devotion');

    // The first folder (General) lands; the second (Devotions) fails, so the
    // folder loop throws before any note is moved — a genuine partial run.
    const realCreate = adapter.createFolder.bind(adapter);
    let creates = 0;
    adapter.createFolder = (folder) => {
      creates += 1;
      return creates === 1 ? realCreate(folder) : Promise.reject(new Error('offline'));
    };
    await actions.init();
    expect((await adapter.getFolders()).map((f) => f.name)).toEqual(['General']);
    expect((await adapter.getNotes()).every((n) => n.folderId === 'root')).toBe(true);

    // Next load: a fresh instance over the same account. The attempt marker
    // routes it into resume, which fills the gap and files both notes.
    adapter.createFolder = realCreate;
    wire(adapter);
    await actions.init();

    const stored = await adapter.getFolders();
    expect(stored.map((f) => f.name)).toEqual(['General', 'Devotions']);
    const byName = new Map(stored.map((f) => [f.name, f.id]));
    const filed = new Map((await adapter.getNotes()).map((n) => [n.id, n.folderId]));
    expect(filed.get('n1')).toBe(byName.get('General'));
    expect(filed.get('n2')).toBe(byName.get('Devotions'));
  });

  it('resumes a partial note-move failure without duplicating the folder', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedNote(adapter, 'n1', 'general');
    seedNote(adapter, 'n2', 'general');

    // The folder is created, but moving n1 fails while n2 still lands.
    const realUpdate = adapter.updateNote.bind(adapter);
    let failN1 = true;
    adapter.updateNote = (id, updates) => {
      if (id === 'n1' && failN1) {
        failN1 = false;
        return Promise.reject(new Error('offline'));
      }
      return realUpdate(id, updates);
    };
    await actions.init();
    const general = (await adapter.getFolders()).find((f) => f.name === 'General')!;
    const afterFirst = new Map((await adapter.getNotes()).map((n) => [n.id, n.folderId]));
    expect(afterFirst.get('n1')).toBe('root');
    expect(afterFirst.get('n2')).toBe(general.id);

    // Next load resumes: n1 moves in, and no second General folder is created.
    adapter.updateNote = realUpdate;
    wire(adapter);
    await actions.init();

    expect((await adapter.getFolders()).map((f) => f.name)).toEqual(['General']);
    const filed = new Map((await adapter.getNotes()).map((n) => [n.id, n.folderId]));
    expect(filed.get('n1')).toBe(general.id);
    expect(filed.get('n2')).toBe(general.id);
  });

  it('does not resume a partial-looking account this device never seeded', async () => {
    // A 'General' folder — exactly what our own partial run leaves behind —
    // exists, but THIS device holds no attempt marker (it never started a seed;
    // another device did). Cross-device idempotency means it must stay hands-off:
    // no filing the root note, no duplicate folder.
    adapter.folders.push({ id: 'general', name: 'General', parentId: null, order: 0 });
    seedNote(adapter, 'n1', 'general');

    await actions.init();

    expect(notes.getSnapshot().notes[0].folderId).toBe('root');
    expect((await adapter.getFolders()).map((f) => f.name)).toEqual(['General']);
  });

  it('stamps each seeded folder with its note type as provenance', async () => {
    seedNote(adapter, 'n1', 'general');
    seedNote(adapter, 'n2', 'sermon');
    await actions.init();

    const byName = new Map((await adapter.getFolders()).map((f) => [f.name, f.seededType]));
    expect(byName.get('General')).toBe('general');
    expect(byName.get('Sermons')).toBe('sermon');
  });

  it('resumes by tag after the user renamed a partially-seeded folder', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedNote(adapter, 'n1', 'general');
    seedNote(adapter, 'n2', 'devotion');

    // General lands (tagged 'general'); Devotions fails → a partial run.
    const realCreate = adapter.createFolder.bind(adapter);
    let creates = 0;
    adapter.createFolder = (folder) => {
      creates += 1;
      return creates === 1 ? realCreate(folder) : Promise.reject(new Error('offline'));
    };
    await actions.init();
    const general = (await adapter.getFolders()).find((f) => f.seededType === 'general')!;
    expect(general.name).toBe('General');

    // The user renames it before the resume — a name-based match would now miss
    // it and spawn a duplicate 'General'. The tag keeps the resume exact.
    await adapter.updateFolder(general.id, { name: 'Sunday Notes' });

    adapter.createFolder = realCreate;
    wire(adapter);
    await actions.init();

    const stored = await adapter.getFolders();
    expect(stored.map((f) => f.name).sort()).toEqual(['Devotions', 'Sunday Notes']);
    const filed = new Map((await adapter.getNotes()).map((n) => [n.id, n.folderId]));
    expect(filed.get('n1')).toBe(general.id);
    expect(filed.get('n2')).toBe(stored.find((f) => f.seededType === 'devotion')!.id);
  });
});
