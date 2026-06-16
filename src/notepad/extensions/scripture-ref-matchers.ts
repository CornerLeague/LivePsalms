import { BOOK_PATTERNS } from '../graph/reference-parser';

// Word-boundary book name, a chapter number, a colon, and at least one verse
// digit — anchored to the END of the supplied text (text-before-cursor).
// Requiring the colon + verse digit is what keeps "I read a book" from firing.
const bookGroup = `(?:${BOOK_PATTERNS.join('|')})`;
const REF_AT_END = new RegExp(`(?:^|\\s)(${bookGroup}\\s+\\d{1,3}:\\d{1,3}(?:\\s*[-–]\\s*\\d{1,3})?)$`, 'i');

export type SuggestionTextMatch = { from: number; to: number; query: string };

/**
 * Returns the verse-reference match anchored at the end of `textBeforeCursor`,
 * with absolute-ish offsets relative to the supplied string, or null. The Node
 * adapts these offsets into ProseMirror doc positions in findSuggestionMatch.
 */
export function matchReferenceBeforeCursor(textBeforeCursor: string): SuggestionTextMatch | null {
  const m = REF_AT_END.exec(textBeforeCursor);
  if (!m) return null;
  const query = m[1];
  const to = textBeforeCursor.length;
  const from = to - query.length;
  return { from, to, query };
}

// The /verse keyword command: a literal "/verse" at the start of a line or after
// whitespace, optionally followed by a space and free-text keywords (which may
// contain spaces — semantic queries like "love your enemies"). Anchored to the
// END of text-before-cursor. The word boundary after "verse" (\s or end) keeps
// "/versed" and "/version" from triggering. Replaces the default Suggestion
// char-matcher so the picker fires ONLY on /verse — not on every "/word".
const VERSE_TRIGGER_AT_END = /(?:^|\s)(\/verse(?:\s.*)?)$/i;

/**
 * Returns the /verse-command match anchored at the end of `textBeforeCursor`,
 * or null. `query` mirrors the default Suggestion contract (`match.slice(char)`)
 * — i.e. the matched run minus the leading "/", so "/verse love" → "verse love".
 * The picker's `items`/renderer strip the leading "verse" exactly as before.
 */
export function matchVersePickerBeforeCursor(textBeforeCursor: string): SuggestionTextMatch | null {
  const m = VERSE_TRIGGER_AT_END.exec(textBeforeCursor);
  if (!m) return null;
  const full = m[1]; // "/verse" or "/verse <keywords>"
  const to = textBeforeCursor.length;
  const from = to - full.length;
  return { from, to, query: full.slice(1) }; // drop the leading "/"
}
