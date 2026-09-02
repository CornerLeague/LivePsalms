// Assembles display verse text for a focus list. The pure assembler maps each
// item to the rows within its verse range (and flags missing-in-translation
// items); the hook batch-fetches one bible_passages query per distinct
// (book, chapter) — mirroring useBiblePassages.ts — and re-fetches on translation
// change. Text is fetched live so a list reads correctly in every translation:
// local ones (BSB / KJV / WEB) from the table, api-sourced ones (NLT / ESV)
// through the bible-text edge function — the branch is on
// TranslationInfo.source, and the table query is untouched.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type BibleTranslation, translationInfo } from '../translations';
import { fetchBibleText, makeBibleTextInvoke, bibleTextErrorMessage } from '../bible-text-client';
import type { FocusListItem } from './focus-list-types';

export interface FocusVerseLine {
  verse: number;
  text: string;
}

export interface FocusItemText {
  item: FocusListItem;
  lines: FocusVerseLine[];
  missing: boolean;
}

interface PassageRow {
  id: string;
  verse_start: number;
  text: string;
}

/** Map each item to the fetched rows inside its verse range. Pure + sync. */
export function assembleFocusItemTexts(
  items: FocusListItem[],
  rowsByChapter: Map<string, FocusVerseLine[]>,
): FocusItemText[] {
  return items.map((item) => {
    const rows = rowsByChapter.get(`${item.book}.${item.chapter}`) ?? [];
    const lines = rows.filter((r) => r.verse >= item.verseStart && r.verse <= item.verseEnd);
    return { item, lines, missing: lines.length === 0 };
  });
}

export interface UseFocusListVerseTextResult {
  itemTexts: FocusItemText[];
  loading: boolean;
  /**
   * Set when a chapter could not be FETCHED (provider down, rate-limited,
   * sign-in needed, key missing), as opposed to fetched and found empty. Items
   * in a failed chapter are still flagged `missing`, so the view must check
   * this first: "Not available in NLT" is a lie when the truth is "NLT is busy".
   */
  error: string | null;
  /** Re-run the fetch (the view's "Try again"). */
  retry: () => void;
}

/**
 * Fetch + assemble verse text for a focus list's items in the given translation.
 * One query per distinct (book, chapter); re-runs when the chapter set or the
 * translation changes.
 */
export function useFocusListVerseText(
  items: FocusListItem[],
  translation: BibleTranslation,
): UseFocusListVerseTextResult {
  const [rowsByChapter, setRowsByChapter] = useState<Map<string, FocusVerseLine[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // Distinct, sorted `${book}.${chapter}` keys; the join is the effect's signal so
  // a new array identity with the same chapters does not re-fetch.
  const keySignature = useMemo(() => {
    const keys = new Set<string>();
    for (const it of items) keys.add(`${it.book}.${it.chapter}`);
    return [...keys].sort().join(',');
  }, [items]);

  useEffect(() => {
    const keys = keySignature ? keySignature.split(',') : [];
    if (!supabase || keys.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRowsByChapter(new Map());
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const apiSourced = translationInfo(translation).source === 'api';
    const invoke = apiSourced ? makeBibleTextInvoke(supabase) : null;
    // The first fetch failure, worded for the reader. A chapter that failed to
    // fetch still contributes no rows (its items read as missing), but the view
    // shows this instead of "Not available in <translation>".
    let firstError: string | null = null;
    (async () => {
      const entries = await Promise.all(
        keys.map(async (key) => {
          const [book, chapterStr] = key.split('.');
          if (apiSourced) {
            const res = await fetchBibleText(invoke, { book, chapter: Number(chapterStr), translation });
            if (!res.ok) firstError ??= bibleTextErrorMessage(res.reason, translation);
            return [key, res.ok ? res.verses : ([] as FocusVerseLine[])] as const;
          }
          const { data, error } = await supabase!
            .from('bible_passages')
            .select('id, verse_start, text')
            .eq('translation', translation)
            .like('id', `${book}.${chapterStr}.%`)
            .order('verse_start', { ascending: true });
          if (error) firstError ??= error.message;
          if (error || !data) return [key, [] as FocusVerseLine[]] as const;
          const lines = (data as PassageRow[]).map((r) => ({ verse: r.verse_start, text: r.text }));
          return [key, lines] as const;
        }),
      );
      if (cancelled) return;
      setRowsByChapter(new Map(entries));
      setError(firstError);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [keySignature, translation, attempt]);

  const itemTexts = useMemo(
    () => assembleFocusItemTexts(items, rowsByChapter),
    [items, rowsByChapter],
  );

  return { itemTexts, loading, error, retry };
}
