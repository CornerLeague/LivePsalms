// Text matcher for the unified "/" launcher. Anchored to the end of the
// text-before-cursor within a single block, exactly like the scripture
// matchers (scripture-ref-matchers.ts) — the Node adapts these offsets into
// ProseMirror doc positions in findSuggestionMatch.

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

// Queries owned by ScriptureRef's shipped pickers. The launcher stands down for
// these so "/verse …" and "/lookup …" route to their dedicated typeaheads,
// mirroring how scripture-ref-matchers require the exact keyword + boundary
// (so "/versed" / "/lookupx" are NOT ceded and stay in the launcher).
const SCRIPTURE_CEDE = /^(?:verse|lookup)(?:\s|$)/i;

/**
 * Returns the launcher match anchored at the end of `textBeforeCursor`, or
 * null. Null when there's no slash at a word boundary, or when the query is a
 * scripture command (ceded to ScriptureRef).
 */
export function matchSlashBeforeCursor(textBeforeCursor: string): SlashTextMatch | null {
  const m = SLASH_AT_END.exec(textBeforeCursor);
  if (!m) return null;
  const full = m[1]; // "/..." including the leading slash
  const query = full.slice(1);
  if (SCRIPTURE_CEDE.test(query)) return null;
  const to = textBeforeCursor.length;
  const from = to - full.length;
  return { from, to, query };
}
