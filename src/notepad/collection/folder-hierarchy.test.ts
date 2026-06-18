import { describe, it, expect, beforeEach } from 'vitest';
import { FolderHierarchy } from './folder-hierarchy';
import { FakeStorageAdapter, resetFakeAdapterIds } from './fake-storage-adapter';

function seedFolder(adapter: FakeStorageAdapter, overrides: Partial<{ id: string; name: string; parentId: string | null; order: number }> = {}) {
  const id = overrides.id ?? `f-${adapter.folders.length}`;
  adapter.folders.push({
    id,
    name: overrides.name ?? 'F',
    parentId: overrides.parentId ?? null,
    order: overrides.order ?? 0,
  });
  return id;
}

describe('FolderHierarchy', () => {
  let adapter: FakeStorageAdapter;
  let hierarchy: FolderHierarchy;

  beforeEach(() => {
    resetFakeAdapterIds();
    adapter = new FakeStorageAdapter();
    hierarchy = new FolderHierarchy(adapter);
  });

  it('starts empty', () => {
    expect(hierarchy.getSnapshot().folders).toEqual([]);
  });

  it('init loads folders', async () => {
    seedFolder(adapter, { id: 'a' });
    seedFolder(adapter, { id: 'b' });
    await hierarchy.init();
    expect(hierarchy.getSnapshot().folders.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('createFolder computes order from existing siblings', async () => {
    seedFolder(adapter, { parentId: null, order: 0 });
    seedFolder(adapter, { parentId: null, order: 1 });
    await hierarchy.init();
    const created = await hierarchy.createFolder('New', null);
    expect(created.order).toBe(2);
  });

  it('createFolder under a different parent computes its own order', async () => {
    seedFolder(adapter, { parentId: null, order: 0 });
    seedFolder(adapter, { parentId: 'parent-x', order: 0 });
    await hierarchy.init();
    const created = await hierarchy.createFolder('Child', 'parent-x');
    expect(created.order).toBe(1);
  });

  it('renameFolder replaces in place', async () => {
    seedFolder(adapter, { id: 'a', name: 'Old' });
    await hierarchy.init();
    await hierarchy.renameFolder('a', 'New');
    expect(hierarchy.getSnapshot().folders[0].name).toBe('New');
  });

  it('deleteFolder removes the folder from local state', async () => {
    seedFolder(adapter, { id: 'a' });
    seedFolder(adapter, { id: 'b' });
    await hierarchy.init();
    await hierarchy.deleteFolder('a');
    expect(hierarchy.getSnapshot().folders.map((f) => f.id)).toEqual(['b']);
  });

  it('rebindAdapter clears state', async () => {
    seedFolder(adapter, { id: 'a' });
    await hierarchy.init();
    hierarchy.rebindAdapter(new FakeStorageAdapter());
    expect(hierarchy.getSnapshot().folders).toEqual([]);
  });

  it('starts with a null studyFolderId', () => {
    expect(hierarchy.getSnapshot().studyFolderId).toBeNull();
  });

  it('ensureStudyFolder adds the folder and records its id', async () => {
    await hierarchy.init();
    const folder = await hierarchy.ensureStudyFolder();
    const state = hierarchy.getSnapshot();
    expect(state.studyFolderId).toBe(folder.id);
    expect(state.folders.filter((f) => f.kind === 'study')).toHaveLength(1);
  });

  it('ensureStudyFolder is idempotent across calls', async () => {
    await hierarchy.init();
    const first = await hierarchy.ensureStudyFolder();
    const second = await hierarchy.ensureStudyFolder();
    expect(second.id).toBe(first.id);
    expect(hierarchy.getSnapshot().folders.filter((f) => f.kind === 'study')).toHaveLength(1);
  });

  it('rebindAdapter clears studyFolderId', async () => {
    await hierarchy.init();
    await hierarchy.ensureStudyFolder();
    hierarchy.rebindAdapter(new FakeStorageAdapter());
    expect(hierarchy.getSnapshot().studyFolderId).toBeNull();
  });
});
