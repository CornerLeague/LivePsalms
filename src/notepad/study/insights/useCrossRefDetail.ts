// src/notepad/study/insights/useCrossRefDetail.ts
// What a cross-reference expands into, in place: the target passage inside its
// own immediate context, the target book's footing, and the church's voices on
// that ref.
//
// Deliberately NO generated explanation of why the two passages connect. That
// contract — typed roads, confidence tiers, the typology gate — belongs to the
// Connections Engine (depth overhaul pillar D). Here the reader is shown both
// passages and draws the line themselves; when the engine lands, its
// explanation drops into a slot that already exists.
//
// Lazy by construction: pass `null` until the row is actually expanded, or a
// chapter's worth of cross-references would fire three queries each on open.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { BibleTranslation } from '@/notepad/bible/translations';
import { useLibraryVoices, type LibraryVoice } from './useLibraryVoices';
import type { RefAnchor } from './library-voices-query';

export interface CrossRefTarget {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

export interface CrossRefVerse {
  verse: number;
  text: string;
  /** True for the cross-referenced verses themselves; false for the context either side. */
  isTarget: boolean;
}

export interface CrossRefBook {
  full_name: string;
  author: string;
  author_note: string;
  date_label: string;
  genre: string;
}

export interface CrossRefDetail {
  verses: CrossRefVerse[];
  book: CrossRefBook | null;
  voices: LibraryVoice[];
}

export interface UseCrossRefDetailResult {
  detail: CrossRefDetail | null;
  loading: boolean;
}

/** Verses of surrounding context to show either side of the target. */
const CONTEXT_RADIUS = 1;

interface Settled { key: string | null; verses: CrossRefVerse[]; book: CrossRefBook | null }

function targetKey(t: CrossRefTarget): string {
  return `${t.book}.${t.chapter}.${t.verseStart}-${t.verseEnd}`;
}

export function useCrossRefDetail(
  target: CrossRefTarget | null,
  translation: BibleTranslation,
): UseCrossRefDetailResult {
  const [settled, setSettled] = useState<Settled>(() => ({ key: null, verses: [], book: null }));

  const book = target?.book ?? null;
  const chapter = target?.chapter ?? null;
  const verseStart = target?.verseStart ?? null;
  const verseEnd = target?.verseEnd ?? null;

  const resolved = useMemo<CrossRefTarget | null>(
    () => (book === null || chapter === null || verseStart === null || verseEnd === null
      ? null
      : { book, chapter, verseStart, verseEnd }),
    [book, chapter, verseStart, verseEnd],
  );

  // Voices on the TARGET ref — not the passage the reader came from.
  const anchor = useMemo<RefAnchor | null>(
    () => (resolved
      ? { book: resolved.book, chapter: resolved.chapter, verseStart: resolved.verseStart, verseEnd: resolved.verseEnd }
      : null),
    [resolved],
  );
  const { voices, loading: voicesLoading } = useLibraryVoices(anchor);

  const key = resolved ? `${targetKey(resolved)}.${translation}` : null;

  useEffect(() => {
    if (!resolved || !supabase) return;
    let cancelled = false;

    (async () => {
      const from = Math.max(1, resolved.verseStart - CONTEXT_RADIUS);
      const to = resolved.verseEnd + CONTEXT_RADIUS;

      const [passages, bookRow] = await Promise.all([
        supabase!
          .from('bible_passages')
          .select('verse_start, text')
          .eq('translation', translation)
          .eq('book', resolved.book)
          .eq('chapter', resolved.chapter)
          .gte('verse_start', from)
          .lte('verse_start', to)
          .order('verse_start', { ascending: true })
          .limit(64),
        supabase!
          .from('bible_books')
          .select('full_name, author, author_note, date_label, genre')
          .eq('book', resolved.book)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      const rows = (passages.error ? [] : (passages.data ?? [])) as Array<{ verse_start: number; text: string }>;
      setSettled({
        key: `${targetKey(resolved)}.${translation}`,
        verses: rows.map((r) => ({
          verse: r.verse_start,
          text: r.text,
          isTarget: r.verse_start >= resolved.verseStart && r.verse_start <= resolved.verseEnd,
        })),
        book: (bookRow.error ? null : (bookRow.data as CrossRefBook | null)) ?? null,
      });
    })();

    return () => { cancelled = true; };
  }, [resolved, translation]);

  const isSettled = settled.key === key;

  return {
    detail: key !== null && isSettled
      ? { verses: settled.verses, book: settled.book, voices }
      : null,
    loading: key !== null && (!isSettled || voicesLoading),
  };
}
