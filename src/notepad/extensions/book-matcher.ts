import { BOOK_PATTERNS } from '../graph/reference-parser';

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
