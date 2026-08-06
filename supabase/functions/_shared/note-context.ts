// Shared recent-notes → theme-query → Bible-passage retrieval (§NoteContext).
//
// Owns the sequence the smoke-test and daily-devotion context builders in
// lamplight-generate/index.ts both open-coded: fetch the N most-recently-updated
// notes, map each to { id, title, plaintext }, drop the blank ones, short-circuit
// to null when none survive (no embed/search work happens), build the theme query
// via the injected strategy, embed it, search the Bible, fetch the matched
// passages, run buildPassages, and derive the allowed-sets + rerankUsed gate.
//
// Pure of Supabase: the four I/O leaves are injected NoteContextDeps, so the
// orchestration is node-testable with plain fakes (mirrors §GenerationLifecycle /
// §GenerateWithRetry). index.ts writes the .from('notes')… / .from('bible_passages')…
// queries once as the shared dep impls both builders pass.

import { extractTextFromNoteContent } from './tiptap-text.ts';
import { buildPassages, type BiblePassage, type BiblePassageRow } from './bible-passage.ts';
import type { RetrievedItem } from './retrieval.ts';
import { CONTESTED_PASSAGES } from './voice.ts';
import {
  searchLibrary,
  type LibraryExcerpt,
  type LibraryRetrievalDeps,
  type RefAnchor,
} from './library-retrieval.ts';

export interface NoteContextNote {
  id: string;
  title: string;
  plaintext: string;
}

export interface NoteContext {
  notes: NoteContextNote[];
  passages: BiblePassage[];
  allowedNoteIds: Set<string>;
  allowedVerseRefs: Set<string>;
  rerankUsed: boolean;
  // Slice 1c. Undefined when no library dep was injected — the smoke-test
  // builder and any future caller opt in explicitly. NEVER contributes to
  // allowedVerseRefs.
  libraryExcerpts?: LibraryExcerpt[];
}

// A raw notes row as fetched by the caller's `.from('notes')…select('id, title, content')`.
export interface RawNoteRow {
  id: string;
  title: string | null;
  content: string;
}

// What searchBible yields and buildPassages consumes — same shape, named here
// to match the §NoteContext dep contract.
export type RetrievedBibleRow = RetrievedItem;

export interface NoteContextDeps {
  fetchRecentNotes(userId: string, limit: number): Promise<RawNoteRow[]>;
  embedQuery(text: string): Promise<number[]>;
  searchBible(args: { query: string; k: number; queryEmbedding: number[] }): Promise<RetrievedBibleRow[]>;
  fetchPassages(sourceIds: string[]): Promise<BiblePassageRow[]>;
  /** Slice 1c, OPTIONAL: omit and this seam behaves exactly as it did before. */
  library?: LibraryRetrievalDeps;
}

/**
 * Would the content rule reject an artifact that cites this ref?
 *
 * Retrieval and the content layer used to disagree: a user reading Romans 9
 * could have Romans 9:16 retrieved as a devotion candidate, the model would
 * anchor on it and cite the ref exactly as instructed, and applyContentRules
 * would reject the artifact — on both attempts, so the reader got an error. The
 * stricter-retry line even asks the model to "name them gently and defer",
 * which the validator forbids. There is no wording that satisfies both, so the
 * candidate must never be offered.
 *
 * This deliberately mirrors applyContentRules' substring match rather than
 * parsing verse numbers: the filter has to be AT LEAST as strict as the gate it
 * is protecting, and a cleverer rule could let through a ref the gate rejects.
 * Chapter-level entries ("Revelation 13") therefore cover every verse in them,
 * and the same benign over-match ("1 Corinthians 11:2" catching 11:20) applies
 * to both.
 */
export function isContestedRef(ref: string): boolean {
  const lower = ref.toLowerCase();
  return CONTESTED_PASSAGES.some((p) => lower.includes(p.toLowerCase()));
}

// Retrieve a couple more candidates than the devotion needs, so filtering a
// contested one out still leaves it something to anchor on. Costs nothing —
// the same RPC, a slightly longer result.
const CONTESTED_HEADROOM = 2;

/**
 * The candidate passages a devotion may anchor on: contested ones removed, then
 * capped at k.
 *
 * Exported because the eval harness builds its context by hand — it has no
 * Voyage key, so it cannot run retrieval — and any transformation that lives
 * only inside retrieveNoteContext is therefore invisible to the eval. That is
 * not hypothetical: the contested filter shipped, the eval kept failing on the
 * same fixture with a byte-identical prompt, because the harness never called
 * it. One exported function, called by both, makes that divergence impossible
 * for this step.
 */
export function selectDevotionCandidates(passages: BiblePassage[], k: number): BiblePassage[] {
  const kept = passages.filter((p) => !isContestedRef(p.ref)).slice(0, k);
  if (kept.length === 0 && passages.length > 0) {
    // Every candidate was contested. The devotion will fail its citation gate,
    // exactly as it would have before — but silently, so say so.
    console.warn(
      '[note-context] every retrieved candidate is a contested passage; the devotion has nothing to anchor on:',
      passages.map((p) => p.ref).join(', '),
    );
  }
  return kept;
}

// Today's Lamp budget (library-and-reasoning design, §Retrieval budgets): two
// devotional-register excerpts. Devotional-only because the devotion draws
// substance silently — Spurgeon's warmth suits it, JFB's grammar apparatus
// does not.
const DEVOTION_LIBRARY_K = 2;
const DEVOTION_REGISTERS = ['devotional'];

export async function retrieveNoteContext(
  deps: NoteContextDeps,
  opts: {
    userId: string;
    noteLimit: number;
    rerankEnabled: boolean;
    buildThemeQuery: (notes: NoteContextNote[]) => string;
    k?: number;
  },
): Promise<NoteContext | null> {
  const rows = await deps.fetchRecentNotes(opts.userId, opts.noteLimit);

  const notes: NoteContextNote[] = rows
    .map((n) => ({
      id: n.id,
      title: (n.title ?? '').trim() || '(untitled)',
      plaintext: extractTextFromNoteContent(n.content).slice(0, 800),
    }))
    .filter((n) => n.plaintext.trim().length > 0);
  // No surviving notes → no embed/search work happens.
  if (notes.length === 0) return null;

  const k = opts.k ?? 3;
  const themeQuery = opts.buildThemeQuery(notes);
  const queryEmbedding = await deps.embedQuery(themeQuery);
  const retrieved = await deps.searchBible({ query: themeQuery, k: k + CONTESTED_HEADROOM, queryEmbedding });

  const sourceIds = retrieved.map((r) => r.source_id);
  const passageRows = await deps.fetchPassages(sourceIds);
  const passages = selectDevotionCandidates(buildPassages(passageRows, retrieved), k);

  // Anchored on the passages the devotion will actually quote — verse-precise,
  // not chapter-wide, because the devotion has three candidates rather than an
  // open chapter. searchLibrary owns its own degradation, so a library failure
  // here can never fail a devotion.
  const rowById = new Map(passageRows.map((r) => [r.id, r]));
  const anchors: RefAnchor[] = passages
    .map((p) => rowById.get(p.source_id))
    .filter((r): r is BiblePassageRow => r !== undefined)
    .map((r) => ({ book: r.book, chapter: r.chapter, verseStart: r.verse_start, verseEnd: r.verse_end }));

  const libraryExcerpts = deps.library
    ? await searchLibrary(deps.library, {
        refs: anchors,
        queryEmbedding,
        query: themeQuery,
        k: DEVOTION_LIBRARY_K,
        registers: DEVOTION_REGISTERS,
        rerankEnabled: opts.rerankEnabled,
      })
    : undefined;

  return {
    notes,
    passages,
    allowedNoteIds: new Set(notes.map((n) => n.id)),
    // Deliberately passages only. A devotional excerpt that quotes a verse does
    // not make that verse quotable — its text was never supplied.
    allowedVerseRefs: new Set(passages.map((p) => p.ref)),
    rerankUsed: opts.rerankEnabled && passages.length > 0,
    ...(libraryExcerpts ? { libraryExcerpts } : {}),
  };
}
