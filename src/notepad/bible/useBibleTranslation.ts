import { useCallback, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_TRANSLATION } from '../session/session-storage';
import { type BibleTranslation, DEFAULT_TRANSLATION, TRANSLATIONS } from './translations';
import { supabase } from '@/lib/supabase';

const ALLOWED = TRANSLATIONS.map((t) => t.id) as readonly BibleTranslation[];

export interface UseBibleTranslationResult {
  translation: BibleTranslation;
  setLocalTranslation: (t: BibleTranslation) => void;
  saveGlobalTranslation: (t: BibleTranslation) => Promise<{ ok: boolean; error?: string }>;
}

export function useBibleTranslation(
  { userId = null }: { userId?: string | null } = {},
): UseBibleTranslationResult {
  const [translation, setState] = useState<BibleTranslation>(() =>
    loadEnum<BibleTranslation>(KEY_BIBLE_TRANSLATION, ALLOWED, DEFAULT_TRANSLATION),
  );

  // Device-local store only. Seeding the global value from the profile is owned by
  // BiblePrefsProvider so it can read all prefs in one query — this hook never reads.

  const setLocalTranslation = useCallback((t: BibleTranslation) => {
    setState(t);
    saveEnum(KEY_BIBLE_TRANSLATION, t);
  }, []);

  const saveGlobalTranslation = useCallback(
    async (t: BibleTranslation): Promise<{ ok: boolean; error?: string }> => {
      setState(t);
      saveEnum(KEY_BIBLE_TRANSLATION, t);
      if (!userId || !supabase) return { ok: true };
      const { error } = await supabase
        .from('profiles').update({ bible_translation: t }).eq('id', userId);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    [userId],
  );

  return { translation, setLocalTranslation, saveGlobalTranslation };
}
