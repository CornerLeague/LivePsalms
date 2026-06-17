// src/notepad/study/apparatus-queries.ts
import { BIBLE_BOOKS } from '../bible/bible-books';

const TESTAMENT = new Map(BIBLE_BOOKS.map((b) => [b.abbrev, b.testament]));

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
