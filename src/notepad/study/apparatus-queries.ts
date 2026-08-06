// src/notepad/study/apparatus-queries.ts
import { BIBLE_BOOKS, bookByAbbrev } from '../bible/bible-books';

const TESTAMENT = new Map(BIBLE_BOOKS.map((b) => [b.abbrev, b.testament]));

/**
 * "Hebrews 11:6" / "Hebrews 11:6-8". The one place a cross-reference label is
 * built, so the ApparatusRail and the Insights Reference door can never format
 * the same ref two different ways.
 */
export function formatCrossRefLabel(
  x: { to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number },
): string {
  const name = bookByAbbrev(x.to_book)?.name ?? x.to_book;
  const verses = x.to_verse_start === x.to_verse_end
    ? `${x.to_verse_start}`
    : `${x.to_verse_start}-${x.to_verse_end}`;
  return `${name} ${x.to_chapter}:${verses}`;
}

export function crossesTestament(a: string, b: string): boolean {
  const ta = TESTAMENT.get(a);
  const tb = TESTAMENT.get(b);
  if (!ta || !tb) return false;
  return ta !== tb;
}

export interface AuthorRow { book: string; author: string; full_name: string }

export function groupSameAuthor(rows: AuthorRow[], currentBook: string): AuthorRow[] {
  const current = rows.find((r) => r.book === currentBook);
  if (!current) return [];
  return rows.filter((r) => r.book !== currentBook && r.author === current.author);
}

// Inclusive overlap predicate for "written around the same time".
export function sameEraOverlap(
  a: { start: number | null; end: number | null },
  b: { start: number | null; end: number | null },
): boolean {
  if (a.start === null || a.end === null || b.start === null || b.end === null) return false;
  return a.start <= b.end && b.start <= a.end;
}
