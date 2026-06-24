import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, hasStored, KEY_BIBLE_VERSE_LAYOUT } from '../session/session-storage';
import { type VerseLayout, DEFAULT_VERSE_LAYOUT, VERSE_LAYOUTS, isVerseLayout } from './bible-layout-types';
import { supabase } from '@/lib/supabase';

export interface UseBibleVerseLayoutResult {
  verseLayout: VerseLayout;
  setLocalVerseLayout: (l: VerseLayout) => void;
  saveGlobalVerseLayout: (l: VerseLayout) => Promise<{ ok: boolean; error?: string }>;
}

export function useBibleVerseLayout(
  { userId = null }: { userId?: string | null } = {},
): UseBibleVerseLayoutResult {
  const [verseLayout, setState] = useState<VerseLayout>(() =>
    loadEnum<VerseLayout>(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS, DEFAULT_VERSE_LAYOUT),
  );

  // Seed from the profile ONLY when this device has no stored value yet.
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    if (hasStored(KEY_BIBLE_VERSE_LAYOUT)) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('bible_verse_layout').eq('id', userId).maybeSingle();
      const remote = data?.bible_verse_layout;
      if (!cancelled && isVerseLayout(remote)) {
        setState(remote);
        saveEnum(KEY_BIBLE_VERSE_LAYOUT, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setLocalVerseLayout = useCallback((l: VerseLayout) => {
    setState(l);
    saveEnum(KEY_BIBLE_VERSE_LAYOUT, l);
  }, []);

  const saveGlobalVerseLayout = useCallback(
    async (l: VerseLayout): Promise<{ ok: boolean; error?: string }> => {
      setState(l);
      saveEnum(KEY_BIBLE_VERSE_LAYOUT, l);
      if (!userId || !supabase) return { ok: true };
      const { error } = await supabase
        .from('profiles').update({ bible_verse_layout: l }).eq('id', userId);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    [userId],
  );

  return { verseLayout, setLocalVerseLayout, saveGlobalVerseLayout };
}
