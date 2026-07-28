// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { NoteCollection, FolderHierarchy } from '../collection';
import { FakeStorageAdapter, resetFakeAdapterIds } from '../collection/fake-storage-adapter';
import { NoteCollectionContext } from './useNoteCollection';
import { FolderHierarchyContext } from './useFolderHierarchy';
import { useNewNote } from './useNewNote';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Adapter whose folder fetch stays pending until the test releases it. */
class GatedFolderAdapter extends FakeStorageAdapter {
  #release: (() => void) | null = null;
  #gate = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  releaseFolders() {
    this.#release?.();
  }

  async getFolders() {
    await this.#gate;
    return super.getFolders();
  }
}

function setup(adapter: FakeStorageAdapter) {
  resetFakeAdapterIds();
  const notes = new NoteCollection(adapter);
  const folders = new FolderHierarchy(adapter);
  const seen: ReturnType<typeof useNewNote>[] = [];

  function Probe() {
    seen.push(useNewNote());
    return null;
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NoteCollectionContext.Provider value={notes}>
        <FolderHierarchyContext.Provider value={folders}>{children}</FolderHierarchyContext.Provider>
      </NoteCollectionContext.Provider>
    );
  }

  render(
    <Wrapper>
      <Probe />
    </Wrapper>,
  );

  return {
    notes,
    folders,
    adapter,
    latest: () => seen[seen.length - 1],
  };
}

describe('useNewNote', () => {
  it('creates in the top root folder once folders are loaded', async () => {
    const adapter = new FakeStorageAdapter();
    adapter.folders.push(
      { id: 'second', name: 'Second', parentId: null, order: 1 },
      { id: 'top', name: 'Top', parentId: null, order: 0 },
    );
    const ctx = setup(adapter);
    await act(async () => {
      await ctx.folders.init();
    });

    let created: { folderId: string } | null = null;
    await act(async () => {
      created = (await ctx.latest().createNewNote()) as { folderId: string } | null;
    });

    expect(created!.folderId).toBe('top');
  });

  it('creates in the active note’s folder', async () => {
    const adapter = new FakeStorageAdapter();
    adapter.folders.push(
      { id: 'top', name: 'Top', parentId: null, order: 0 },
      { id: 'other', name: 'Other', parentId: null, order: 1 },
    );
    const ctx = setup(adapter);
    await act(async () => {
      await ctx.folders.init();
      const note = await ctx.notes.createNote('other', 'general');
      ctx.notes.openNote(note.id);
    });

    let created: { folderId: string } | null = null;
    await act(async () => {
      created = (await ctx.latest().createNewNote()) as { folderId: string } | null;
    });

    expect(created!.folderId).toBe('other');
  });

  // The regression this hook exists for: a click that lands before the folder
  // list arrives must NOT permanently file the note at root.
  it('waits for the folder list instead of filing at root when clicked mid-load', async () => {
    const adapter = new GatedFolderAdapter();
    adapter.folders.push({ id: 'top', name: 'Top', parentId: null, order: 0 });
    const ctx = setup(adapter);

    // Kick off the load but leave it hanging — this is the mid-load window.
    const loading = ctx.folders.init();
    expect(ctx.folders.getSnapshot().loaded).toBe(false);

    let created: { folderId: string } | null = null;
    const click = act(async () => {
      created = (await ctx.latest().createNewNote()) as { folderId: string } | null;
    });

    // Nothing may be created while the answer is still unknown.
    expect(ctx.notes.getSnapshot().notes).toHaveLength(0);

    adapter.releaseFolders();
    await act(async () => {
      await loading;
    });
    await click;

    expect(created!.folderId).toBe('top');
    expect(ctx.notes.getSnapshot().notes).toHaveLength(1);
  });

  it('reports pending across the wait', async () => {
    const adapter = new GatedFolderAdapter();
    adapter.folders.push({ id: 'top', name: 'Top', parentId: null, order: 0 });
    const ctx = setup(adapter);
    const loading = ctx.folders.init();

    let click!: Promise<unknown>;
    await act(async () => {
      click = ctx.latest().createNewNote();
    });
    expect(ctx.latest().pending).toBe(true);

    adapter.releaseFolders();
    await act(async () => {
      await loading;
      await click;
    });
    expect(ctx.latest().pending).toBe(false);
  });

  it('collapses a double-click during the wait into a single note', async () => {
    const adapter = new GatedFolderAdapter();
    adapter.folders.push({ id: 'top', name: 'Top', parentId: null, order: 0 });
    const ctx = setup(adapter);
    const loading = ctx.folders.init();

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = ctx.latest().createNewNote();
      second = ctx.latest().createNewNote();
    });

    adapter.releaseFolders();
    await act(async () => {
      await loading;
    });

    expect(await second).toBeNull();
    expect(await first).toMatchObject({ folderId: 'top' });
    expect(ctx.notes.getSnapshot().notes).toHaveLength(1);
  });

  it('still trusts the active note’s folder mid-load without waiting', async () => {
    const adapter = new GatedFolderAdapter();
    adapter.folders.push({ id: 'top', name: 'Top', parentId: null, order: 0 });
    const ctx = setup(adapter);
    void ctx.folders.init();

    // A note that already loaded proves its folder exists, list or no list.
    await act(async () => {
      const note = await ctx.notes.createNote('known-folder', 'general');
      ctx.notes.openNote(note.id);
    });

    let created: { folderId: string } | null = null;
    await act(async () => {
      created = (await ctx.latest().createNewNote()) as { folderId: string } | null;
    });

    expect(created!.folderId).toBe('known-folder');
    expect(ctx.latest().pending).toBe(false);
  });

  it('falls back to root when the folder load fails', async () => {
    const adapter = new FakeStorageAdapter();
    adapter.getFolders = () => Promise.reject(new Error('offline'));
    const ctx = setup(adapter);

    const failing = ctx.folders.init().catch(() => {});

    let created: { folderId: string } | null = null;
    await act(async () => {
      const click = ctx.latest().createNewNote();
      await failing;
      created = (await click) as { folderId: string } | null;
    });

    expect(created!.folderId).toBe('root');
  });
});

describe('useNewNote — adapter rebind', () => {
  it('waits for the rebound account’s folders rather than the cleared snapshot', async () => {
    vi.useRealTimers();
    const first = new FakeStorageAdapter();
    first.folders.push({ id: 'local-top', name: 'Local', parentId: null, order: 0 });
    const ctx = setup(first);
    await act(async () => {
      await ctx.folders.init();
    });

    // Sign-in: rebind clears state to unloaded, then the new account loads.
    const next = new GatedFolderAdapter();
    next.folders.push({ id: 'cloud-top', name: 'Cloud', parentId: null, order: 0 });
    act(() => {
      ctx.folders.rebindAdapter(next);
      ctx.notes.rebindAdapter(next);
    });
    const loading = ctx.folders.init();

    let created: { folderId: string } | null = null;
    const click = act(async () => {
      created = (await ctx.latest().createNewNote()) as { folderId: string } | null;
    });

    next.releaseFolders();
    await act(async () => {
      await loading;
    });
    await click;

    expect(created!.folderId).toBe('cloud-top');
  });
});
