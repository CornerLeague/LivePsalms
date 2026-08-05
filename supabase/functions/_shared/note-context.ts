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

  const themeQuery = opts.buildThemeQuery(notes);
  const queryEmbedding = await deps.embedQuery(themeQuery);
  const retrieved = await deps.searchBible({ query: themeQuery, k: opts.k ?? 3, queryEmbedding });

  const sourceIds = retrieved.map((r) => r.source_id);
  const passageRows = await deps.fetchPassages(sourceIds);
  const passages = buildPassages(passageRows, retrieved);

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
