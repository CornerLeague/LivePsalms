import { useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useBibleTranslation } from '../useBibleTranslation';
import { useBibleVerseLayout } from '../useBibleVerseLayout';
import { BiblePrefsContext } from './bible-prefs-context';

/**
 * Single source of truth for Bible version + verse layout. Calls each hook ONCE
 * with the signed-in userId. localStorage is the authoritative per-device value;
 * the profile row is the global value — seeded once on a fresh device and written
 * only by Profile Settings → Save.
 */
export function BiblePrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { translation, setLocalTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setLocalVerseLayout } = useBibleVerseLayout({ userId });

  // Transitional: the context still exposes setTranslation/setVerseLayout until the
  // interface migrates in the next task. They alias the local setters (no DB write).
  const value = useMemo(
    () => ({
      translation,
      setTranslation: setLocalTranslation,
      verseLayout,
      setVerseLayout: setLocalVerseLayout,
    }),
    [translation, setLocalTranslation, verseLayout, setLocalVerseLayout],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
