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
});
