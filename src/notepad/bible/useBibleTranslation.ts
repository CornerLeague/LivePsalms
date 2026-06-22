import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_TRANSLATION } from '../session/session-storage';
import { type BibleTranslation, DEFAULT_TRANSLATION, TRANSLATIONS, isBibleTranslation } from './translations';
import { supabase } from '@/lib/supabase';

const ALLOWED = TRANSLATIONS.map((t) => t.id) as readonly BibleTranslation[];

export interface UseBibleTranslationResult {
  translation: BibleTranslation;
  setTranslation: (t: BibleTranslation) => void;
}

export function useBibleTranslation(
  { userId = null }: { userId?: string | null } = {},
): UseBibleTranslationResult {
  const [translation, setState] = useState<BibleTranslation>(() =>
    loadEnum<BibleTranslation>(KEY_BIBLE_TRANSLATION, ALLOWED, DEFAULT_TRANSLATION),
  );

  // Hydrate from the profile when signed in (localStorage is the instant default).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('bible_translation').eq('id', userId).maybeSingle();
      const remote = data?.bible_translation;
      if (!cancelled && isBibleTranslation(remote)) {
        setState(remote);
        saveEnum(KEY_BIBLE_TRANSLATION, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setTranslation = useCallback((t: BibleTranslation) => {
    setState(t);
    saveEnum(KEY_BIBLE_TRANSLATION, t);
    if (userId && supabase) {
      void supabase.from('profiles').update({ bible_translation: t }).eq('id', userId);
    }
  }, [userId]);

  return { translation, setTranslation };
}
