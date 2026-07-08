import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type InsightGenerateResult =
  | { ok: true; body: string; cached: boolean }
  | { ok: false; reason: 'no_entry' | 'network' };

export interface InsightGenerator {
  generateEtymologyInsight(strongs: string, verseId: string): Promise<InsightGenerateResult>;
}

export interface UseEtymologyVerseInsightResult {
  insight: { body: string } | null;
  loading: boolean;
  error: string | null;
  generating: boolean;
  generate: () => Promise<void>;
}

/**
 * Reads the shared per-(word, verse) insight. A present row renders free for
 * everyone (it's a DB read). On a miss, `generate()` routes through the adapter
 * (edge function) — callers gate that button on entitlement before showing it.
 */
export function useEtymologyVerseInsight(
  strongs: string | null,
  verseId: string | null,
  adapter: InsightGenerator | null,
): UseEtymologyVerseInsightResult {
  const [insight, setInsight] = useState<{ body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (strongs == null || verseId == null || !supabase) {
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setInsight(null);

      const { data, error: qErr } = await supabase
        .from('bible_etymology_verse_insight')
        .select('body')
        .eq('strongs', strongs)
        .eq('verse_id', verseId)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setInsight(null); // a failed read degrades to the Ask button, never blanks
      } else if (data) {
        setInsight({ body: (data as { body: string }).body });
      } else {
        setInsight(null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [strongs, verseId]);

  const generate = useCallback(async () => {
    if (!adapter || strongs == null || verseId == null) { setError('network'); return; }
    setGenerating(true);
    setError(null);
    const res = await adapter.generateEtymologyInsight(strongs, verseId);
    if (res.ok) {
      setInsight({ body: res.body });
    } else {
      setError(res.reason);
    }
    setGenerating(false);
  }, [adapter, strongs, verseId]);

  return { insight, loading, error, generating, generate };
}
