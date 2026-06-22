import { useCallback, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_TRANSLATION } from '../session/session-storage';
import { type BibleTranslation, DEFAULT_TRANSLATION, TRANSLATIONS } from './translations';

const ALLOWED = TRANSLATIONS.map((t) => t.id) as readonly BibleTranslation[];

export interface UseBibleTranslationResult {
  translation: BibleTranslation;
  setTranslation: (t: BibleTranslation) => void;
}

export function useBibleTranslation(): UseBibleTranslationResult {
  const [translation, setState] = useState<BibleTranslation>(() =>
    loadEnum<BibleTranslation>(KEY_BIBLE_TRANSLATION, ALLOWED, DEFAULT_TRANSLATION),
  );
  const setTranslation = useCallback((t: BibleTranslation) => {
    setState(t);
    saveEnum(KEY_BIBLE_TRANSLATION, t);
  }, []);
  return { translation, setTranslation };
}
