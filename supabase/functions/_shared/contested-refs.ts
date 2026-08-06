// supabase/functions/_shared/contested-refs.ts
//
// Reference-aware matching for CONTESTED_PASSAGES.
//
// The guard used to be a case-insensitive substring test against entries like
// 'Romans 9:16'. That fails in both directions:
//
//   FALSE NEGATIVES — study chat is instructed to cite the ref it was supplied,
//   and supplied refs are OSIS-coded ("rom 9:16", per formatVerseRef). The
//   substring 'Romans 9:16' never appears, so the guard fired only when the
//   model happened to spell out the human-readable form. Caught by the
//   2026-08-06 study-chat eval, where the same question tripped the rule on one
//   run and sailed through on the next.
//
//   FALSE POSITIVES — '1 Corinthians 11:2' is a substring of
//   '1 Corinthians 11:20', a verse nobody considers contested.
//
// Both go away once refs are parsed rather than pattern-matched: normalize the
// contested list and the refs found in the text to OSIS ids, then compare.
// Ref parsing already exists in verse-verify.ts and handles both spellings.

import { OSIS_BOOK_MAP, BOOK_ALIASES, parseRefToIds } from './verse-verify.ts';

export interface ContestedIndex {
  /** OSIS verse ids, e.g. 'rom.9.16'. */
  verses: Set<string>;
  /** OSIS chapter keys, e.g. 'rev.13' — entries listed without a verse. */
  chapters: Set<string>;
}

const OSIS_CODES = new Set(Object.values(OSIS_BOOK_MAP));

// Display names, their aliases, and the OSIS codes themselves. Longest first so
// "Song of Solomon" wins over "Song" and "1 John" over "John".
const BOOK_ALTERNATION = [
  ...Object.keys(OSIS_BOOK_MAP),
  ...Object.keys(BOOK_ALIASES),
  ...OSIS_CODES,
]
  .sort((a, b) => b.length - a.length)
  .map((b) => b.replace(/ /g, '\\s+'))
  .join('|');

// A book, a chapter, and optionally a verse or verse range. The verse group is
// optional so a chapter-level mention ("Revelation 13") is caught too.
const REF_SCAN = new RegExp(
  `\\b(?:${BOOK_ALTERNATION})\\s+\\d{1,3}(?::\\d{1,3}(?:\\s*[-–—]\\s*\\d{1,3})?)?`,
  'gi',
);

function osisFor(bookRaw: string): string | null {
  const collapsed = bookRaw.replace(/\s+/g, ' ').trim();
  const aliased = BOOK_ALIASES[collapsed] ?? collapsed;
  for (const [name, osis] of Object.entries(OSIS_BOOK_MAP)) {
    if (name.toLowerCase() === aliased.toLowerCase()) return osis;
  }
  const lower = collapsed.toLowerCase();
  return OSIS_CODES.has(lower) ? lower : null;
}

/** Split a scanned ref into its book text and the numbers that follow it. */
function splitRef(ref: string): { book: string; chapter: number; verses: number[] } | null {
  const m = ref.trim().match(/^(.+?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?$/);
  if (!m) return null;
  const chapter = parseInt(m[2], 10);
  if (!m[3]) return { book: m[1], chapter, verses: [] };
  const start = parseInt(m[3], 10);
  const end = m[4] ? parseInt(m[4], 10) : start;
  if (end < start || end - start > 64) return null;
  const verses: number[] = [];
  for (let v = start; v <= end; v++) verses.push(v);
  return { book: m[1], chapter, verses };
}

/**
 * Normalize the configured entries once. Entries carrying a verse become verse
 * ids; entries naming only a chapter ('Matthew 24') become chapter keys, and
 * then any verse within that chapter matches.
 */
export function buildContestedIndex(entries: readonly string[]): ContestedIndex {
  const verses = new Set<string>();
  const chapters = new Set<string>();
  for (const entry of entries) {
    const ids = parseRefToIds(entry);
    if (ids) { for (const id of ids) verses.add(id); continue; }
    const split = splitRef(entry);
    const osis = split ? osisFor(split.book) : null;
    // An entry that parses as neither is a typo in the list; skipping it keeps
    // one bad row from silently disabling the whole guard.
    if (osis && split) chapters.add(`${osis}.${split.chapter}`);
  }
  return { verses, chapters };
}

export interface ContestedHit {
  /** The reference exactly as it appeared in the text, for the violation snippet. */
  matched: string;
  /** Where it started, so callers can build a surrounding snippet. */
  index: number;
  /** The normalized id or chapter key that put it on the list. */
  rule: string;
}

/**
 * Every contested reference in `text`, in either spelling. A range counts if any
 * verse it spans is contested — citing "rom 9:15-18" leans on the contested
 * material just as much as citing 9:16 alone.
 */
export function findContestedRefs(text: string, index: ContestedIndex): ContestedHit[] {
  const hits: ContestedHit[] = [];
  for (const m of text.matchAll(new RegExp(REF_SCAN.source, 'gi'))) {
    const split = splitRef(m[0]);
    if (!split) continue;
    const osis = osisFor(split.book);
    if (!osis) continue;

    const chapterKey = `${osis}.${split.chapter}`;
    if (index.chapters.has(chapterKey)) {
      hits.push({ matched: m[0], index: m.index ?? 0, rule: chapterKey });
      continue;
    }
    const hitVerse = split.verses.map((v) => `${osis}.${split.chapter}.${v}`).find((id) => index.verses.has(id));
    if (hitVerse) hits.push({ matched: m[0], index: m.index ?? 0, rule: hitVerse });
  }
  return hits;
}
