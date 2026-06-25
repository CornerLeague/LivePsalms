import { useCallback, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_VERSE_LAYOUT } from '../session/session-storage';
import { type VerseLayout, DEFAULT_VERSE_LAYOUT, VERSE_LAYOUTS } from './bible-layout-types';
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

  // Device-local store only. Seeding the global value from the profile is owned by
  // BiblePrefsProvider so it can read all prefs in one query — this hook never reads.

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
