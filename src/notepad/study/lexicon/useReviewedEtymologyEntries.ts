import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { EtymologyEntry, RelatedWord } from './buildEtymologyDeck';

interface EtymologyRow {
  strongs: string;
  lemma: string;
  root: string;
  root_gloss: string;
  development: string;
  related: RelatedWord[] | null;
  study_value: number;
  source: string;
}

export interface UseReviewedEtymologyEntriesResult {
  entries: Map<string, EtymologyEntry>;
  loading: boolean;
  error: string | null;
}

// Etymology entries are immutable reference data — one fetch per strongs suffices
// for the whole session, no matter how many verses reference it. A `null` value
// is a known-miss sentinel (no reviewed row) so absent keys are not re-queried.
const cache = new Map<string, EtymologyEntry | null>();

function mapRow(r: EtymologyRow): EtymologyEntry {
  return {
    strongs: r.strongs,
    lemma: r.lemma,
    root: r.root,
    rootGloss: r.root_gloss,
    development: r.development,
    related: r.related ?? [],
    studyValue: r.study_value,
    source: r.source,
  };
}

/**
 * Batched reader for the reviewed etymology entries of a verse's tokens. Only
 * `reviewed = true` rows are returned; any key without a reviewed row is simply
 * absent from the map (the deck builder then omits that lexical token).
 */
export function useReviewedEtymologyEntries(strongsKeys: string[]): UseReviewedEtymologyEntriesResult {
  const keys = [...new Set(strongsKeys.filter(Boolean))].sort();
  const keySig = keys.join(',');

  const buildFromCache = () => {
    const m = new Map<string, EtymologyEntry>();
    for (const k of keys) {
      const hit = cache.get(k);
      if (hit) m.set(k, hit);
    }
    return m;
  };

  const [entries, setEntries] = useState<Map<string, EtymologyEntry>>(buildFromCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (keys.length === 0) {
      setEntries(new Map()); setLoading(false); setError(null);
      return;
    }
    const missing = keys.filter((k) => !cache.has(k));
    if (missing.length === 0) {
      setEntries(buildFromCache()); setLoading(false); setError(null);
      return;
    }
    if (!supabase) {
      setEntries(buildFromCache()); setError('Etymology is unavailable.'); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_etymology')
        .select('strongs, lemma, root, root_gloss, development, related, study_value, source')
        .in('strongs', missing)
        .eq('reviewed', true);
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setEntries(buildFromCache());
      } else {
        const returned = new Set<string>();
        for (const row of (data ?? []) as EtymologyRow[]) {
          cache.set(row.strongs, mapRow(row));
          returned.add(row.strongs);
        }
        // Cache known-misses as a null sentinel so repeat verse navigation does
        // not re-fire the batch query for strongs with no reviewed row. Safe:
        // seeding/proofing is offline, so `reviewed` never flips mid-session.
        for (const k of missing) {
          if (!returned.has(k)) cache.set(k, null);
        }
        setEntries(buildFromCache());
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig]);

  return { entries, loading, error };
}
