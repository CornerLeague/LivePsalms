import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type LexiconLanguage = 'hebrew' | 'aramaic' | 'greek';

export interface InterlinearWord {
  position: number;
  original: string;
  transliteration: string;
  strongs: string | null;
  morph: string;
  gloss: string;
}

export interface UseVerseLexiconResult {
  words: InterlinearWord[];
  language: LexiconLanguage | null;
  loading: boolean;
  error: string | null;
}

interface InterlinearRow extends InterlinearWord {
  language: LexiconLanguage;
}

/**
 * Fetch the word-by-word interlinear for one verse from bible_interlinear.
 * `verseId` is the OSIS id (e.g. "jhn.3.16"); null clears the result without
 * querying. The verse's language is taken from its first word row.
 */
export function useVerseLexicon(verseId: string | null): UseVerseLexiconResult {
  const [words, setWords] = useState<InterlinearWord[]>([]);
  const [language, setLanguage] = useState<LexiconLanguage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (verseId == null) {
      setWords([]); setLanguage(null); setLoading(false); setError(null);
      return;
    }
    if (!supabase) {
      setWords([]); setLanguage(null); setError('Lexicon is unavailable.'); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_interlinear')
        .select('position, original, transliteration, strongs, morph, gloss, language')
        .eq('verse_id', verseId)
        .order('position', { ascending: true });
      if (cancelled) return;
      if (qErr) {
        setWords([]); setLanguage(null); setError(qErr.message);
      } else {
        const rows = (data ?? []) as InterlinearRow[];
        setWords(rows.map(({ position, original, transliteration, strongs, morph, gloss }) => ({
          position, original, transliteration, strongs, morph, gloss,
        })));
        setLanguage(rows[0]?.language ?? null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [verseId]);

  return { words, language, loading, error };
}
