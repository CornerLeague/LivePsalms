import { supabase } from '@/lib/supabase';
import type { BibleTranslation } from '../translations';

// Verse numbers present for a book+chapter in the given translation, ascending.
// Mirrors the bible_passages query in useFocusListVerseText.ts. Returns [] on
// no client / error (the caller renders an empty grid).
export async function loadChapterVerses(
  book: string,
  chapter: number,
  translation: BibleTranslation,
): Promise<number[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('bible_passages')
    .select('verse_start')
    .eq('translation', translation)
    .like('id', `${book}.${chapter}.%`)
    .order('verse_start', { ascending: true });
  if (error || !data) return [];
  return (data as { verse_start: number }[]).map((r) => r.verse_start);
}
