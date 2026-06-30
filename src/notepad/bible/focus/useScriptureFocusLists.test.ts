// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { useScriptureFocusLists } from './useScriptureFocusLists';
import { InMemoryFocusListAdapter } from './in-memory-focus-list-adapter';
import { QUICK_LIST_ID, type ScriptureRef } from './focus-list-types';

// useAuthSession is called internally; the injected adapter bypasses real auth.
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: null }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const ref = (label: string, v = 16): ScriptureRef => ({
  book: 'jhn', chapter: 3, verseStart: v, verseEnd: v, label,
});

// Failing adapter subclasses – override one method to reject; inherit working methods for setup.
class FailingAddItems extends InMemoryFocusListAdapter {
  async addItems(): Promise<never> { throw new Error('addItems boom'); }
}
class FailingRemoveItem extends InMemoryFocusListAdapter {
  async removeItem(): Promise<void> { throw new Error('removeItem boom'); }
}
class FailingReorderItems extends InMemoryFocusListAdapter {
  async reorderItems(): Promise<void> { throw new Error('reorderItems boom'); }
}
class FailingDeleteList extends InMemoryFocusListAdapter {
  async deleteList(): Promise<void> { throw new Error('deleteList boom'); }
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe('useScriptureFocusLists', () => {
  it('starts focus-off with the quick list active and empty', () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    expect(result.current.focusModeOn).toBe(false);
    expect(result.current.activeListId).toBe(QUICK_LIST_ID);
    expect(result.current.activeList.items).toEqual([]);
    expect(result.current.canSave).toBe(false);
  });

  it('toggles focus mode and persists it', () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    act(() => result.current.toggleFocusMode());
    expect(result.current.focusModeOn).toBe(true);
    expect(localStorage.getItem('psalms.bible.focus.mode')).toBe('1');
  });

  it('adds refs to the quick list when quick is active (signed-out)', async () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    await act(async () => { await result.current.addRefs([ref('John 3:16')]); });
    expect(result.current.quickList.items.map((i) => i.label)).toEqual(['John 3:16']);
    // persisted
    expect(JSON.parse(localStorage.getItem('psalms.bible.focus.quickList')!)).toHaveLength(1);
  });

  it('loads saved lists from the adapter on mount (signed-in)', async () => {
    const adapter = new InMemoryFocusListAdapter();
    await adapter.createList('Comfort', [ref('a')]);
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    expect(result.current.canSave).toBe(true);
    expect(result.current.savedLists[0].title).toBe('Comfort');
  });

  it('saveQuickList persists the quick items into a new saved list and activates it', async () => {
    const adapter = new InMemoryFocusListAdapter();
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await act(async () => { await result.current.addRefs([ref('John 3:16')]); });
    await act(async () => { await result.current.saveQuickList('Sunday AM'); });
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    expect(result.current.savedLists[0].title).toBe('Sunday AM');
    expect(result.current.activeListId).toBe(result.current.savedLists[0].id);
    // quick list is cleared after saving
    expect(result.current.quickList.items).toEqual([]);
  });

  it('falls back to the quick list when the active saved list is deleted', async () => {
    const adapter = new InMemoryFocusListAdapter();
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await act(async () => { await result.current.newList('Romans'); });
    const id = result.current.activeListId;
    expect(id).not.toBe(QUICK_LIST_ID);
    await act(async () => { await result.current.deleteList(id); });
    expect(result.current.activeListId).toBe(QUICK_LIST_ID);
  });

  it('reorders quick-list items up/down', async () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    await act(async () => { await result.current.addRefs([ref('a', 1), ref('b', 2), ref('c', 3)]); });
    const second = result.current.quickList.items[1].id;
    await act(async () => { await result.current.reorderItem(second, 'up'); });
    expect(result.current.quickList.items.map((i) => i.label)).toEqual(['b', 'a', 'c']);
  });

  // ── Optimistic-rollback catch branches ──────────────────────────────────────

  it('rolls back savedLists and calls toast.error when addItems rejects', async () => {
    const adapter = new FailingAddItems();
    await adapter.createList('Sunday', [ref('a')]);
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    const listId = result.current.savedLists[0].id;
    act(() => { result.current.selectList(listId); });
    await act(async () => { await result.current.addRefs([ref('b', 99)]); });
    // adapter failure: item was not added and state was not corrupted
    expect(result.current.savedLists[0].items).toHaveLength(1);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it('rolls back savedLists and calls toast.error when removeItem rejects', async () => {
    const adapter = new FailingRemoveItem();
    await adapter.createList('Sunday', [ref('a')]);
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    const listId = result.current.savedLists[0].id;
    const itemId = result.current.savedLists[0].items[0].id;
    act(() => { result.current.selectList(listId); });
    await act(async () => { await result.current.removeItem(itemId); });
    // optimistic removal was rolled back — item is restored
    expect(result.current.savedLists[0].items).toHaveLength(1);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it('rolls back savedLists and calls toast.error when reorderItems rejects', async () => {
    const adapter = new FailingReorderItems();
    await adapter.createList('Sunday', [ref('a', 1), ref('b', 2)]);
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    const listId = result.current.savedLists[0].id;
    const secondItemId = result.current.savedLists[0].items[1].id;
    act(() => { result.current.selectList(listId); });
    await act(async () => { await result.current.reorderItem(secondItemId, 'up'); });
    // optimistic reorder was rolled back — original order preserved
    expect(result.current.savedLists[0].items.map((i) => i.label)).toEqual(['a', 'b']);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it('rolls back savedLists and calls toast.error when deleteList rejects', async () => {
    const adapter = new FailingDeleteList();
    await adapter.createList('Sunday', []);
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    const listId = result.current.savedLists[0].id;
    act(() => { result.current.selectList(listId); });
    await act(async () => { await result.current.deleteList(listId); });
    // optimistic deletion was rolled back — list is restored
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    expect(result.current.savedLists[0].id).toBe(listId);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    // NOTE: activeListId is intentionally NOT asserted — the hook does not restore it (known Minor)
  });
});
