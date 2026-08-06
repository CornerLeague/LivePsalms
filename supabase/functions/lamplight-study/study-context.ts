// Study context assembly. Pure note-selection (notes-on-offer) is unit-tested;
// the Supabase-backed buildStudyContext (added alongside) is glue.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type VoyageDeps, embedQuery } from '../_shared/voyage.ts';
import { searchUserNotesByQuery, searchBible } from '../_shared/retrieval.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import { formatVerseRef, fetchPassageText } from '../_shared/bible-passage.ts';
import {
  searchLibrary,
  fetchLexiconEntries,
  makeLibraryDeps,
  type LibraryExcerpt,
  type LibraryRetrievalDeps,
  type LexiconDeps,
  type LexiconEntry,
  type RefAnchor,
} from '../_shared/library-retrieval.ts';
import type { BibleChatContext, BookContext } from '../lamplight-chat/bible-chat-pipeline.ts';

export interface RelevantNote { id: string; title: string; plaintext: string; similarity: number }
export interface NoteForPrompt { id: string; title: string; plaintext: string }
export interface OfferedNote { id: string; title: string; snippet: string }

const SNIPPET_LEN = 160;
export const VERSE_K = 6;

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

// Dedupe retrieved whole-Bible passages against the verses already supplied
// (open chapter + curated cross-refs) and against each other. Keys are compared
// case-insensitively; chapterVerseRefs/crossRefSet are already lowercased.
export function selectRelatedPassages(
  passages: Array<{ ref: string; text: string }>,
  opts: { chapterVerseRefs: Set<string>; crossRefSet: Set<string> },
): Array<{ ref: string; text: string }> {
  const seen = new Set<string>();
  const out: Array<{ ref: string; text: string }> = [];
  for (const p of passages) {
    const key = p.ref.toLowerCase();
    if (opts.chapterVerseRefs.has(key) || opts.crossRefSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// Whole-Bible semantic retrieval for A1, mirroring journaling chat
// (lamplight-chat/index.ts). Graceful degradation: any failure or empty result
// yields [] so the turn still proceeds on chapter + cross-ref grounding.
export async function retrieveRelatedPassages(
  deps: { supabase: SupabaseClient; voyage: VoyageDeps; rerankEnabled: boolean },
  args: {
    query: string; k: number; translation: string; queryEmbedding?: number[];
    chapterVerseRefs: Set<string>; crossRefSet: Set<string>;
  },
): Promise<Array<{ ref: string; text: string }>> {
  try {
    const retrieved = await searchBible(
      { supabase: deps.supabase, voyage: deps.voyage, rerankEnabled: deps.rerankEnabled },
      { query: args.query, k: args.k, queryEmbedding: args.queryEmbedding, translation: args.translation },
    );
    const ids = [...new Set(retrieved.map((r) => r.source_id))];
    if (ids.length === 0) return [];
    const byId = await fetchPassageText(deps.supabase as never, ids, args.translation);
    const passages = [...byId.values()].map((p) => ({ ref: formatVerseRef(p), text: p.text }));
    return selectRelatedPassages(passages, { chapterVerseRefs: args.chapterVerseRefs, crossRefSet: args.crossRefSet });
  } catch (err) {
    console.error('[lamplight-study] related-passage retrieval failed; degrading to chapter grounding:', err);
    return [];
  }
}

/**
 * The two slice-1c grounding blocks, retrieved together. Both callees own their
 * own degradation, so this never rejects — a missing library leaves the turn on
 * today's chapter + cross-ref + related-passage grounding.
 */
export async function retrieveStudyLibrary(
  deps: LibraryRetrievalDeps & LexiconDeps,
  args: {
    anchors: RefAnchor[]; queryEmbedding: number[]; query: string; k: number;
    book: string; chapter: number; rerankEnabled: boolean; registers?: string[];
  },
): Promise<{ libraryExcerpts: LibraryExcerpt[]; lexiconEntries: LexiconEntry[] }> {
  const [libraryExcerpts, lexiconEntries] = await Promise.all([
    searchLibrary(deps, {
      refs: args.anchors,
      queryEmbedding: args.queryEmbedding,
      query: args.query,
      k: args.k,
      registers: args.registers,
      rerankEnabled: args.rerankEnabled,
    }),
    fetchLexiconEntries(deps, { book: args.book, chapter: args.chapter }),
  ]);
  return { libraryExcerpts, lexiconEntries };
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
    /** Library excerpts to retrieve. 0 (the default) skips the library entirely. */
    libraryK?: number;
    /**
     * Skip every channel that needs an embedding: user notes, whole-Bible
     * related passages, and the library's semantic half. The deterministic
     * channels still run — chapter text, book apparatus, cross-references and
     * their resolved targets, the library's verse-anchor join, and the lexicon —
     * because all of those read public tables.
     *
     * **Production never sets this.** It exists for the eval harness, which runs
     * on the anon key precisely so it can never reach a user's vault; the three
     * semantic RPCs (`match_user_note_embeddings`, `match_bible_embeddings`,
     * `match_library_chunks`) are all revoked from public, and their callers
     * throw rather than degrade. Rather than let the harness re-implement the
     * grounding it can reach — which is how a harness quietly becomes a fiction —
     * this flag lets it call the real assembly with the unreachable half off.
     *
     * When set, `voyageDeps` is never touched; pass a deps object that throws if
     * used and a mistake surfaces loudly instead of as a silent empty result.
     */
    skipSemanticRetrieval?: boolean;
  },
): Promise<{ ctx: BibleChatContext; offered: OfferedNote[] }> {
  const skipSemantic = args.skipSemanticRetrieval === true;
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
  // Library anchors: the open chapter, plus each RESOLVED cross-ref target, so
  // a commentary on a cross-referenced verse can surface too.
  const libraryAnchors: RefAnchor[] = [{ book: args.book, chapter: args.chapter }];
  for (const x of xrefs) {
    const id = `${x.to_book}.${x.to_chapter}.${x.to_verse_start}`;
    const { data: tgt } = await supabase
      .from('bible_passages').select('book, chapter, verse_start, verse_end, text')
      .eq('id', id).eq('translation', args.translation).maybeSingle();
    if (tgt) {
      const t = tgt as { book: string; chapter: number; verse_start: number; verse_end: number };
      const ref = formatVerseRef(t);
      crossRefSet.add(ref.toLowerCase());
      crossRefs.push({ ref, text: (tgt as { text: string }).text });
      libraryAnchors.push({ book: t.book, chapter: t.chapter, verseStart: t.verse_start, verseEnd: t.verse_end });
    }
  }

  // Relevant notes via existing embeddings (always computed; injection is conditional).
  const queryEmbedding = skipSemantic ? [] : await embedQuery(args.retrievalQuery, args.voyageDeps);
  const retrieved = skipSemantic ? [] : await searchUserNotesByQuery(
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

  // A1 (related passages) and 1c (library + lexicon) both reuse the embedding
  // computed for notes above — one query embedding serves all three channels.
  // Run concurrently so the library costs only its own latency, not a sum.
  const libraryK = args.libraryK ?? 0;
  // With the semantic half off, the library still runs its real fusion and
  // verse-anchor channel — only `matchSemantic` is stubbed, so the anchor join
  // and lexicon lookup exercise production code rather than a copy of it.
  const libraryDeps = skipSemantic
    ? { ...makeLibraryDeps(supabase, args.voyageDeps), matchSemantic: async () => [] }
    : makeLibraryDeps(supabase, args.voyageDeps);
  const [relatedPassages, library] = await Promise.all([
    skipSemantic
      ? Promise.resolve([] as Array<{ ref: string; text: string }>)
      : retrieveRelatedPassages(
          { supabase, voyage: args.voyageDeps, rerankEnabled: args.rerankEnabled },
          {
            query: args.retrievalQuery, k: VERSE_K, translation: args.translation, queryEmbedding,
            chapterVerseRefs, crossRefSet,
          },
        ),
    libraryK > 0
      ? retrieveStudyLibrary(libraryDeps, {
          anchors: libraryAnchors, queryEmbedding, query: args.retrievalQuery, k: libraryK,
          book: args.book, chapter: args.chapter,
          // Reranking is a Voyage call; with the semantic half off there is no
          // key to make it with, and the anchor channel is already ordered.
          rerankEnabled: skipSemantic ? false : args.rerankEnabled,
        })
      : Promise.resolve({ libraryExcerpts: [] as LibraryExcerpt[], lexiconEntries: [] as LexiconEntry[] }),
  ]);

  const ctx: BibleChatContext = {
    passageRef: `${args.book} ${args.chapter}`,
    passageText,
    crossRefs,
    notes: included,
    history: args.history,
    userMessage: args.message,
    allowedNoteIds: new Set(included.map((n) => n.id)),
    // LOAD-BEARING: the library is deliberately absent from this set. A voice
    // quoting Isaiah 40:31 does not put Isaiah 40:31 in reach — only supplied
    // verse TEXT authorises a citation. Adding library refs here would defeat
    // the citation validator.
    allowedVerseRefs: new Set<string>([
      ...chapterVerseRefs,
      ...crossRefSet,
      ...relatedPassages.map((p) => p.ref.toLowerCase()),
    ]),
    bookContext,
    relatedPassages,
    libraryExcerpts: library.libraryExcerpts,
    lexiconEntries: library.lexiconEntries,
  };
  return { ctx, offered };
}
