import { createContext, useContext } from 'react';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';

export interface BiblePrefsContextValue {
  translation: BibleTranslation;
  setTranslation: (t: BibleTranslation) => void;
  verseLayout: VerseLayout;
  setVerseLayout: (l: VerseLayout) => void;
}

export const BiblePrefsContext = createContext<BiblePrefsContextValue | null>(null);

export function useBiblePrefs(): BiblePrefsContextValue {
  const ctx = useContext(BiblePrefsContext);
  if (!ctx) throw new Error('useBiblePrefs must be used within a BiblePrefsProvider');
  return ctx;
}
