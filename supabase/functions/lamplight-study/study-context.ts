// Study context assembly. Pure note-selection (notes-on-offer) is unit-tested;
// the Supabase-backed buildStudyContext (added alongside) is glue.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type VoyageDeps, embedQuery } from '../_shared/voyage.ts';
import { searchUserNotesByQuery } from '../_shared/retrieval.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import { formatVerseRef } from '../_shared/bible-passage.ts';
import type { BibleChatContext, BookContext } from '../lamplight-chat/bible-chat-pipeline.ts';

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

export async function buildStudyContext(
  supabase: SupabaseClient,
  args: {
    userId: string; book: string; chapter: number; passageRef: string;
    message: string;                 // '' for insight
    retrievalQuery: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    includeNotes: boolean; noteIds?: string[];
    voyageDeps: VoyageDeps; rerankEnabled: boolean;
    crossRefK: number; noteK: number;
    translation: string;
  },
): Promise<{ ctx: BibleChatContext; offered: OfferedNote[] }> {
  // Open chapter text.
  const { data: chapterRows, error: cErr } = await supabase
    .from('bible_passages')
    .select('book, chapter, verse_start, verse_end, text')
    .like('id', `${args.book}.${args.chapter}.%`)
    .eq('translation', args.translation)
    .order('verse_start', { ascending: true });
  if (cErr) throw cErr;
  const verses = (chapterRows ?? []) as Array<{ book: string; chapter: number; verse_start: number; verse_end: number; text: string }>;
  const passageText = verses.map((v) => `${v.verse_start} ${v.text}`).join(' ');
  const chapterVerseRefs = new Set(verses.map((v) => formatVerseRef(v).toLowerCase()));

  // Book apparatus.
  const { data: bookRow } = await supabase
    .from('bible_books')
    .select('full_name, author, author_note, date_label, region, cultural_context, genre, summary')
    .eq('book', args.book).maybeSingle();
  const bookContext: BookContext | null = bookRow
    ? {
        book: (bookRow as { full_name: string }).full_name,
        author: (bookRow as { author: string }).author,
        authorNote: (bookRow as { author_note: string }).author_note,
        dateLabel: (bookRow as { date_label: string }).date_label,
        region: (bookRow as { region: string }).region,
        culturalContext: (bookRow as { cultural_context: string }).cultural_context,
        genre: (bookRow as { genre: string }).genre,
        summary: (bookRow as { summary: string }).summary,
      }
    : null;

  // Curated cross-references for the open chapter (top-N by votes), resolved to text.
  const { data: xrefRows } = await supabase
    .from('bible_cross_references')
    .select('to_book, to_chapter, to_verse_start, to_verse_end, votes')
    .eq('from_book', args.book).eq('from_chapter', args.chapter)
    .order('votes', { ascending: false })
    .limit(args.crossRefK);
  const xrefs = (xrefRows ?? []) as Array<{ to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number }>;
  const crossRefs: BibleChatContext['crossRefs'] = [];
  const crossRefSet = new Set<string>();
  for (const x of xrefs) {
    const id = `${x.to_book}.${x.to_chapter}.${x.to_verse_start}`;
    const { data: tgt } = await supabase
      .from('bible_passages').select('book, chapter, verse_start, verse_end, text')
      .eq('id', id).eq('translation', args.translation).maybeSingle();
    if (tgt) {
      const ref = formatVerseRef(tgt as { book: string; chapter: number; verse_start: number; verse_end: number });
      crossRefSet.add(ref.toLowerCase());
      crossRefs.push({ ref, text: (tgt as { text: string }).text });
    }
  }

  // Relevant notes via existing embeddings (always computed; injection is conditional).
  const queryEmbedding = await embedQuery(args.retrievalQuery, args.voyageDeps);
  const retrieved = await searchUserNotesByQuery(
    { supabase, voyage: args.voyageDeps, rerankEnabled: args.rerankEnabled },
    { userId: args.userId, k: args.noteK, query: args.retrievalQuery, queryEmbedding },
  );
  const noteIds = [...new Set(retrieved.map((r) => r.source_id))];
  const relevant: RelevantNote[] = [];
  if (noteIds.length) {
    const { data: noteRows } = await supabase
      .from('notes').select('id, title, content').eq('user_id', args.userId).in('id', noteIds);
    for (const n of (noteRows ?? []) as Array<{ id: string; title: string; content: string }>) {
      const plaintext = extractTextFromNoteContent(n.content).slice(0, 800);
      if (plaintext.trim().length === 0) continue;
      const sim = retrieved.find((r) => r.source_id === n.id)?.similarity ?? 0;
      relevant.push({ id: n.id, title: (n.title ?? '').trim() || '(untitled)', plaintext, similarity: sim });
    }
  }
  const { included, offered } = selectOfferedNotes(relevant, { includeNotes: args.includeNotes, noteIds: args.noteIds });

  const ctx: BibleChatContext = {
    passageRef: `${args.book} ${args.chapter}`,
    passageText,
    crossRefs,
    notes: included,
    history: args.history,
    userMessage: args.message,
    allowedNoteIds: new Set(included.map((n) => n.id)),
    allowedVerseRefs: new Set<string>([...chapterVerseRefs, ...crossRefSet]),
    bookContext,
  };
  return { ctx, offered };
}
