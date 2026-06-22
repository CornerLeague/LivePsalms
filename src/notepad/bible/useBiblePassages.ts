// src/notepad/bible/useBiblePassages.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { BibleTranslation } from './translations';

export interface ReaderVerse {
  verse: number;
  text: string;
}

export interface UseBiblePassagesResult {
  verses: ReaderVerse[];
  loading: boolean;
  error: string | null;
}

interface PassageRow {
  id: string;
  verse_start: number;
  text: string;
}

/**
 * Fetch a single chapter's verse rows from bible_passages. `book` is the OSIS
 * abbrev (e.g. "jhn"); verse rows are selected via the id prefix so the
 * whole-chapter pericope row ("jhn.10") is excluded.
 */
export function useBiblePassages(book: string, chapter: number, translation: BibleTranslation): UseBiblePassagesResult {
  const [verses, setVerses] = useState<ReaderVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [book, chapter, translation]);

  return { verses, loading, error };
}
