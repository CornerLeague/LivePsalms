import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { supabase } from '@/lib/supabase';
import { KEY_BIBLE_TRANSLATION, KEY_BIBLE_VERSE_LAYOUT, KEY_TEXT_SIZE, hasValidStored } from '../../session/session-storage';
import { type BibleTranslation, TRANSLATIONS, isBibleTranslation } from '../translations';
import { type VerseLayout, VERSE_LAYOUTS, isVerseLayout } from '../bible-layout-types';
import { type TextSize, TEXT_SIZES, isTextSize } from '../text-size-types';
import { useBibleTranslation } from '../useBibleTranslation';
import { useBibleVerseLayout } from '../useBibleVerseLayout';
import { useTextSize } from '../useTextSize';
import { BiblePrefsContext } from './bible-prefs-context';

const ALLOWED_TRANSLATIONS = TRANSLATIONS.map((t) => t.id) as readonly string[];

/**
 * Single source of truth for Bible version + verse layout. Calls each hook ONCE
 * with the signed-in userId. localStorage is the authoritative per-device value;
 * the profile row is the global value — seeded once on a fresh device and written
 * only by Profile Settings → Save.
 *
 * Seeding lives HERE (not in the hooks) so a fresh device reads both columns in a
 * SINGLE profiles query instead of one round-trip per pref.
 */
export function BiblePrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { translation, setLocalTranslation, saveGlobalTranslation } = useBibleTranslation({ userId });
  const { verseLayout, setLocalVerseLayout, saveGlobalVerseLayout } = useBibleVerseLayout({ userId });
  const { textSize, setLocalTextSize, saveGlobalTextSize } = useTextSize({ userId });

  // Seed the global (profile) values onto a fresh device. Each pref is seeded only
  // when this device has no valid local pick — local wins on reload. Skipped
  // entirely (no query) when all three are already stored locally.
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    const needsTranslation = !hasValidStored(KEY_BIBLE_TRANSLATION, ALLOWED_TRANSLATIONS);
    const needsLayout = !hasValidStored(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS);
    const needsTextSize = !hasValidStored(KEY_TEXT_SIZE, TEXT_SIZES);
    if (!needsTranslation && !needsLayout && !needsTextSize) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('bible_translation, bible_verse_layout, text_size')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled || !data) return;
      // Re-check after the await — the user may have made a local pick in the
      // reader while the query was in flight. Local always wins, so never seed
      // over a value that is now validly stored on this device.
      if (
        !hasValidStored(KEY_BIBLE_TRANSLATION, ALLOWED_TRANSLATIONS) &&
        isBibleTranslation(data.bible_translation)
      ) {
        setLocalTranslation(data.bible_translation);
      }
      if (
        !hasValidStored(KEY_BIBLE_VERSE_LAYOUT, VERSE_LAYOUTS) &&
        isVerseLayout(data.bible_verse_layout)
      ) {
        setLocalVerseLayout(data.bible_verse_layout);
      }
      if (
        !hasValidStored(KEY_TEXT_SIZE, TEXT_SIZES) &&
        isTextSize(data.text_size)
      ) {
        setLocalTextSize(data.text_size);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, setLocalTranslation, setLocalVerseLayout, setLocalTextSize]);

  const saveGlobalPrefs = useCallback(
    async (
      p: { translation: BibleTranslation; verseLayout: VerseLayout; textSize: TextSize },
    ): Promise<{ ok: boolean; error?: string }> => {
      const [tRes, lRes, sRes] = await Promise.all([
        saveGlobalTranslation(p.translation),
        saveGlobalVerseLayout(p.verseLayout),
        saveGlobalTextSize(p.textSize),
      ]);
      if (!tRes.ok) return tRes;
      if (!lRes.ok) return lRes;
      if (!sRes.ok) return sRes;
      return { ok: true };
    },
    [saveGlobalTranslation, saveGlobalVerseLayout, saveGlobalTextSize],
  );

  const value = useMemo(
    () => ({
      translation,
      verseLayout,
      textSize,
      setLocalTranslation,
      setLocalVerseLayout,
      setLocalTextSize,
      saveGlobalPrefs,
    }),
    [translation, verseLayout, textSize, setLocalTranslation, setLocalVerseLayout, setLocalTextSize, saveGlobalPrefs],
  );

  return <BiblePrefsContext.Provider value={value}>{children}</BiblePrefsContext.Provider>;
}
