// scripts/library-adapters/commentary.ts
//
// Adapter for verse-anchored commentaries (Treasury of David, Matthew Henry
// Concise, JFB). All three are distributed as SWORD/e-Sword modules, not as a
// clean machine-readable corpus.
//
// DESIGN DECISION — the intermediate format:
// This adapter does NOT parse diatheke output directly. It consumes a documented
// JSONL intermediate that the acquisition step produces:
//
//   {"ref": "Psalm 27:4", "body": "..."}
//   {"ref": "Psalm 27", "body": "..."}          // chapter-level section
//
// Why: diatheke's output shape varies by module, version, and flags, and none of
// it is verifiable from this repo (no SWORD install, no module files). Parsing it
// blind would mean shipping a parser against a guessed format. By defining the
// seam here, the fragile half becomes a documented shell command in the runbook
// with its own eyeball check, while THIS half — the part that decides how a
// commentary becomes retrievable chunks — is fully tested. It also means a source
// can arrive from any channel (diatheke, e-Sword export, an existing JSON dump)
// without touching this code.
//
// See docs/runbooks/library-ingest.md for the per-source acquisition commands.

import { BIBLE_BOOKS } from '../../src/notepad/bible/bible-books';
import { chunkText, withEmbeddingPrefix } from './chunk-text';
import { normalizeRef } from './versification';
import type { LibraryAdapter, LibraryChunkRow, LibrarySourceRow, VersificationScheme } from './types';

// Longest-first so "Song of Solomon" wins over "Song", and "1 John" over "John".
const BOOK_LOOKUP: Array<{ name: string; abbrev: string }> = BIBLE_BOOKS
  .map((b) => ({ name: b.name.toLowerCase(), abbrev: b.abbrev }))
  .sort((a, b) => b.name.length - a.name.length);

// alias → the canonical BIBLE_BOOKS name it resolves to. Note the canonical
// name for `psa` is the SINGULAR "Psalm", so "Psalms" is the alias here, not the
// other way round — commentary headings use both freely.
const ALIASES: Record<string, string> = {
  'psalms': 'psalm',
  'song of songs': 'song of solomon',
  'canticles': 'song of solomon',
  'apocalypse': 'revelation',
};

// Longest-first across canonical names AND aliases together, so "Song of Songs"
// cannot be shadowed by a shorter canonical name that happens to prefix-match.
const NAME_CANDIDATES: Array<{ candidate: string; abbrev: string }> = (() => {
  const byName = new Map(BOOK_LOOKUP.map((b) => [b.name, b.abbrev]));
  const out: Array<{ candidate: string; abbrev: string }> = BOOK_LOOKUP.map((b) => ({
    candidate: b.name, abbrev: b.abbrev,
  }));
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const abbrev = byName.get(canonical);
    if (abbrev) out.push({ candidate: alias, abbrev });
  }
  return out.sort((a, b) => b.candidate.length - a.candidate.length);
})();

export interface ParsedHeadingRef {
  book: string;
  chapter: number;
  verse_start?: number;
  verse_end?: number;
}

/**
 * Parse a commentary heading's reference: "Psalm 27:4", "Psalm 27:4-6",
 * "Psalm 27", "1 Corinthians 13:1–3" (en dash). Returns null when the heading
 * carries no recognizable reference — the caller decides whether that is a
 * skippable preface or a hard error.
 */
export function parseHeadingRef(raw: string): ParsedHeadingRef | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const { candidate, abbrev } of NAME_CANDIDATES) {
    if (!cleaned.startsWith(candidate)) continue;
    const rest = cleaned.slice(candidate.length).trim();
    const m = rest.match(/^(\d{1,3})(?::(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?\b/);
    if (!m) continue;
    const chapter = Number(m[1]);
    if (m[2] === undefined) return { book: abbrev, chapter };
    const start = Number(m[2]);
    const end = m[3] !== undefined ? Number(m[3]) : start;
    if (end < start) return null;
    return { book: abbrev, chapter, verse_start: start, verse_end: end };
  }
  return null;
}

export interface CommentaryEntry {
  ref: string;
  body: string;
}

/** One JSONL line → entry. Blank lines yield null; malformed JSON throws. */
export function parseEntryLine(line: string): CommentaryEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as Partial<CommentaryEntry>;
  if (typeof parsed.ref !== 'string' || typeof parsed.body !== 'string') {
    throw new Error(`commentary: line missing ref/body: ${trimmed.slice(0, 120)}`);
  }
  return { ref: parsed.ref, body: parsed.body };
}

export interface CommentaryConfig {
  source: LibrarySourceRow;
  scheme: VersificationScheme;
}

/**
 * Build an adapter for one commentary. All three v1 commentaries share this
 * implementation — they differ only in their source row and versification
 * scheme, which is exactly what a config parameter is for.
 */
export function makeCommentaryAdapter(config: CommentaryConfig): LibraryAdapter {
  const { source, scheme } = config;
  return {
    sourceId: source.id,
    source,
    scheme,
    parse(raw: string): LibraryChunkRow[] {
      const rows: LibraryChunkRow[] = [];
      for (const line of raw.split('\n')) {
        const entry = parseEntryLine(line);
        if (!entry) continue;

        const parsedRef = parseHeadingRef(entry.ref);
        // A section with no resolvable reference (preface, dedication, index)
        // is skipped rather than stored unanchored — an unanchored commentary
        // chunk can only ever be reached semantically, and it would pollute
        // the devotional register with front matter.
        if (!parsedRef) continue;

        const normalized = normalizeRef(
          { book: parsedRef.book, chapter: parsedRef.chapter, verse: parsedRef.verse_start },
          scheme,
        );
        // Preserve range width across a versification shift.
        const width = parsedRef.verse_end !== undefined && parsedRef.verse_start !== undefined
          ? parsedRef.verse_end - parsedRef.verse_start
          : 0;

        const body = entry.body.trim();
        if (!body) continue;

        const pieces = chunkText(body);
        pieces.forEach((piece, idx) => {
          // A split section keeps ONE anchor but distinct headings, so the
          // idempotency key (source, heading, book, chapter, verse_start) stays
          // unique across a re-run.
          const heading = pieces.length > 1 ? `${entry.ref} (${idx + 1}/${pieces.length})` : entry.ref;
          rows.push({
            source_id: source.id,
            book: normalized.book,
            chapter: normalized.chapter,
            ...(normalized.verse !== undefined
              ? { verse_start: normalized.verse, verse_end: normalized.verse + width }
              : {}),
            heading,
            content: withEmbeddingPrefix(piece.text, {
              author: source.author, era: source.era, ref: entry.ref,
            }),
            token_count: piece.tokenCount,
          });
        });
      }
      return rows;
    },
  };
}

// ── The three v1 commentary sources ───────────────────────────────────────
// Every attribution string below is what the in-app Sources screen renders
// verbatim. Licenses verified in docs/superpowers/research/2026-08-04-
// theological-source-library.md; all three authors died before 1900, so the
// works are public domain by age in the US.

export const TREASURY_OF_DAVID = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'treasury-of-david',
    title: 'The Treasury of David',
    author: 'Charles H. Spurgeon',
    era: '1869–1885',
    tradition: 'Baptist (Reformed)',
    register: 'devotional',
    license: 'Public domain',
    attribution: 'The Treasury of David by Charles H. Spurgeon (1869–1885). Public domain.',
  },
});

export const MATTHEW_HENRY_CONCISE = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'matthew-henry-concise',
    title: "Matthew Henry's Concise Commentary on the Whole Bible",
    author: 'Matthew Henry',
    era: '1706–1710',
    tradition: 'Nonconformist (Presbyterian)',
    register: 'devotional',
    license: 'Public domain',
    attribution: "Matthew Henry's Concise Commentary on the Whole Bible (1706–1710). Public domain.",
  },
});

export const JAMIESON_FAUSSET_BROWN = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'jfb',
    title: 'Commentary Critical and Explanatory on the Whole Bible',
    author: 'Jamieson, Fausset & Brown',
    era: '1871',
    tradition: 'Church of Scotland / Anglican',
    register: 'exegetical',
    license: 'Public domain',
    attribution: 'Commentary Critical and Explanatory on the Whole Bible by Robert Jamieson, A. R. Fausset and David Brown (1871). Public domain.',
  },
});
