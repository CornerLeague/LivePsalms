// src/notepad/study/useStudyChatHistory.ts
// Global, newest-first list of every Study conversation for the signed-in user
// (across all passages, archived + active). RLS already scopes rows to the user.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface StudyHistoryItem {
  threadId: string;
  book: string;
  chapter: number;
  title: string;
  updatedAt: string;
}

export interface UseStudyChatHistoryResult {
  items: StudyHistoryItem[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const HISTORY_LIST_LIMIT = 50;

export function useStudyChatHistory(userId: string | null): UseStudyChatHistoryResult {
  const [items, setItems] = useState<StudyHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Reset to a loading state whenever the user changes. Mirrors the
    // sibling useStudyChatThread effect; the synchronous reset is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setItems([]);

    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    (async () => {
      const { data, error: qErr } = await supabase
        .from('lamplight_chat_threads')
        .select('id, book, chapter, title, updated_at')
        .eq('user_id', userId)
        .eq('surface', 'study')
        .order('updated_at', { ascending: false })
        .limit(HISTORY_LIST_LIMIT);
      if (cancelled) return;
      if (qErr) { setError(qErr.message); setItems([]); setLoading(false); return; }
      const rows = (data ?? []) as Array<{ id: string; book: string; chapter: number; title: string | null; updated_at: string }>;
      setItems(rows.map((r) => ({
        threadId: r.id, book: r.book, chapter: r.chapter, title: r.title ?? '', updatedAt: r.updated_at,
      })));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [userId, nonce]);

  return { items, loading, error, reload };
}
