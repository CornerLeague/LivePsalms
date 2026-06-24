import { useCallback, useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import type { BibleTranslation } from '../translations';
import type { VerseLayout } from '../bible-layout-types';
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
  const { translation, setLocalTranslation, saveGlobalTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setLocalVerseLayout, saveGlobalVerseLayout } = useBibleVerseLayout({ userId });

  const saveGlobalPrefs = useCallback(
    async (
      p: { translation: BibleTranslation; verseLayout: VerseLayout },
    ): Promise<{ ok: boolean; error?: string }> => {
      const [tRes, lRes] = await Promise.all([
        saveGlobalTranslation(p.translation),
        saveGlobalVerseLayout(p.verseLayout),
      ]);
      if (!tRes.ok) return tRes;
      if (!lRes.ok) return lRes;
      return { ok: true };
    },
    [saveGlobalTranslation, saveGlobalVerseLayout],
  );

  const value = useMemo(
    () => ({
      translation,
      verseLayout,
      setLocalTranslation,
      setLocalVerseLayout,
      saveGlobalPrefs,
    }),
    [translation, verseLayout, setLocalTranslation, setLocalVerseLayout, saveGlobalPrefs],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
