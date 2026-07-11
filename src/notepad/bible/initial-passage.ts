import { bookByAbbrev } from './bible-books';
import { loadBiblePassage, type StoredPassage } from '@/notepad/session/session-storage';

export const DEFAULT_PASSAGE: StoredPassage = { book: 'jhn', chapter: 1 };

/** The passage a reader should open on: the stored one if it's a real book with an
 *  in-range chapter, else John 1. One home for the validate-or-fallback rule. */
export function loadInitialPassage(): StoredPassage {
  const stored = loadBiblePassage();
  if (stored) {
    const meta = bookByAbbrev(stored.book);
    if (meta && stored.chapter >= 1 && stored.chapter <= meta.chapterCount) {
      return { book: stored.book, chapter: stored.chapter };
    }
  }
  return { ...DEFAULT_PASSAGE };
}
