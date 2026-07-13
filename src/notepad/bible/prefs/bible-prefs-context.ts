import { createContext, useContext } from 'react';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';
import type { TextSize } from '../text-size-types';

export interface BiblePrefsContextValue {
  translation: BibleTranslation;
  verseLayout: VerseLayout;
  /** Shared 3-level text-size preference (Journal editor + Bible/Study reader). */
  textSize: TextSize;
  /** Pillar / any in-reader control: localStorage only, no DB. */
  setLocalTranslation: (t: BibleTranslation) => void;
  setLocalVerseLayout: (l: VerseLayout) => void;
  setLocalTextSize: (s: TextSize) => void;
  /** Profile Settings → Save: awaited DB (all columns) + localStorage + state. */
  saveGlobalPrefs: (
    p: { translation: BibleTranslation; verseLayout: VerseLayout; textSize: TextSize },
  ) => Promise<{ ok: boolean; error?: string }>;
}

export const BiblePrefsContext = createContext<BiblePrefsContextValue | null>(null);

export function useBiblePrefs(): BiblePrefsContextValue {
  const ctx = useContext(BiblePrefsContext);
  if (!ctx) throw new Error('useBiblePrefs must be used within a BiblePrefsProvider');
  return ctx;
}
