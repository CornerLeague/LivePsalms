import { supabase } from '@/lib/supabase';
import { type BibleTranslation, translationInfo } from '../translations';
import { fetchBibleText, makeBibleTextInvoke, bibleTextErrorMessage } from '../bible-text-client';

// Verse numbers present for a book+chapter in the given translation, ascending.
// Mirrors the bible_passages query in useFocusListVerseText.ts, and like it
// branches on TranslationInfo.source: an api-sourced translation (NLT, ESV)
// comes through the bible-text edge function, a local one through the table.
//
// Local path: returns [] on no client / error (the caller renders an empty
// grid) — unchanged from before api-sourced translations existed.
// Api path: a provider failure THROWS an Error whose message is fit to show,
// because an empty grid for "NLT is rate-limited" would read as "this chapter
// has no verses". The caller catches and offers a retry.
export async function loadChapterVerses(
  book: string,
  chapter: number,
  translation: BibleTranslation,
): Promise<number[]> {
  if (!supabase) return [];
  if (translationInfo(translation).source === 'api') {
    const res = await fetchBibleText(makeBibleTextInvoke(supabase), { book, chapter, translation });
    if (!res.ok) throw new Error(bibleTextErrorMessage(res.reason, translation));
    return res.verses.map((v) => v.verse);
  }
  const { data, error } = await supabase
    .from('bible_passages')
    .select('verse_start')
    .eq('translation', translation)
    .like('id', `${book}.${chapter}.%`)
    .order('verse_start', { ascending: true });
  if (error || !data) return [];
  return (data as { verse_start: number }[]).map((r) => r.verse_start);
}
