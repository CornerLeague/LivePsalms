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
}

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

  return {
    notes,
    passages,
    allowedNoteIds: new Set(notes.map((n) => n.id)),
    allowedVerseRefs: new Set(passages.map((p) => p.ref)),
    rerankUsed: opts.rerankEnabled && passages.length > 0,
  };
}
