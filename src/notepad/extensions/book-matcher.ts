import { BOOK_PATTERNS } from '../graph/reference-parser';
import { routeQuery } from '../bible/verse-search';
import type { VerseCandidate } from '../bible/verse-search-types';

// Normalize a book token the same way parseVerseRef does (lowercase, strip
// spaces and periods) — but matchBooks keeps PREFIX semantics.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s.]/g, '');
}

// Pre-compute, per BOOK_PATTERNS line: the canonical name (first entry), its
// canonical biblical index, and the normalized forms of every accepted name.
const BOOKS = BOOK_PATTERNS.map((line, index) => {
  const names = line.split('|');
  return { canonical: names[0], index, norms: names.map(normalize) };
});

/**
 * Returns canonical book names whose canonical name OR any abbreviation starts
 * with `query` (normalized), best-match-first: a canonical-name prefix hit
 * (score 0) ranks above an abbrev-only hit (score 1); ties break by canonical
 * (biblical) order. An empty/whitespace query returns all 66 books in canonical
 * order. No match returns [].
 */
export function matchBooks(query: string): string[] {
  const q = normalize(query);
  if (q === '') return BOOKS.map((b) => b.canonical);

  const hits: Array<{ canonical: string; score: number; index: number }> = [];
  for (const b of BOOKS) {
    const canonHit = b.norms[0].startsWith(q);
    const anyHit = canonHit || b.norms.some((n) => n.startsWith(q));
    if (anyHit) hits.push({ canonical: b.canonical, score: canonHit ? 0 : 1, index: b.index });
  }
  hits.sort((a, b) => a.score - b.score || a.index - b.index);
  return hits.map((h) => h.canonical);
}

export type BookItem = { kind: 'book'; book: string };
export type VerseItem = { kind: 'verse'; candidate: VerseCandidate };
export type BookOrVerseItem = BookItem | VerseItem;

export type VersePickerView =
  | { kind: 'books'; books: string[] }
  | { kind: 'hint' }
  | { kind: 'resolve'; query: string };

// A complete book name/abbrev (BOOK_PATTERNS alternation) followed by whitespace
// and an OPTIONAL partial chapter/colon (but no complete verse — those parse as a
// full reference and are handled before this fires). This is the "book chosen,
// awaiting chapter:verse" state. Anchored to the whole stripped query so the
// trailing space after an autocompleted book ("Romans ") lands here, while a
// still-typing book ("Romans", no space) does not.
const bookGroup = `(?:${BOOK_PATTERNS.join('|')})`;
const BOOK_CHOSEN = new RegExp(`^${bookGroup}\\s+\\d{0,3}:?\\d{0,3}$`, 'i');

/**
 * Routes the stripped /verse query (query minus the leading "verse ") to a view:
 * - full reference → resolve (caller fetches verse text async),
 * - complete book awaiting chapter:verse → hint,
 * - otherwise → the book list (empty query = all 66).
 */
export function routeVersePicker(query: string): VersePickerView {
  if (routeQuery(query).kind === 'reference') return { kind: 'resolve', query };
  if (BOOK_CHOSEN.test(query)) return { kind: 'hint' };
  return { kind: 'books', books: matchBooks(query) };
}
