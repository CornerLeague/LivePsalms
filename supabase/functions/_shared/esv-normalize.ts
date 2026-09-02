// ESV passage text → per-verse rows.
//
// The ESV API (api.esv.org/v3/passage/text) returns one text blob per passage
// with verse numbers as "[n]" markers inline, e.g.
//   "A Psalm of David.\n\n[1] The LORD is my shepherd; I shall not want.\n[2] He…"
// when called with include-verse-numbers=true and every other decoration off
// (headings, footnotes, passage references, short copyright). Poetry lines are
// separated by newlines (indent-poetry=false), which collapse to single spaces
// here — the reader lays verses out itself.
//
// Any text BEFORE the first marker (a psalm superscription such as "A Psalm of
// David.") is fused into verse 1. That mirrors how BSB/KJV/WEB rows already
// carry the heading in verse 1's text, so every translation reads the same way
// in the reader and in stripPsalmSuperscription's grammar.
//
// Pure: no I/O, no globals. Runs in Deno (the bible-text edge function) and is
// unit-tested under vitest.

export interface NormalizedVerse {
  verse: number;
  text: string;
}

const MARKER = /\[(\d+)\]/g;

function tidy(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Normalize a single ESV text blob. Empty / marker-less input → []. */
export function normalizeEsvPassage(blob: string): NormalizedVerse[] {
  if (!blob || !blob.trim()) return [];

  const parts: Array<{ verse: number; markerAt: number; start: number; end: number }> = [];
  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(blob); m; m = MARKER.exec(blob)) {
    const verse = Number(m[1]);
    if (!Number.isInteger(verse) || verse < 1) continue;
    if (parts.length > 0) parts[parts.length - 1].end = m.index;
    parts.push({ verse, markerAt: m.index, start: m.index + m[0].length, end: blob.length });
  }
  if (parts.length === 0) return [];

  const preamble = tidy(blob.slice(0, parts[0].markerAt));

  const out: NormalizedVerse[] = [];
  for (const p of parts) {
    let text = tidy(blob.slice(p.start, p.end));
    if (out.length === 0 && preamble) text = tidy(`${preamble} ${text}`);
    if (!text) continue;
    const prev = out[out.length - 1];
    // A repeated marker (never seen live, but cheap to be safe) appends rather
    // than shadowing the earlier text.
    if (prev && prev.verse === p.verse) { prev.text = tidy(`${prev.text} ${text}`); continue; }
    out.push({ verse: p.verse, text });
  }
  return out;
}

/** Normalize the `passages` array of an ESV API response (one blob per query). */
export function normalizeEsvPassages(passages: readonly string[]): NormalizedVerse[] {
  const out: NormalizedVerse[] = [];
  for (const blob of passages) out.push(...normalizeEsvPassage(blob));
  return out;
}
