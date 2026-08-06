// src/notepad/study/useApparatus.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { crossesTestament } from './apparatus-queries';
import type { BibleTranslation } from '../bible/translations';

export interface BookApparatus {
  book: string; full_name: string; author: string; author_note: string;
  date_label: string; region: string; cultural_context: string; genre: string; summary: string;
}
export interface CrossRefView {
  to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number;
  votes: number; crossesTestament: boolean; text: string;
}

/**
 * Book apparatus + curated cross-references for the open chapter.
 *
 * `translation` is REQUIRED, not defaulted: `bible_passages`' primary key is
 * (translation, id) since migration 036, so a cross-ref target read that does
 * not narrow on it matches one row per ingested translation — and `maybeSingle()`
 * answers that with an error, which this hook discards into empty verse text.
 * A default would silently reintroduce exactly that failure at any call site
 * that forgot to pass the reader's preference.
 */
export function useApparatus(book: string, chapter: number, translation: BibleTranslation) {
  const [bookCtx, setBookCtx] = useState<BookApparatus | null>(null);
  const [crossRefs, setCrossRefs] = useState<CrossRefView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
     
    setLoading(true); setError(null); setBookCtx(null); setCrossRefs([]);
    if (!supabase) { setLoading(false); return; }

    (async () => {
      try {
        const { data: bRow } = await supabase
          .from('bible_books')
          .select('book, full_name, author, author_note, date_label, region, cultural_context, genre, summary')
          .eq('book', book).maybeSingle();
        if (!cancelled) setBookCtx((bRow as BookApparatus | null) ?? null);

        const { data: xRows } = await supabase
          .from('bible_cross_references')
          .select('to_book, to_chapter, to_verse_start, to_verse_end, votes')
          .eq('from_book', book).eq('from_chapter', chapter)
          .order('votes', { ascending: false }).limit(8);
        const xs = (xRows ?? []) as Array<{ to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number; votes: number }>;
        const views: CrossRefView[] = [];
        for (const x of xs) {
          const id = `${x.to_book}.${x.to_chapter}.${x.to_verse_start}`;
          const { data: tgt } = await supabase
            .from('bible_passages').select('text')
            .eq('id', id).eq('translation', translation).maybeSingle();
          views.push({ ...x, crossesTestament: crossesTestament(book, x.to_book), text: (tgt as { text?: string } | null)?.text ?? '' });
        }
        if (!cancelled) setCrossRefs(views);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed to load study context');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [book, chapter, translation]);

  return { book: bookCtx, crossRefs, loading, error };
}
