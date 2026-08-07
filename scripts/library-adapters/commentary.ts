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
  /**
   * Optional display/idempotency label. Defaults to `ref`. REQUIRED when a
   * source repeats the same ref — Spurgeon's Treasury comments on each verse
   * once per section (exposition, explanatory notes, hints to the preacher), so
   * "Psalm 27:1" legitimately occurs several times. Without a distinct heading
   * those rows collide on library_chunks_ident and the upsert silently keeps
   * only the last one.
   */
  heading?: string;
}

/** One JSONL line → entry. Blank lines yield null; malformed JSON throws. */
export function parseEntryLine(line: string): CommentaryEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as Partial<CommentaryEntry>;
  if (typeof parsed.ref !== 'string' || typeof parsed.body !== 'string') {
    throw new Error(`commentary: line missing ref/body: ${trimmed.slice(0, 120)}`);
  }
  return {
    ref: parsed.ref,
    body: parsed.body,
    ...(typeof parsed.heading === 'string' ? { heading: parsed.heading } : {}),
  };
}

export interface CommentaryConfig {
  source: LibrarySourceRow;
  scheme: VersificationScheme;
  /**
   * Optional per-source body rewrite, applied before chunking. Only Geneva
   * needs one: its bodies are the VERSE TEXT with inline markers followed by
   * the glosses, and the verse text duplicates `bible_passages`.
   */
  transformBody?: (body: string) => string;
}

/**
 * Geneva's bodies interleave the biblical text with its marginal notes:
 *
 *   And the earth was {b} without form... (b) As an unformed lump...
 *
 * Half the corpus by character count is that leading verse text, which
 * `bible_passages` already holds — so it is stripped, keeping only the notes.
 *
 * Two things the real dump forced, neither of which the format description
 * suggests:
 *
 * 1. **Markers are alphanumeric.** `(a)` covers 14,668 of 14,695 entries, but
 *    Genesis 6:16 uses `(1)`. Matching letters only would have left ~1,700
 *    entries un-stripped and silently duplicating Scripture.
 * 2. **"The Argument" must survive.** 35 entries carry a book-level preface,
 *    and in 28 of them it sits BEFORE the first note — so cutting at the first
 *    marker would delete the single best summary Geneva has for that book.
 *    Hence the cut is at whichever comes first.
 *
 * Entries with no marker at all (9) are returned untouched rather than
 * guessed at.
 */
export function stripGenevaVerseText(body: string): string {
  const note = body.search(/\([a-z0-9]{1,2}\)/);
  const argument = body.indexOf('The Argument');
  const cuts = [note, argument].filter((i) => i >= 0);
  if (cuts.length > 0) return body.slice(Math.min(...cuts)).trim();

  // `{x}`-repeat form (18 entries): the note prefix reuses the anchor marker,
  // so the SECOND occurrence of a repeated marker opens the notes.
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{[a-z0-9]{1,2}\}/g)) {
    if (seen.has(m[0])) return body.slice(m.index ?? 0).trim();
    seen.add(m[0]);
  }
  return body.trim();
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

        const body = (config.transformBody ? config.transformBody(entry.body) : entry.body).trim();
        if (!body) continue;

        const label = entry.heading ?? entry.ref;
        const pieces = chunkText(body);
        pieces.forEach((piece, idx) => {
          // A split section keeps ONE anchor but distinct headings, so the
          // idempotency key (source, heading, book, chapter, verse_start) stays
          // unique across a re-run.
          const heading = pieces.length > 1 ? `${label} (${idx + 1}/${pieces.length})` : label;
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

// ── Phase A1: tradition-broadening public-domain sources ─────────────────────
// Acquired from CrossWire via installmgr; license evidence is each module's own
// `.conf` (see docs/runbooks/library-ingest.md §1). Two carry provenance
// caveats recorded there rather than smoothed over: Clarke's TextSource is
// Wikisource, Calvin's is ccel.org.

export const WESLEY_NOTES = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'wesley-notes',
    title: "John Wesley's Explanatory Notes on the Bible",
    author: 'John Wesley',
    era: '1754–1765',
    tradition: 'Methodist (Wesleyan)',
    // Brief, practical, pastoral notes — the same KIND of writing as Matthew
    // Henry Concise, which this repo already classes devotional. Not exegetical:
    // Wesley explains for the ordinary reader rather than arguing the grammar.
    register: 'devotional',
    license: 'Public domain',
    attribution: "John Wesley's Explanatory Notes on the Bible (1754–1765). Public domain.",
  },
});

export const ADAM_CLARKE = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'adam-clarke',
    title: 'Commentary and Critical Notes on the Bible',
    author: 'Adam Clarke',
    era: '1810–1826',
    tradition: 'Methodist (Wesleyan)',
    register: 'exegetical',
    license: 'Public domain',
    attribution: 'Commentary and Critical Notes on the Bible by Adam Clarke (1810–1826). Public domain.',
  },
});

export const CALVIN_COMMENTARIES = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'calvin-commentaries',
    title: "Calvin's Commentaries",
    author: 'John Calvin',
    era: '1540–1564',
    tradition: 'Reformed (Continental)',
    register: 'exegetical',
    license: 'Public domain',
    attribution: "Calvin's Commentaries by John Calvin (1540–1564), Calvin Translation Society edition. Public domain.",
  },
});

export const CATENA_AUREA = makeCommentaryAdapter({
  scheme: 'english',
  source: {
    id: 'catena-aurea',
    title: 'Catena Aurea',
    author: 'Thomas Aquinas, tr. John Henry Newman',
    era: '1263–1273; tr. 1841',
    // The distinguishing value: a chain of PATRISTIC voices — Chrysostom,
    // Augustine, Origen, Hilary — compiled rather than composed. Gospels only.
    tradition: 'Patristic (Catholic compilation)',
    register: 'exegetical',
    license: 'Public domain',
    attribution: 'Catena Aurea compiled by Thomas Aquinas, translated by John Henry Newman (1841). Public domain.',
  },
});

export const GENEVA_NOTES = makeCommentaryAdapter({
  scheme: 'english',
  // Verse text stripped: it duplicates bible_passages and is half the corpus.
  transformBody: stripGenevaVerseText,
  source: {
    id: 'geneva-notes',
    title: 'Geneva Bible Translation Notes',
    author: 'Geneva Bible translators',
    era: '1560–1599',
    tradition: 'Reformed (English Puritan)',
    // The first member of this register. Marginalia written to teach a
    // theological reading, which is what Door 2's theology section wants.
    register: 'confessional',
    // The module's .conf declares NO DistributionLicense. Public domain by AGE
    // (1560/1599), which is the claim recorded — not a declaration that does
    // not exist. See the runbook.
    license: 'Public domain by age (1560–1599); module declares no license',
    attribution: 'Geneva Bible Translation Notes (1560–1599). Public domain by age.',
  },
});
