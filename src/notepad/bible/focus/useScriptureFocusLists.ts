import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/auth/context/useAuthSession';
import {
  loadFocusMode, saveFocusMode,
  loadActiveListId, saveActiveListId,
  loadQuickListItems, saveQuickListItems,
} from '@/notepad/session/session-storage';
import {
  QUICK_LIST_ID,
  type FocusList, type FocusListAdapter, type FocusListItem, type ScriptureRef,
} from './focus-list-types';
import { SupabaseFocusListAdapter } from './supabase-focus-list-adapter';

export interface UseScriptureFocusListsResult {
  focusModeOn: boolean;
  toggleFocusMode: () => void;
  savedLists: FocusList[];
  quickList: FocusList;
  activeListId: string;
  activeList: FocusList;
  canSave: boolean;
  selectList: (id: string) => void;
  newList: (title: string) => Promise<void>;
  saveQuickList: (title: string) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  addRefs: (refs: ScriptureRef[]) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  reorderItem: (itemId: string, direction: 'up' | 'down') => Promise<void>;
}

export interface UseScriptureFocusListsOptions {
  /** Tests inject an adapter; omit in production to build from supabase + userId. */
  adapterOverride?: FocusListAdapter | null;
}

function newItemId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function refToQuickItem(ref: ScriptureRef, position: number): FocusListItem {
  return { ...ref, id: newItemId(), position };
}

export function useScriptureFocusLists(
  opts: UseScriptureFocusListsOptions = {},
): UseScriptureFocusListsResult {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;

  const adapter: FocusListAdapter | null = useMemo(() => {
    if (opts.adapterOverride !== undefined) return opts.adapterOverride;
    if (supabase && userId) return new SupabaseFocusListAdapter(supabase, userId);
    return null;
  }, [opts.adapterOverride, userId]);

  const [savedLists, setSavedLists] = useState<FocusList[]>([]);
  const [focusModeOn, setFocusModeOn] = useState<boolean>(() => loadFocusMode());
  const [activeListId, setActiveListId] = useState<string>(() => loadActiveListId() ?? QUICK_LIST_ID);
  const [quickItems, setQuickItems] = useState<FocusListItem[]>(() => loadQuickListItems());

  const canSave = adapter != null;

  // Load saved lists when an adapter is present.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!adapter) { setSavedLists([]); return; }
    let cancelled = false;
    adapter.listLists()
      .then((lists) => { if (!cancelled) setSavedLists(lists); })
      .catch((err) => { if (!cancelled) console.warn('[useScriptureFocusLists] load failed:', err); });
    return () => { cancelled = true; };
  }, [adapter]);

  const quickList: FocusList = useMemo(
    () => ({ id: QUICK_LIST_ID, title: 'Quick list', position: -1, items: quickItems }),
    [quickItems],
  );

  const persistQuick = useCallback((items: FocusListItem[]) => {
    setQuickItems(items);
    saveQuickListItems(items);
  }, []);

  // Resolve the active list; fall back to the quick list if the id is unknown.
  const activeList: FocusList = useMemo(() => {
    if (activeListId === QUICK_LIST_ID) return quickList;
    return savedLists.find((l) => l.id === activeListId) ?? quickList;
  }, [activeListId, savedLists, quickList]);

  const toggleFocusMode = useCallback(() => {
    setFocusModeOn((prev) => { const next = !prev; saveFocusMode(next); return next; });
  }, []);

  const selectList = useCallback((id: string) => {
    setActiveListId(id);
    saveActiveListId(id);
  }, []);

  const addRefs = useCallback(async (refs: ScriptureRef[]) => {
    if (refs.length === 0) return;
    if (activeListId === QUICK_LIST_ID) {
      persistQuick([...quickItems, ...refs.map((r, i) => refToQuickItem(r, quickItems.length + i))]);
      return;
    }
    if (!adapter) return;
    const list = savedLists.find((l) => l.id === activeListId);
    if (!list) return;
    const prev = savedLists;
    try {
      const created = await adapter.addItems(activeListId, refs, list.items.length);
      setSavedLists((cur) => cur.map((l) => (l.id === activeListId ? { ...l, items: [...l.items, ...created] } : l)));
    } catch (err) {
      console.warn('[useScriptureFocusLists] addItems failed:', err);
      setSavedLists(prev);
      toast.error('Could not add to the list. Please try again.');
    }
  }, [activeListId, adapter, quickItems, savedLists, persistQuick]);

  const removeItem = useCallback(async (itemId: string) => {
    if (activeListId === QUICK_LIST_ID) {
      persistQuick(quickItems.filter((i) => i.id !== itemId).map((i, idx) => ({ ...i, position: idx })));
      return;
    }
    if (!adapter) return;
    const prev = savedLists;
    setSavedLists((cur) => cur.map((l) => (l.id === activeListId
      ? { ...l, items: l.items.filter((i) => i.id !== itemId).map((i, idx) => ({ ...i, position: idx })) }
      : l)));
    try {
      await adapter.removeItem(itemId);
    } catch (err) {
      console.warn('[useScriptureFocusLists] removeItem failed:', err);
      setSavedLists(prev);
      toast.error('Could not remove the verse. Please try again.');
    }
  }, [activeListId, adapter, quickItems, savedLists, persistQuick]);

  const reorderItem = useCallback(async (itemId: string, direction: 'up' | 'down') => {
    const reorder = (items: FocusListItem[]): FocusListItem[] | null => {
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx === -1) return null;
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= items.length) return null;
      const next = [...items];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next.map((i, position) => ({ ...i, position }));
    };

    if (activeListId === QUICK_LIST_ID) {
      const next = reorder(quickItems);
      if (next) persistQuick(next);
      return;
    }
    if (!adapter) return;
    const list = savedLists.find((l) => l.id === activeListId);
    if (!list) return;
    const next = reorder(list.items);
    if (!next) return;
    const prev = savedLists;
    setSavedLists((cur) => cur.map((l) => (l.id === activeListId ? { ...l, items: next } : l)));
    try {
      await adapter.reorderItems(activeListId, next.map((i) => i.id));
    } catch (err) {
      console.warn('[useScriptureFocusLists] reorderItems failed:', err);
      setSavedLists(prev);
      toast.error('Could not reorder. Please try again.');
    }
  }, [activeListId, adapter, quickItems, savedLists, persistQuick]);

  const newList = useCallback(async (title: string) => {
    if (!adapter) { toast.error('Sign in to save lists.'); return; }
    try {
      const created = await adapter.createList(title, []);
      setSavedLists((cur) => [...cur, created]);
      selectList(created.id);
    } catch (err) {
      console.warn('[useScriptureFocusLists] newList failed:', err);
      toast.error('Could not create the list. Please try again.');
    }
  }, [adapter, selectList]);

  const saveQuickList = useCallback(async (title: string) => {
    if (!adapter) { toast.error('Sign in to save lists.'); return; }
    try {
      const created = await adapter.createList(title, quickItems);
      setSavedLists((cur) => [...cur, created]);
      selectList(created.id);
      persistQuick([]); // the quick list resets once saved
    } catch (err) {
      console.warn('[useScriptureFocusLists] saveQuickList failed:', err);
      toast.error('Could not save the list. Please try again.');
    }
  }, [adapter, quickItems, selectList, persistQuick]);

  const deleteList = useCallback(async (id: string) => {
    if (!adapter) return;
    const prev = savedLists;
    setSavedLists((cur) => cur.filter((l) => l.id !== id));
    if (activeListId === id) selectList(QUICK_LIST_ID);
    try {
      await adapter.deleteList(id);
    } catch (err) {
      console.warn('[useScriptureFocusLists] deleteList failed:', err);
      setSavedLists(prev);
      toast.error('Could not delete the list. Please try again.');
    }
  }, [adapter, activeListId, savedLists, selectList]);

  return {
    focusModeOn, toggleFocusMode,
    savedLists, quickList, activeListId, activeList, canSave,
    selectList, newList, saveQuickList, deleteList,
    addRefs, removeItem, reorderItem,
  };
}
