// src/notepad/study/insights/library-voices-query.ts
//
// Pure query primitives for the class-B "Voices from the Church's Study"
// section: the verse-range overlap predicate, the source display label, and the
// ingest-prefix stripper.
//
// ⚠️ SERVER TWIN — do not let these drift:
//   supabase/functions/_shared/library-retrieval.ts
//     overlapsRef · composeSourceLabel · stripEmbeddingPrefix
//
// They are duplicated rather than shared because that module is Deno-resident
// (Deno-style `.ts` import specifiers) and lives outside `src`, so the Vite
// client build cannot import it. The same precedent already exists for Strong's
// key normalization: src/notepad/study/lexicon/normalizeStrongs.ts alongside
// supabase/functions/_shared/strongs-key.ts.
//
// library-voices-query.test.ts mirrors the server suite case-for-case. If the
// two implementations diverge, the Insights panel shows a reader a different
// set of voices than the one study chat was grounded in for the same passage.

/** A `library_chunks` row, as selected by the client. */
export interface LibraryChunkRow {
  id: string;
  source_id: string;
  heading: string;
  content: string;
  book: string | null;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
}

/** A passage the reader is looking at. No `verseStart` means the whole chapter. */
export interface RefAnchor {
  book: string;            // lowercase OSIS, matching bible_passages.book
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
}

/**
 * Does a chunk's verse range overlap the anchor?
 *
 * Nulls are open-ended in both directions, and that asymmetry is the whole
 * subtlety:
 * - a chunk with no `verse_start` comments on the whole chapter (Matthew Henry
 *   Concise does this constantly), so it overlaps any verse in it;
 * - an anchor with no `verseStart` IS the whole chapter, so it matches every
 *   chunk in that chapter.
 * An unanchored chunk (confessional / topical / lexical) never overlaps.
 */
export function overlapsVerseRange(chunk: LibraryChunkRow, anchor: RefAnchor): boolean {
  if (chunk.book === null || chunk.chapter === null) return false;
  if (chunk.book.toLowerCase() !== anchor.book.toLowerCase()) return false;
  if (chunk.chapter !== anchor.chapter) return false;
  if (chunk.verse_start === null) return true;
  if (anchor.verseStart === undefined) return true;

  const chunkEnd = chunk.verse_end ?? chunk.verse_start;
  const anchorEnd = anchor.verseEnd ?? anchor.verseStart;
  return chunk.verse_start <= anchorEnd && chunkEnd >= anchor.verseStart;
}

/** The one place a source's display label is built. Components never string-build it. */
export function composeSourceLabel(s: { title: string; author: string; era: string }): string {
  return `${s.title} · ${s.author}, ${s.era}`;
}

// Ingest prepends "<author>, <era> — on <ref>:\n" to every chunk so a semantic
// hit carries its provenance into the ranking (scripts/library-adapters/
// chunk-text.ts). On screen that prefix is pure noise — the card already shows
// the source label and the heading — so strip it before rendering.
const EMBEDDING_PREFIX_RE = /^.{0,160}?,\s[^\n]*\d[^\n]*:\n/;

export function stripEmbeddingPrefix(content: string): string {
  return content.replace(EMBEDDING_PREFIX_RE, '');
}
