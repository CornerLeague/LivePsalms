// Text matcher for the unified "/" launcher. Anchored to the end of the
// text-before-cursor within a single block, exactly like the scripture
// matchers (scripture-ref-matchers.ts) — the Node adapts these offsets into
// ProseMirror doc positions in findSuggestionMatch.
import { matchVersePickerBeforeCursor, matchLookupPickerBeforeCursor } from '../scripture-ref-matchers';

export interface SlashTextMatch {
  /** Offset of the leading "/" in the supplied string. */
  from: number;
  /** End of the supplied string (the cursor). */
  to: number;
  /** The run after "/", i.e. the launcher query. */
  query: string;
}

// A "/" at start-of-block or after whitespace, then a run with no further "/".
// The captured group includes the leading slash so `from` lands on it (the
// command deletes the whole "/query" span). Excluding "/" from the run keeps
// URLs like "http://x" and a second slash from matching.
const SLASH_AT_END = /(?:^|\s)(\/[^/]*)$/;

/**
 * Returns the launcher match anchored at the end of `textBeforeCursor`, or
 * null. Null when there's no slash at a word boundary, or while a ScriptureRef
 * command owns the line.
 */
export function matchSlashBeforeCursor(textBeforeCursor: string): SlashTextMatch | null {
  // Stand down whenever ScriptureRef's "/verse …" or "/lookup …" picker is
  // active — deferring to *its* matchers (not just inspecting our own trailing
  // slash-run) so a stray whitespace-delimited slash mid-query, e.g.
  // "/verse John /", cedes instead of opening the launcher on top of the verse
  // picker. This keeps the two from ever sharing the screen, and "/versed" /
  // "/lookupx" (which those matchers reject) still fall through to the launcher.
  if (matchVersePickerBeforeCursor(textBeforeCursor) || matchLookupPickerBeforeCursor(textBeforeCursor)) {
    return null;
  }

  const m = SLASH_AT_END.exec(textBeforeCursor);
  if (!m) return null;
  const full = m[1]; // "/..." including the leading slash
  const to = textBeforeCursor.length;
  const from = to - full.length;
  return { from, to, query: full.slice(1) };
}
