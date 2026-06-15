import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabase';
import { fetchVerseText } from '../graph/reference-parser';
import { osisBookToCanonical } from './verse-search';
import type { RawFtsRow, RawSemanticRow, PericopeRange, VerseSearchDeps } from './verse-search-types';

const FTS_LIMIT = 20;

export function createBrowserVerseSearchDeps(
  client: SupabaseClient | null = defaultSupabase,
): VerseSearchDeps {
  return {
    async ftsSearch(query, opts): Promise<RawFtsRow[]> {
      if (!client || !query.trim()) return [];
      let q = client
        .from('bible_passages')
        .select('id, book, chapter, verse_start, verse_end, text')
        .eq('translation', 'BSB')
        .textSearch('text_tsv', query, { type: 'websearch' })
        .limit(FTS_LIMIT)
        .order('id', { ascending: true });
      if (opts.signal) q = q.abortSignal(opts.signal);
      const { data, error } = await q;
      if (error || !data) return [];
      return (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        book: r.book as string,
        chapter: r.chapter as number,
        verseStart: r.verse_start as number,
        verseEnd: (r.verse_end ?? null) as number | null,
        text: (r.text as string) ?? '',
      }));
    },

    async semanticSearch(query): Promise<RawSemanticRow[]> {
      if (!client || !query.trim()) return [];
      try {
        const { data, error } = await client.functions.invoke('verse-search', { body: { query } });
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
        .eq('translation', 'BSB')
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

    fetchVerseText,
  };
}
