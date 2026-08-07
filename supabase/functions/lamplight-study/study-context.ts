// Study context assembly. Pure note-selection (notes-on-offer) is unit-tested;
// the Supabase-backed buildStudyContext (added alongside) is glue.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type VoyageDeps, embedQuery } from '../_shared/voyage.ts';
import { searchUserNotesByQuery, searchBible } from '../_shared/retrieval.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import { formatVerseRef, formatDisplayVerseRef, fetchPassageText } from '../_shared/bible-passage.ts';
import { osisToBookName } from '../_shared/verse-verify.ts';
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

/**
 * How many rows either side of a verse selection are supplied as focus verses.
 *
 * The whole chapter is in `passageText` regardless; this block is the marked,
 * ref-labelled slice that makes Door 1's "what sits either side of this" a
 * question the model can actually answer rather than infer from a blob.
 */
export const FOCUS_NEIGHBOURS = 2;

export interface ChapterVerseRow {
  book: string; chapter: number; verse_start: number; verse_end: number; text: string;
}

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

/**
 * The selected verse's row plus its immediate neighbours, clamped at the
 * chapter's edges, with the selection marked.
 *
 * Neighbours are counted in ROWS, not verse numbers: bible_passages stores
 * multi-verse rows (and chapters with gaps), so arithmetic on verse numbers
 * would slice through one and ask for text that has no row.
 *
 * Returns null when the verse is in no row of this chapter. The caller degrades
 * to chapter grounding rather than narrowing the library anchor onto a verse
 * that does not exist — which would blank the library instead of widening it.
 */
export function selectFocusVerses(
  verses: ChapterVerseRow[],
  verse: number,
  refOf: (v: ChapterVerseRow) => string = formatVerseRef,
): Array<{ ref: string; text: string; isFocus: boolean }> | null {
  const idx = verses.findIndex((v) => verse >= v.verse_start && verse <= v.verse_end);
  if (idx === -1) return null;
  const start = Math.max(0, idx - FOCUS_NEIGHBOURS);
  return verses
    .slice(start, idx + FOCUS_NEIGHBOURS + 1)
    .map((v, i) => ({ ref: refOf(v), text: v.text, isFocus: start + i === idx }));
}

// Whole-Bible semantic retrieval for A1, mirroring journaling chat
// (lamplight-chat/index.ts). Graceful degradation: any failure or empty result
// yields [] so the turn still proceeds on chapter + cross-ref grounding.
export async function retrieveRelatedPassages(
  deps: { supabase: SupabaseClient; voyage: VoyageDeps; rerankEnabled: boolean },
  args: {
    query: string; k: number; translation: string; queryEmbedding?: number[];
    chapterVerseRefs: Set<string>; crossRefSet: Set<string>;
    /** Reader-facing book names rather than OSIS codes; see buildStudyContext's `displayRefs`. */
    displayRefs?: boolean;
    /**
     * Restrict library excerpts to these `library_sources.register` values.
     *
     * A HARD FILTER, not a bias — `searchLibrary`'s `inRegister` excludes
     * everything else, the same way the daily devotion already asks for
     * `['devotional']` because Spurgeon's warmth suits it and JFB's grammar
     * apparatus does not.
     *
     * Absent = every register, which is today's behaviour and what study chat
     * keeps: a reader's question can land anywhere, so narrowing the corpus
     * under it would be guessing.
     *
     * This matters more as the corpus widens. With `k` excerpts drawn from
     * eight sources, an unsteered top-k goes to whichever source has the most
     * rows on that chapter — so steering is what stops one voice from
     * crowding out the rest.
     */
    registers?: string[];
  },
): Promise<Array<{ ref: string; text: string }>> {
  const refOf = args.displayRefs === true ? formatDisplayVerseRef : formatVerseRef;
  try {
    const retrieved = await searchBible(
      { supabase: deps.supabase, voyage: deps.voyage, rerankEnabled: deps.rerankEnabled },
      { query: args.query, k: args.k, queryEmbedding: args.queryEmbedding, translation: args.translation },
    );
    const ids = [...new Set(retrieved.map((r) => r.source_id))];
    if (ids.length === 0) return [];
    const byId = await fetchPassageText(deps.supabase as never, ids, args.translation);
    const passages = [...byId.values()].map((p) => ({ ref: refOf(p), text: p.text }));
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
     * Verse scope (Insights Door 1). Narrows the library anchor onto this one
     * verse and supplies it with its neighbours as `ctx.focusVerses`.
     *
     * Deliberately does NOT narrow the chapter text or the citation allowlist:
     * the whole chapter is still supplied, so the whole chapter stays citable.
     * A section describing the chapter's movement cites across it constantly,
     * and narrowing the allowlist would make that unwritable.
     *
     * Absent = chapter scope, which is byte-identical to pre-B2 behaviour: no
     * `focusVerses` key at all, and a whole-chapter library anchor.
     */
    verse?: number;
    /**
     * Render refs as READER-FACING names ("Psalms 27:4") rather than the OSIS
     * key form ("psa 27:4"), in both the supplied grounding and the citation
     * allowlist — the two must agree or every citation fails.
     *
     * `bible_passages.book` holds the code, so the key form is what
     * `formatVerseRef` yields, and the model echoes back whatever it is given.
     * That reached a reader once already on the Today's Lamp card, which is why
     * `formatDisplayVerseRef` exists; the first B2 live sweep caught Door 1
     * doing it again, printing "2ti 2:19" at readers.
     *
     * OFF by default, so study chat is unchanged by construction. Study chat has
     * the same leak in its shipped baseline — a real bug, but a separate one:
     * flipping it there changes a live prompt's grounding and needs its own eval
     * sweep and prompt_version bump.
     */
    displayRefs?: boolean;
    /**
     * Restrict library excerpts to these `library_sources.register` values.
     *
     * A HARD FILTER, not a bias — `searchLibrary`'s `inRegister` excludes
     * everything else, the same way the daily devotion already asks for
     * `['devotional']` because Spurgeon's warmth suits it and JFB's grammar
     * apparatus does not.
     *
     * Absent = every register, which is today's behaviour and what study chat
     * keeps: a reader's question can land anywhere, so narrowing the corpus
     * under it would be guessing.
     *
     * This matters more as the corpus widens. With `k` excerpts drawn from
     * eight sources, an unsteered top-k goes to whichever source has the most
     * rows on that chapter — so steering is what stops one voice from
     * crowding out the rest.
     */
    registers?: string[];
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
  // One formatter, used for every ref that reaches the prompt AND for every ref
  // in the allowlist. Choosing it once here is what keeps those two in step.
  const refOf = args.displayRefs === true ? formatDisplayVerseRef : formatVerseRef;
  // Open chapter text.
  const { data: chapterRows, error: cErr } = await supabase
    .from('bible_passages')
    .select('book, chapter, verse_start, verse_end, text')
    .like('id', `${args.book}.${args.chapter}.%`)
    .eq('translation', args.translation)
    .order('verse_start', { ascending: true });
  if (cErr) throw cErr;
  const verses = (chapterRows ?? []) as ChapterVerseRow[];
  const passageText = verses.map((v) => `${v.verse_start} ${v.text}`).join(' ');
  const chapterVerseRefs = new Set(verses.map((v) => refOf(v).toLowerCase()));

  // Verse scope. A selection this chapter has no row for degrades to chapter
  // grounding — loudly, because it means a caller built a ref_id for a verse
  // that is not there.
  const selectedVerse = args.verse;
  const focusVerses = selectedVerse === undefined ? null : selectFocusVerses(verses, selectedVerse, refOf);
  if (selectedVerse !== undefined && focusVerses === null) {
    console.warn(
      `[lamplight-study] verse ${args.book}.${args.chapter}.${selectedVerse} is in no row of this chapter; degrading to chapter grounding`,
    );
  }

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
  // Library anchors: the open chapter — or, at verse scope, just the selected
  // verse — plus each RESOLVED cross-ref target, so a commentary on a
  // cross-referenced verse can surface too.
  const libraryAnchors: RefAnchor[] = [
    selectedVerse !== undefined && focusVerses !== null
      ? { book: args.book, chapter: args.chapter, verseStart: selectedVerse, verseEnd: selectedVerse }
      : { book: args.book, chapter: args.chapter },
  ];
  for (const x of xrefs) {
    const id = `${x.to_book}.${x.to_chapter}.${x.to_verse_start}`;
    const { data: tgt } = await supabase
      .from('bible_passages').select('book, chapter, verse_start, verse_end, text')
      .eq('id', id).eq('translation', args.translation).maybeSingle();
    if (tgt) {
      const t = tgt as { book: string; chapter: number; verse_start: number; verse_end: number };
      const ref = refOf(t);
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
            ...(args.displayRefs === true ? { displayRefs: true } : {}),
          },
        ),
    libraryK > 0
      ? retrieveStudyLibrary(libraryDeps, {
          anchors: libraryAnchors, queryEmbedding, query: args.retrievalQuery, k: libraryK,
          book: args.book, chapter: args.chapter,
          ...(args.registers ? { registers: args.registers } : {}),
          // Reranking is a Voyage call; with the semantic half off there is no
          // key to make it with, and the anchor channel is already ordered.
          rerankEnabled: skipSemantic ? false : args.rerankEnabled,
        })
      : Promise.resolve({ libraryExcerpts: [] as LibraryExcerpt[], lexiconEntries: [] as LexiconEntry[] }),
  ]);

  const ctx: BibleChatContext = {
    // The HEADER is a ref too, and the model generalises from it. The first
    // attempt at displayRefs moved every cross-reference and focus verse to
    // reader form but left this as "nam 1" — so the model cited "nam 1:1"
    // through "nam 1:15" for the passage's own verses, none of which the
    // allowlist (now in display form) accepted, and the whole door failed
    // validation. Caught by the second live sweep.
    passageRef: args.displayRefs === true
      ? `${osisToBookName(args.book) ?? args.book} ${args.chapter}`
      : `${args.book} ${args.chapter}`,
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
    // Spread, not `focusVerses: focusVerses ?? undefined`: chapter scope must
    // produce a context with no such key, exactly as every pre-B2 caller did.
    ...(focusVerses ? { focusVerses } : {}),
  };
  return { ctx, offered };
}
