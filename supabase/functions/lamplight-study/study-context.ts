// Study context assembly. Pure note-selection (notes-on-offer) is unit-tested;
// the Supabase-backed buildStudyContext (added alongside) is glue.
export interface RelevantNote { id: string; title: string; plaintext: string; similarity: number }
export interface NoteForPrompt { id: string; title: string; plaintext: string }
export interface OfferedNote { id: string; title: string; snippet: string }

const SNIPPET_LEN = 160;

export function selectOfferedNotes(
  relevant: RelevantNote[],
  opts: { includeNotes: boolean; noteIds?: string[] },
): { included: NoteForPrompt[]; offered: OfferedNote[] } {
  const wantIds = opts.noteIds && opts.noteIds.length > 0 ? new Set(opts.noteIds) : null;
  const include = (n: RelevantNote) => opts.includeNotes && (wantIds ? wantIds.has(n.id) : true);
  const included: NoteForPrompt[] = [];
  const offered: OfferedNote[] = [];
  for (const n of relevant) {
    if (include(n)) included.push({ id: n.id, title: n.title, plaintext: n.plaintext });
    else offered.push({ id: n.id, title: n.title, snippet: n.plaintext.slice(0, SNIPPET_LEN) });
  }
  return { included, offered };
}
