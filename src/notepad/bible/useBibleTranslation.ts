import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, hasValidStored, KEY_BIBLE_TRANSLATION } from '../session/session-storage';
import { type BibleTranslation, DEFAULT_TRANSLATION, TRANSLATIONS, isBibleTranslation } from './translations';
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

  // Seed from the profile ONLY when this device has no stored value yet. A device
  // that already has a local pick keeps it — local wins on reload (the bug fix).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    if (hasValidStored(KEY_BIBLE_TRANSLATION, ALLOWED)) return;
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
