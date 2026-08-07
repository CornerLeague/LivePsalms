// Journaling-chat context assembly, extracted from index.ts so it can be
// unit-tested. The Deno shell around it cannot be imported by vitest, which is
// how this builder came to hand the model OSIS codes ("psa 27:4") for months
// with nothing anywhere checking.
//
// Sibling of lamplight-study/study-context.ts. Deliberately NOT merged with it:
// journaling chat grounds on the reader's notes and a semantic whole-Bible
// sweep, study chat on the chapter's curated apparatus. Same shape, different
// grounding.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type VoyageDeps, embedQuery } from '../_shared/voyage.ts';
import { searchBible, searchUserNotesByQuery } from '../_shared/retrieval.ts';
import { formatVerseRef, formatDisplayVerseRef, fetchPassageText } from '../_shared/bible-passage.ts';
import { osisToBookName } from '../_shared/verse-verify.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import type { BibleChatContext } from './bible-chat-pipeline.ts';

const NOTE_K = 4;
const CROSSREF_K = 3;

export async function buildChatContext(
  supabase: SupabaseClient,
  args: {
    userId: string; book: string; chapter: number; passageRef: string;
    message: string;          // rendered as the question (empty for insight)
    retrievalQuery: string;   // what we embed for note/cross-ref search
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    voyageDeps: VoyageDeps; rerankEnabled: boolean; translation?: string;
    /** Retrieval widths. Defaults match production (notes 4, cross-refs 3). */
    noteK?: number; crossRefK?: number;
    /**
     * Render refs as READER-FACING names ("Psalms 27:4") rather than the OSIS
     * key form ("psa 27:4"), in the supplied grounding AND the citation
     * allowlist — the two must agree or every citation fails.
     *
     * `bible_passages.book` holds the code, so the key form is what
     * `formatVerseRef` yields, and the model prints back whatever it is handed.
     * Study chat and Insights Door 1 were both caught doing this; journaling
     * chat is the third surface with the same shape.
     *
     * OFF by default so a caller that does not ask is unchanged.
     */
    displayRefs?: boolean;
  },
): Promise<BibleChatContext> {
  const translation = args.translation ?? 'BSB';
  const noteK = args.noteK ?? NOTE_K;
  const crossRefK = args.crossRefK ?? CROSSREF_K;
  // One formatter for every ref that reaches the prompt AND every ref in the
  // allowlist. Choosing it once is what keeps those two in step.
  const refOf = args.displayRefs === true ? formatDisplayVerseRef : formatVerseRef;

  // Open chapter passages — fetched in the chosen translation (with eq filter).
  // The chapter browse fetch uses a LIKE pattern; we add eq('translation') then like.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chapterQuery = (supabase.from('bible_passages') as any)
    .select('id, book, chapter, verse_start, verse_end, text')
    .eq('translation', translation)
    .like('id', `${args.book}.${args.chapter}.%`)
    .order('verse_start', { ascending: true });
  const { data: chapterRows, error: cErr } = await chapterQuery;
  if (cErr) throw cErr;
  const verses = (chapterRows ?? []) as Array<{ book: string; chapter: number; verse_start: number; verse_end: number; text: string }>;
  const passageText = verses.map((v) => `${v.verse_start} ${v.text}`).join(' ');
  // The HEADER is a ref too, and the model generalises from it: Door 1's first
  // fix moved every cross-reference but left the header, and the model went on
  // citing the key form for the passage's own verses.
  const passageRefHuman = args.displayRefs === true
    ? `${osisToBookName(args.book) ?? args.book} ${args.chapter}`
    : `${args.book} ${args.chapter}`;
  // NOT lowercased. This set is rendered INTO the prompt by BIBLE_CHAT_PROMPT
  // ("verses MUST be one of: …"), so the model cites back exactly the casing it
  // is shown — and `humanizeRef` on the client only expands the 3-letter OSIS
  // form, leaving anything else verbatim. Lowercasing here put "psalms 13:1" on
  // a citation chip, which is worse than the "psa 13:1" it replaced.
  // `validateChatReplyCitations` lowercases both sides, so comparison is
  // unaffected.
  const chapterVerseRefs = new Set(verses.map((v) => refOf(v)));

  // Embed the retrieval query once; reuse for both retrievals.
  const queryEmbedding = await embedQuery(args.retrievalQuery, args.voyageDeps);

  // User note neighbors.
  const retrievedNotes = await searchUserNotesByQuery(
    { supabase, voyage: args.voyageDeps, rerankEnabled: args.rerankEnabled },
    { userId: args.userId, k: noteK, query: args.retrievalQuery, queryEmbedding },
  );
  const noteIds = [...new Set(retrievedNotes.map((r) => r.source_id))];
  let notes: BibleChatContext['notes'] = [];
  if (noteIds.length) {
    const { data: noteRows } = await supabase
      .from('notes').select('id, title, content').eq('user_id', args.userId).in('id', noteIds);
    notes = ((noteRows ?? []) as Array<{ id: string; title: string; content: string }>)
      .map((n) => ({ id: n.id, title: (n.title ?? '').trim() || '(untitled)', plaintext: extractTextFromNoteContent(n.content).slice(0, 800) }))
      .filter((n) => n.plaintext.trim().length > 0);
  }

  // Cross-reference passages from the whole Bible — semantic search stays BSB;
  // text fetch uses the chosen translation with BSB fallback via fetchPassageText.
  const retrievedBible = await searchBible(
    { supabase, voyage: args.voyageDeps, rerankEnabled: args.rerankEnabled },
    { query: args.retrievalQuery, k: crossRefK, queryEmbedding, translation },
  );
  const crossIds = retrievedBible.map((r) => r.source_id);
  let crossRefs: BibleChatContext['crossRefs'] = [];
  const crossRefSet = new Set<string>();
  if (crossIds.length) {
    const byId = await fetchPassageText(supabase as never, crossIds, translation);
    crossRefs = [...byId.values()]
      .map((p) => { const ref = refOf(p); crossRefSet.add(ref); return { ref, text: p.text }; });
  }

  const allowedVerseRefs = new Set<string>([...chapterVerseRefs, ...crossRefSet]);

  return {
    passageRef: passageRefHuman,
    passageText,
    crossRefs,
    notes,
    history: args.history,
    userMessage: args.message,
    allowedNoteIds: new Set(notes.map((n) => n.id)),
    allowedVerseRefs,
  };
}
