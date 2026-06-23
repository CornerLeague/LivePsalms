import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabase';
import { fetchVerseText } from '../graph/reference-parser';
import { osisBookToCanonical, detectGrain } from './verse-search';
import type { RawFtsRow, RawSemanticRow, PericopeRange, VerseSearchDeps } from './verse-search-types';
import { type BibleTranslation, DEFAULT_TRANSLATION } from './translations';

const FTS_LIMIT = 20;

export function createBrowserVerseSearchDeps(
  client: SupabaseClient | null = defaultSupabase,
  translation: BibleTranslation = DEFAULT_TRANSLATION,
): VerseSearchDeps {
  return {
    async ftsSearch(query, opts): Promise<RawFtsRow[]> {
      if (!client || !query.trim()) return [];
      let q = client
        .from('bible_passages')
        .select('id, book, chapter, verse_start, verse_end, text')
        .eq('translation', translation)
        // bible_passages holds BOTH verse-grain rows (id "psa.23.1", ≥2 dots) and
        // pericope-grain aggregates (id "psa.23", 1 dot). The /verse picker inserts
        // single verses, so restrict FTS to verse-grain at the DB level — LIKE treats
        // '.' as literal, so '%.%.%' = ≥2 dots = verse-grain. This keeps the FTS_LIMIT
        // budget on verses (passages still surface via the semantic path's pericope
        // resolution). See scripts/ingest-bsb.ts for the dual-grain ingest.
        .like('id', '%.%.%')
        .textSearch('text_tsv', query, { type: 'websearch' })
        .limit(FTS_LIMIT)
        .order('id', { ascending: true });
      if (opts.signal) q = q.abortSignal(opts.signal);
      const { data, error } = await q;
      if (error || !data) return [];
      return (data as Array<Record<string, unknown>>)
        // Defensive guard: keep verse-only output even if a pericope id slips past
        // the DB filter (e.g. a future id-format change). Cheap, and it makes the
        // verse-grain contract verifiable without a live DB.
        .filter((r) => detectGrain(r.id as string) === 'verse')
        .map((r) => ({
          id: r.id as string,
          book: r.book as string,
          chapter: r.chapter as number,
          verseStart: r.verse_start as number,
          verseEnd: (r.verse_end ?? null) as number | null,
          text: (r.text as string) ?? '',
        }));
    },

    async semanticSearch(query, opts): Promise<RawSemanticRow[]> {
      if (!client || !query.trim()) return [];
      try {
        // Forward the signal so a newer keystroke aborts the in-flight request;
        // an aborted invoke throws -> caught below -> returns [] (graceful degrade).
        const { data, error } = await client.functions.invoke('verse-search', {
          body: { query },
          signal: opts.signal,
        });
        if (error || !data) return [];
        const matches = (data as { matches?: RawSemanticRow[] }).matches ?? [];
        return matches.map((m) => ({ sourceId: m.sourceId, text: m.text, similarity: m.similarity }));
      } catch {
        return [];
      }
    },

    async resolvePericope(pericopeId, opts): Promise<PericopeRange | null> {
      if (!client) return null;
      const osisBook = pericopeId.split('.')[0];
      const book = osisBookToCanonical(osisBook);
      if (!book) return null;
      let q = client
        .from('bible_passages')
        .select('chapter, verse_start, verse_end, text')
        .eq('pericope_id', pericopeId)
        .eq('translation', translation)
        .order('verse_start', { ascending: true });
      if (opts.signal) q = q.abortSignal(opts.signal);
      const { data, error } = await q;
      if (error || !data || data.length === 0) return null;
      const rows = data as Array<{ chapter: number; verse_start: number; verse_end: number | null; text: string }>;
      const verseStart = Math.min(...rows.map((r) => r.verse_start));
      const verseEnd = Math.max(...rows.map((r) => r.verse_end ?? r.verse_start));
      const text = rows.map((r) => r.text ?? '').join(' ').trim();
      return { book, chapter: rows[0].chapter, verseStart, verseEnd, text };
    },

    fetchVerseText: (ref, o) => fetchVerseText(ref, { translation, ...o }),
  };
}
