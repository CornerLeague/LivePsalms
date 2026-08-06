// src/notepad/study/insights/usePassageInsight.ts
// Insights Door 1 ("The Passage") — the reader's two paths.
//
// CACHED → one public DB read, rendered immediately. No spinner, no stream, no
// entitlement: `bible_passage_insight` is public-read (migration 060), exactly
// like `bible_etymology_verse_insight`, so a signed-out reader sees what a
// subscriber sees.
//
// UNCACHED → nothing happens until the reader presses "Study this passage".
// The explicit generate is a product decision, not a performance one: a door
// that generated on open would bill a model call for every passage anyone
// glanced at.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  PASSAGE_SECTIONS,
  passageRefId,
  passageScopeKind,
  type PassageInsightInvoke,
  type PassageInsightScope,
} from './passage-insight-stream-client';

export interface UsePassageInsightResult {
  /** null = never generated. A door that generated with nothing to say is `{}` of empty strings, which is different. */
  sections: Record<string, string> | null;
  /** Reading the cache. */
  loading: boolean;
  /** Generating. */
  streaming: boolean;
  error: string | null;
  /** True once the door is known to be in the shared cache. */
  cached: boolean;
  generate: () => Promise<void>;
}

const DOOR = 'passage';

interface CacheRow { section: string; body: string }

/**
 * @param invoke null for a reader who cannot generate (signed out, or without
 *   Plus/promo). The cache read still runs — cached doors are free and public.
 */
export function usePassageInsight(
  scope: PassageInsightScope,
  invoke: PassageInsightInvoke | null,
): UsePassageInsightResult {
  const [sections, setSections] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  // Keyed on the primitive fields, not the object, so a caller passing an
  // inline literal does not refetch on every render.
  const { book, chapter, verse } = scope;
  const resolved = useMemo(
    () => ({ scope: { book, chapter, verse }, refId: passageRefId({ book, chapter, verse }) }),
    [book, chapter, verse],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!supabase) { setLoading(false); return; }
      setLoading(true);
      setSections(null);
      setCached(false);
      setError(null);

      const { data, error: qErr } = await supabase
        .from('bible_passage_insight')
        .select('section, body')
        .eq('scope', passageScopeKind(resolved.scope))
        .eq('ref_id', resolved.refId)
        .eq('door', DOOR);

      if (cancelled) return;

      // A failed read degrades to the generate path, never to an error state:
      // the reader can still get their door, and a transport blip is not
      // something to put on screen.
      const rows = (qErr ? [] : (data ?? [])) as CacheRow[];
      if (rows.length === 0) {
        setSections(null);
      } else {
        const bySection = new Map(rows.map((r) => [r.section, r.body]));
        setSections(Object.fromEntries(PASSAGE_SECTIONS.map((s) => [s.key, bySection.get(s.key) ?? ''])));
        setCached(true);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [resolved]);

  const generate = useCallback(async () => {
    if (!invoke) return;
    setStreaming(true);
    setError(null);
    // Start from four empty strings rather than null: the sections are about to
    // fill in one at a time, and the door renders each as it arrives.
    setSections(Object.fromEntries(PASSAGE_SECTIONS.map((s) => [s.key, ''])));

    try {
      await invoke(resolved.scope, {
        onCached: ({ sections: warm }) => {
          // Another reader warmed this door between our read and our press.
          setSections(Object.fromEntries(PASSAGE_SECTIONS.map((s) => [s.key, warm[s.key] ?? ''])));
          setCached(true);
        },
        onEvent: (ev) => {
          if (ev.t === 'text') {
            // ACCUMULATE. A delta is a fragment, not a field.
            setSections((prev) => ({ ...(prev ?? {}), [ev.field]: (prev?.[ev.field] ?? '') + ev.delta }));
            return;
          }
          if (ev.t === 'piece' && typeof ev.value === 'string') {
            setSections((prev) => ({ ...(prev ?? {}), [ev.field]: ev.value as string }));
            return;
          }
          if (ev.t === 'done') {
            const payload = ev.payload as { sections?: Record<string, string>; cached?: boolean } | null;
            if (payload?.sections) {
              setSections(Object.fromEntries(
                PASSAGE_SECTIONS.map((s) => [s.key, payload.sections?.[s.key] ?? '']),
              ));
            }
            // FALSE when the server refused to write an all-empty door. Saying
            // otherwise would leave the reader looking at nothing, with the
            // door claiming to be warm and no way to try again.
            setCached(payload?.cached === true);
            return;
          }
          if (ev.t === 'error') {
            setError(ev.reason);
            // Back to null, NOT to the partial text the reader watched arrive.
            // The server wrote nothing, so there is no door — leaving fragments
            // on screen would show one that does not exist, and leaving four
            // empty strings would strand the reader with no way to try again.
            setSections(null);
          }
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network');
      setSections(null);
    } finally {
      setStreaming(false);
    }
  }, [invoke, resolved]);

  return { sections, loading, streaming, error, cached, generate };
}
