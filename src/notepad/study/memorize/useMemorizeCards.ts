// src/notepad/study/memorize/useMemorizeCards.ts
// Adapter-selecting hook for Memorize cards. Signed-in -> SupabaseMemorizeAdapter;
// guest (no adapter) -> React state mirrored to localStorage. Optimistic updates +
// rollback-to-prev + sonner error toasts live HERE (adapters just throw).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { loadMemorizeCards, saveMemorizeCards } from '@/notepad/session/session-storage';
import { cardKey, type AttemptUpdate, type MemorizeAdapter, type MemorizeCard, type NewMemorizeCard } from './memorize-types';
import { SupabaseMemorizeAdapter } from './supabase-memorize-adapter';

export interface UseMemorizeCardsOptions {
  /** Tests inject an adapter; omit in production to build from supabase + userId.
      `null` forces the guest (localStorage) path. */
  adapterOverride?: MemorizeAdapter | null;
}

export interface UseMemorizeCardsResult {
  cards: MemorizeCard[];
  canSave: boolean;
  loading: boolean;
  addCards: (cards: NewMemorizeCard[]) => Promise<MemorizeCard[]>;
  updateAfterAttempt: (id: string, update: AttemptUpdate) => Promise<void>;
  removeCard: (id: string) => Promise<void>;
  /** Re-read from the store (used to sync a pane when it becomes active). */
  refetch: () => void;
}

function newGuestId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `g-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

export function useMemorizeCards(opts: UseMemorizeCardsOptions = {}): UseMemorizeCardsResult {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;

  const adapter: MemorizeAdapter | null = useMemo(() => {
    if (opts.adapterOverride !== undefined) return opts.adapterOverride;
    if (supabase && userId) return new SupabaseMemorizeAdapter(supabase, userId);
    return null;
  }, [opts.adapterOverride, userId]);

  const canSave = adapter != null;

  const [cards, setCards] = useState<MemorizeCard[]>(() => (adapter ? [] : loadMemorizeCards()));
  const [loading, setLoading] = useState<boolean>(adapter != null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load: from the adapter when present, else from localStorage (guest).
  useEffect(() => {
    if (!adapter) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCards(loadMemorizeCards());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    adapter.list()
      .then((loaded) => { if (!cancelled) { setCards(loaded); setLoading(false); } })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useMemorizeCards] load failed:', err);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [adapter, refreshKey]);

  const persistGuest = useCallback((next: MemorizeCard[]) => {
    setCards(next);
    saveMemorizeCards(next);
  }, []);

  const addCards = useCallback(async (incoming: NewMemorizeCard[]): Promise<MemorizeCard[]> => {
    if (incoming.length === 0) return [];
    if (!adapter) {
      // Guest: de-dupe against current cards, append with fresh ids + positions.
      const seen = new Set(cards.map(cardKey));
      let position = cards.length;
      const created: MemorizeCard[] = [];
      for (const c of incoming) {
        const k = cardKey(c);
        if (seen.has(k)) continue;
        seen.add(k);
        created.push({
          id: newGuestId(),
          book: c.book, chapter: c.chapter, verse: c.verse,
          translation: c.translation, text: c.text,
          mastery: 0, attempts: 0, lastPracticedAt: null, position: position++,
        });
      }
      if (created.length > 0) persistGuest([...cards, ...created]);
      return created;
    }
    const prev = cards;
    try {
      const created = await adapter.add(incoming);
      setCards((cur) => [...cur, ...created]);
      return created;
    } catch (err) {
      console.warn('[useMemorizeCards] add failed:', err);
      setCards(prev);
      toast.error('Could not add to Memorize. Please try again.');
      return [];
    }
  }, [adapter, cards, persistGuest]);

  const updateAfterAttempt = useCallback(async (id: string, update: AttemptUpdate) => {
    const apply = (list: MemorizeCard[]) => list.map((c) => (c.id === id ? { ...c, ...update } : c));
    if (!adapter) { persistGuest(apply(cards)); return; }
    const prev = cards;
    setCards(apply);
    try {
      await adapter.updateAfterAttempt(id, update);
    } catch (err) {
      console.warn('[useMemorizeCards] updateAfterAttempt failed:', err);
      setCards(prev);
      toast.error('Could not save your progress. Please try again.');
    }
  }, [adapter, cards, persistGuest]);

  const removeCard = useCallback(async (id: string) => {
    if (!adapter) {
      persistGuest(cards.filter((c) => c.id !== id).map((c, position) => ({ ...c, position })));
      return;
    }
    const prev = cards;
    setCards((cur) => cur.filter((c) => c.id !== id).map((c, position) => ({ ...c, position })));
    try {
      await adapter.remove(id);
    } catch (err) {
      console.warn('[useMemorizeCards] remove failed:', err);
      setCards(prev);
      toast.error('Could not remove the card. Please try again.');
    }
  }, [adapter, cards, persistGuest]);

  return { cards, canSave, loading, addCards, updateAfterAttempt, removeCard, refetch };
}
