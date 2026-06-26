import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LexiconLanguage } from './useVerseLexicon';

export interface StrongsEntry {
  strongs: string;
  lemma: string;
  transliteration: string;
  pronunciation: string;
  shortDef: string;
  fullDef: string;
  language: LexiconLanguage;
}

export interface UseStrongsEntryResult {
  entry: StrongsEntry | null;
  loading: boolean;
  error: string | null;
}

interface StrongsRow {
  strongs: string;
  lemma: string;
  transliteration: string;
  pronunciation: string;
  short_def: string;
  full_def: string;
  language: LexiconLanguage;
}

// Strong's entries are immutable reference data, so one fetch per number is
// enough no matter how many verses/words reference it this session.
const cache = new Map<string, StrongsEntry>();

/** Lazily fetch one Strong's dictionary entry; null clears without querying. */
export function useStrongsEntry(strongs: string | null): UseStrongsEntryResult {
  const [entry, setEntry] = useState<StrongsEntry | null>(strongs ? cache.get(strongs) ?? null : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (strongs == null) {
      setEntry(null); setLoading(false); setError(null);
      return;
    }
    const cached = cache.get(strongs);
    if (cached) {
      setEntry(cached); setLoading(false); setError(null);
      return;
    }
    if (!supabase) {
      setEntry(null); setError('Lexicon is unavailable.'); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_strongs')
        .select('strongs, lemma, transliteration, pronunciation, short_def, full_def, language')
        .eq('strongs', strongs)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setEntry(null); setError(qErr.message);
      } else if (data) {
        const r = data as StrongsRow;
        const mapped: StrongsEntry = {
          strongs: r.strongs,
          lemma: r.lemma,
          transliteration: r.transliteration,
          pronunciation: r.pronunciation,
          shortDef: r.short_def,
          fullDef: r.full_def,
          language: r.language,
        };
        cache.set(strongs, mapped);
        setEntry(mapped);
      } else {
        setEntry(null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [strongs]);

  return { entry, loading, error };
}
