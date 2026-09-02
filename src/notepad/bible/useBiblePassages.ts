// src/notepad/bible/useBiblePassages.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type BibleTranslation, translationInfo } from './translations';
import { fetchBibleText, makeBibleTextInvoke, bibleTextErrorMessage } from './bible-text-client';

export interface ReaderVerse {
  verse: number;
  text: string;
}

export interface UseBiblePassagesResult {
  verses: ReaderVerse[];
  loading: boolean;
  error: string | null;
  /** Re-run the fetch (the reader's "Try again" after a provider failure). */
  retry: () => void;
}

interface PassageRow {
  id: string;
  verse_start: number;
  text: string;
}

/**
 * Fetch a single chapter's verse rows. `book` is the OSIS abbrev (e.g. "jhn").
 *
 * The seam branches on TranslationInfo.source:
 *   - 'local' reads bible_passages; verse rows are selected via the id prefix
 *     so the whole-chapter pericope row ("jhn.10") is excluded. This path is
 *     byte-for-byte the original query — it is what keeps BSB/KJV/WEB
 *     rendering unchanged.
 *   - 'api' invokes the bible-text edge function (NLT, ESV) and never touches
 *     the table; failures surface as a message the reader can retry.
 */
export function useBiblePassages(book: string, chapter: number, translation: BibleTranslation): UseBiblePassagesResult {
  const [verses, setVerses] = useState<ReaderVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (!supabase) {
      setVerses([]);
      setError('Bible text is unavailable.');
      setLoading(false);
      return;
    }

    if (translationInfo(translation).source === 'api') {
      const invoke = makeBibleTextInvoke(supabase);
      (async () => {
        const res = await fetchBibleText(invoke, { book, chapter, translation });
        if (cancelled) return;
        if (res.ok) {
          setVerses(res.verses);
        } else {
          setVerses([]);
          setError(bibleTextErrorMessage(res.reason, translation));
        }
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_passages')
        .select('id, verse_start, text')
        .eq('translation', translation)
        .like('id', `${book}.${chapter}.%`)
        .order('verse_start', { ascending: true });
      if (cancelled) return;
      if (qErr) {
        setVerses([]);
        setError(qErr.message);
      } else {
        setVerses(((data ?? []) as PassageRow[]).map((r) => ({ verse: r.verse_start, text: r.text })));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [book, chapter, translation, attempt]);

  return { verses, loading, error, retry };
}
