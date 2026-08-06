// scripts/dump-sword-commentary.ts
//
// Acquisition step for the commentary sources: SWORD module → the JSONL
// intermediate that scripts/library-adapters/commentary.ts consumes.
//
//   brew install sword
//   installmgr --allow-internet-access-... -init -sc
//   installmgr --allow-internet-access-... -ri CrossWire TDavid
//   npx tsx scripts/dump-sword-commentary.ts --module=TDavid --out=scripts/data/tdavid.jsonl
//
// The three modules key their content THREE DIFFERENT WAYS, which is why this
// script exists rather than a one-liner:
//
//   JFB   — verse-range keyed. diatheke repeats a range's text for every verse
//           in it, so consecutive identical bodies must collapse into one entry
//           ("Psalms 27:4-5") or the corpus fills with duplicates.
//   MHCC  — same, with much wider ranges (a whole psalm section on every verse).
//   TDavid— the ENTIRE psalm sits on verse 1; verses 2+ are empty. The body
//           carries inline "* Verse N. *" markers, repeated once per section
//           (exposition / explanatory notes / hints), so it is split on those
//           markers and each occurrence gets a distinct heading.
//
// Every one of those behaviours was observed from real module output, not
// assumed. Re-verify with --probe if a module is ever updated.

import { writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BIBLE_BOOKS } from '../src/notepad/bible/bible-books';

// ── Pure parsing ──────────────────────────────────────────────────────────

export interface VerseLine { verse: number; body: string }

/**
 * Parse a `diatheke -f plain -k <Book> <Chapter>` dump. Lines look like
 * `Psalms 27:1: <body>`, with a trailing `(MODULE)` line. A verse whose body is
 * empty is dropped (that is how diatheke reports "no comment here").
 */
export function parseChapterDump(raw: string): VerseLine[] {
  const out: VerseLine[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^.+?\s(\d{1,3}):(\d{1,3}):\s?(.*)$/);
    if (!m) continue;                      // the trailing "(JFB)" line, blanks
    const body = m[3].trim();
    if (!body) continue;
    out.push({ verse: Number(m[2]), body });
  }
  return out;
}

export interface RangeEntry { verseStart: number; verseEnd: number; body: string }

/**
 * Collapse consecutive verses carrying identical text into one range entry.
 * This is the fix for range-keyed modules: JFB reports the same comment for
 * 27:4 and 27:5, which is ONE comment on 27:4-5, not two.
 */
export function collapseRanges(lines: VerseLine[]): RangeEntry[] {
  const out: RangeEntry[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last && last.body === line.body && line.verse === last.verseEnd + 1) {
      last.verseEnd = line.verse;
      continue;
    }
    out.push({ verseStart: line.verse, verseEnd: line.verse, body: line.body });
  }
  return out;
}

/** Strip diatheke's plain-format italic asterisks and tidy whitespace. */
export function cleanPlainMarkup(s: string): string {
  return s.replace(/\*/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

export interface TreasurySection { verseStart: number; verseEnd: number; body: string }

/**
 * Split a Treasury of David psalm blob on its inline verse markers.
 * Markers look like `* Verse 1. *` or `* Verses 3-4. *`. Text before the first
 * marker (TITLE AND SUBJECT) is returned as verse 0, which the caller maps to a
 * chapter-level ref.
 */
export function splitTreasuryBlob(body: string): TreasurySection[] {
  const MARKER = /\*\s*Verses?\s+(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*\.?\s*\*/g;
  const sections: TreasurySection[] = [];
  const marks: Array<{ index: number; length: number; start: number; end: number }> = [];

  for (let m = MARKER.exec(body); m !== null; m = MARKER.exec(body)) {
    const start = Number(m[1]);
    marks.push({
      index: m.index, length: m[0].length,
      start, end: m[2] !== undefined ? Number(m[2]) : start,
    });
  }

  if (marks.length === 0) {
    const whole = body.trim();
    return whole ? [{ verseStart: 0, verseEnd: 0, body: whole }] : [];
  }

  const preamble = body.slice(0, marks[0].index).trim();
  if (preamble) sections.push({ verseStart: 0, verseEnd: 0, body: preamble });

  marks.forEach((mark, i) => {
    const from = mark.index + mark.length;
    const to = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const text = body.slice(from, to).trim();
    if (text) sections.push({ verseStart: mark.start, verseEnd: mark.end, body: text });
  });
  return sections;
}

export interface JsonlEntry { ref: string; body: string; heading?: string }

/** Format a ref the commentary adapter's parseHeadingRef understands. */
export function formatRef(book: string, chapter: number, start?: number, end?: number): string {
  if (start === undefined || start === 0) return `${book} ${chapter}`;
  return end !== undefined && end > start
    ? `${book} ${chapter}:${start}-${end}`
    : `${book} ${chapter}:${start}`;
}

/**
 * Build the JSONL entries for one chapter. `seen` carries heading-occurrence
 * counts ACROSS the whole run so a repeated ref (Treasury's per-section verse
 * comments) gets a distinct, stable heading instead of colliding.
 */
export function buildEntries(
  moduleName: string,
  bookName: string,
  chapter: number,
  raw: string,
  seen: Map<string, number>,
): JsonlEntry[] {
  const lines = parseChapterDump(raw);
  if (lines.length === 0) return [];

  const out: JsonlEntry[] = [];
  const push = (ref: string, body: string) => {
    const clean = cleanPlainMarkup(body);
    if (!clean) return;
    const n = (seen.get(ref) ?? 0) + 1;
    seen.set(ref, n);
    out.push({ ref, body: clean, ...(n > 1 ? { heading: `${ref} [${n}]` } : {}) });
  };

  if (moduleName === 'TDavid') {
    // Everything lives on verse 1; split it back out by inline markers.
    for (const line of lines) {
      for (const s of splitTreasuryBlob(line.body)) {
        push(formatRef(bookName, chapter, s.verseStart, s.verseEnd), s.body);
      }
    }
    return out;
  }

  for (const r of collapseRanges(lines)) {
    push(formatRef(bookName, chapter, r.verseStart, r.verseEnd), r.body);
  }
  return out;
}

// ── I/O ───────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function dumpChapter(moduleName: string, bookName: string, chapter: number): string {
  try {
    return execFileSync('diatheke', ['-b', moduleName, '-f', 'plain', '-k', `${bookName} ${chapter}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function main() {
  const moduleName = arg('module');
  const out = arg('out');
  if (!moduleName || !out) {
    console.error('usage: --module=TDavid --out=scripts/data/tdavid.jsonl [--books=Psalm]');
    process.exit(1);
  }
  const only = arg('books');
  const books = only
    ? BIBLE_BOOKS.filter((b) => b.name.toLowerCase() === only.toLowerCase())
    : BIBLE_BOOKS;
  if (books.length === 0) {
    console.error(`no book matched --books=${only}`);
    process.exit(1);
  }

  writeFileSync(out, '');
  const seen = new Map<string, number>();
  let total = 0;

  for (const book of books) {
    let bookEntries = 0;
    for (let ch = 1; ch <= book.chapterCount; ch++) {
      const raw = dumpChapter(moduleName, book.name, ch);
      if (!raw.trim()) continue;
      const entries = buildEntries(moduleName, book.name, ch, raw, seen);
      if (entries.length === 0) continue;
      appendFileSync(out, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
      bookEntries += entries.length;
    }
    total += bookEntries;
    if (bookEntries > 0) console.log(`${book.name}: ${bookEntries}`);
  }
  console.log(`\n${moduleName}: ${total} entries → ${out}`);
}

if (process.argv[1] && process.argv[1].endsWith('dump-sword-commentary.ts')) main();
