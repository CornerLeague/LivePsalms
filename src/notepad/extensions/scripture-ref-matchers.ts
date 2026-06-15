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
