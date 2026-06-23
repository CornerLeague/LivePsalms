import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_VERSE_LAYOUT } from '../session/session-storage';
import { type VerseLayout, DEFAULT_VERSE_LAYOUT, VERSE_LAYOUTS, isVerseLayout } from './bible-layout-types';
import { supabase } from '@/lib/supabase';

export interface UseBibleVerseLayoutResult {
  verseLayout: VerseLayout;
  setVerseLayout: (layout: VerseLayout) => void;
}

export function useBibleVerseLayout(
  { userId = null }: { userId?: string | null } = {},
): UseBibleVerseLayoutResult {
  const [verseLayout, setState] = useState<VerseLayout>(() =>
    loadEnum<VerseLayout>(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS, DEFAULT_VERSE_LAYOUT),
  );

  // Hydrate from the profile when signed in (localStorage is the instant default).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
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

  const setVerseLayout = useCallback((layout: VerseLayout) => {
    setState(layout);
    saveEnum(KEY_BIBLE_VERSE_LAYOUT, layout);
    if (userId && supabase) {
      void supabase.from('profiles').update({ bible_verse_layout: layout }).eq('id', userId);
    }
  }, [userId]);

  return { verseLayout, setVerseLayout };
}
