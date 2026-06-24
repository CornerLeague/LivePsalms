import { createContext, useContext } from 'react';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';

export interface BiblePrefsContextValue {
  translation: BibleTranslation;
  verseLayout: VerseLayout;
  /** Pillar / any in-reader control: localStorage only, no DB. */
  setLocalTranslation: (t: BibleTranslation) => void;
  setLocalVerseLayout: (l: VerseLayout) => void;
  /** Profile Settings → Save: awaited DB (both columns) + localStorage + state. */
  saveGlobalPrefs: (
    p: { translation: BibleTranslation; verseLayout: VerseLayout },
  ) => Promise<{ ok: boolean; error?: string }>;
  /** @deprecated transitional alias for setLocalTranslation; removed in the cleanup task. */
  setTranslation: (t: BibleTranslation) => void;
  /** @deprecated transitional alias for setLocalVerseLayout; removed in the cleanup task. */
  setVerseLayout: (l: VerseLayout) => void;
}

export const BiblePrefsContext = createContext<BiblePrefsContextValue | null>(null);

export function useBiblePrefs(): BiblePrefsContextValue {
  const ctx = useContext(BiblePrefsContext);
  if (!ctx) throw new Error('useBiblePrefs must be used within a BiblePrefsProvider');
  return ctx;
}
