import { parseVerseRef, BOOK_TO_OSIS } from '../graph/reference-parser';
import type { RawFtsRow, RawSemanticRow, PericopeRange, VerseCandidate } from './verse-search-types';

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

// Parse a verse-grain source id like "jhn.3.16" -> { osisBook, chapter, verse }.
function parseVerseSourceId(sourceId: string): { osisBook: string; chapter: number; verse: number } | null {
  const parts = sourceId.split('.');
  if (parts.length < 3) return null;
  const chapter = Number(parts[1]);
  const verse = Number(parts[2]);
  if (!Number.isFinite(chapter) || !Number.isFinite(verse)) return null;
  return { osisBook: parts[0], chapter, verse };
}

export async function normalizeSemanticRow(
  row: RawSemanticRow,
  opts: {
    resolvePericope: (id: string, o: { signal?: AbortSignal }) => Promise<PericopeRange | null>;
    signal?: AbortSignal;
  },
): Promise<VerseCandidate | null> {
  if (detectGrain(row.sourceId) === 'verse') {
    const parsed = parseVerseSourceId(row.sourceId);
    if (!parsed) return null;
    const book = osisBookToCanonical(parsed.osisBook);
    if (!book) return null;
    return {
      osis: row.sourceId,
      book,
      chapter: parsed.chapter,
      verseStart: parsed.verse,
      verseEnd: null,
      text: row.text,
      translation: 'BSB',
      source: 'semantic',
      score: row.similarity,
    };
  }

  // Pericope grain: resolve to a ranged candidate.
  const range = await opts.resolvePericope(row.sourceId, { signal: opts.signal });
  if (!range) return null;
  return {
    osis: osisForRef(range.book, range.chapter, range.verseStart),
    book: range.book,
    chapter: range.chapter,
    verseStart: range.verseStart,
    verseEnd: range.verseEnd,
    text: range.text || row.text,
    translation: 'BSB',
    source: 'semantic',
    score: row.similarity,
    label: `${range.book} ${range.chapter}:${range.verseStart}–${range.verseEnd} · passage`,
  };
}
