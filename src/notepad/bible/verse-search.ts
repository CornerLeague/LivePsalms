import { parseVerseRef, BOOK_TO_OSIS } from '../graph/reference-parser';
import type { RawFtsRow, VerseCandidate } from './verse-search-types';

const FTS_SCORE = 0.55;

// Inverse of BOOK_TO_OSIS for resolving "jhn" -> "John".
const OSIS_TO_BOOK: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_TO_OSIS).map(([book, osis]) => [osis, book]),
);

// Builds the bible_passages id key from a parsed ref. Precondition: `book` is a
// canonical book name present in BOOK_TO_OSIS — callers obtain it from
// parseVerseRef or osisBookToCanonical, both of which validate the book first.
export function osisForRef(book: string, chapter: number, verse: number): string {
  const osisBook = BOOK_TO_OSIS[book];
  return `${osisBook}.${chapter}.${verse}`;
}

export function osisBookToCanonical(osisBook: string): string | null {
  return OSIS_TO_BOOK[osisBook] ?? null;
}

export type Route =
  | { kind: 'reference'; parsed: NonNullable<ReturnType<typeof parseVerseRef>> }
  | { kind: 'keyword' };

export function routeQuery(query: string): Route {
  const parsed = parseVerseRef(query);
  if (parsed) return { kind: 'reference', parsed };
  return { kind: 'keyword' };
}

// A bible_passages verse id has 3 dot-segments ("jhn.3.16"); a pericope id has 2
// ("jhn.3"). >= 3 segments => verse, anything else => pericope.
export function detectGrain(sourceId: string): 'verse' | 'pericope' {
  return sourceId.split('.').length >= 3 ? 'verse' : 'pericope';
}

export function normalizeFtsRow(row: RawFtsRow): VerseCandidate {
  return {
    osis: row.id,
    book: row.book,
    chapter: row.chapter,
    verseStart: row.verseStart,
    verseEnd: row.verseEnd,
    text: row.text,
    translation: 'BSB',
    source: 'fts',
    score: FTS_SCORE,
  };
}
