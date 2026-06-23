import { useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useBibleTranslation } from '../useBibleTranslation';
import { useBibleVerseLayout } from '../useBibleVerseLayout';
import { BiblePrefsContext } from './bible-prefs-context';

/**
 * Single source of truth for Bible version + verse layout. Mirrors ThemeProvider:
 * calls each preference hook ONCE with the signed-in userId, so every consumer
 * (reader toolbar, Profile settings, notepad Scripture refs, Lamplight) reads and
 * writes the same persisted value. localStorage is the instant device default;
 * profiles.bible_translation / profiles.bible_verse_layout are the durable,
 * cross-device source of truth (handled inside the hooks).
 */
export function BiblePrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { translation, setTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setVerseLayout } = useBibleVerseLayout({ userId });

  const value = useMemo(
    () => ({ translation, setTranslation, verseLayout, setVerseLayout }),
    [translation, setTranslation, verseLayout, setVerseLayout],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
