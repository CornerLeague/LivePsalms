// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { useScriptureFocusLists } from './useScriptureFocusLists';
import { InMemoryFocusListAdapter } from './in-memory-focus-list-adapter';
import { QUICK_LIST_ID, type ScriptureRef } from './focus-list-types';

// useAuthSession is called internally; the injected adapter bypasses real auth.
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: null }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const ref = (label: string, v = 16): ScriptureRef => ({
  book: 'jhn', chapter: 3, verseStart: v, verseEnd: v, label,
});

beforeEach(() => localStorage.clear());
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
});
