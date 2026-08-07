// Library retrieval (depth overhaul, slice 1c). Two channels over the corpus
// ingested in 1b, fused with reciprocal-rank fusion:
//
//   1. Verse anchor — chunks whose (book, chapter, verse range) overlaps an
//      anchor ref. Deterministic; this is the channel an embeddings-only
//      retriever does not have. Deliberately NOT an RPC: the caller fetches the
//      anchor chapters via PostgREST and the overlap test runs here in JS, so
//      this slice ships without a migration and reverts by revert.
//   2. Semantic — the match_library_chunks RPC (migration 058).
//
// GRACEFUL DEGRADATION IS THE CONTRACT. An empty table, a failed query, or a
// Voyage error yields [] and the turn proceeds on today's grounding. The
// library must never be able to break a devotion or a chat reply.
//
// LOAD-BEARING: excerpts retrieved here never widen allowedVerseRefs. A
// commentary mentioning Isaiah 40:31 does not authorise citing it — the verse
// text was never supplied. Callers thread these into the prompt only; the
// citation allowlist is built from supplied Scripture alone.
//
// No Deno globals (vitest imports this directly).

import type { SupabaseClient } from '@supabase/supabase-js';
import { rerank, type VoyageDeps } from './voyage.ts';
import { normalizeStrongs } from './strongs-key.ts';

export interface RefAnchor {
  book: string;             // lowercase OSIS, matching bible_passages.book
  chapter: number;
  verseStart?: number;      // absent = the whole chapter
  verseEnd?: number;
}

// A library_chunks row as returned by either channel. `similarity` is present
// only on semantic hits (the anchor channel does no vector math).
export interface LibraryChunkRow {
  id: string;
  source_id: string;
  heading: string;
  content: string;
  book: string | null;
  chapter: number | null;
  verse_start: number | null;
  verse_end: number | null;
  similarity?: number;
}

export interface LibraryExcerpt {
  chunkId: string;
  sourceId: string;
  sourceLabel: string;      // 'The Treasury of David · Charles H. Spurgeon, 1869–1885'
  heading: string;
  content: string;
  score: number;
}

// ── Fusion primitives (pure) ─────────────────────────────────────────────────

/**
 * Does a chunk's verse range overlap an anchor ref?
 *
 * Nulls are open-ended by design, in both directions:
 * - a chunk with no verse_start comments on the whole chapter (Matthew Henry
 *   Concise does this constantly), so it overlaps any verse in it;
 * - an anchor with no verseStart IS the whole chapter, so it matches every
 *   chunk in it.
 * An unanchored chunk (confessional/topical/lexical) never overlaps.
 */
export function overlapsRef(chunk: LibraryChunkRow, anchor: RefAnchor): boolean {
  if (chunk.book === null || chunk.chapter === null) return false;
  if (chunk.book.toLowerCase() !== anchor.book.toLowerCase()) return false;
  if (chunk.chapter !== anchor.chapter) return false;
  if (chunk.verse_start === null) return true;
  if (anchor.verseStart === undefined) return true;

  const chunkEnd = chunk.verse_end ?? chunk.verse_start;
  const anchorEnd = anchor.verseEnd ?? anchor.verseStart;
  return chunk.verse_start <= anchorEnd && chunkEnd >= anchor.verseStart;
}

const RRF_K = 60;

/**
 * Reciprocal-rank fusion across ranked lists. Score = Σ 1/(k + rank), rank
 * 1-based, counting only an item's BEST rank within any one list. Items dedupe
 * by id keeping the summed score; ties break by ascending id so fused order is
 * a function of the inputs alone (stable tests, stable cache keys).
 */
export function fuseRRF<T extends { id: string }>(
  lists: T[][],
  opts: { k?: number } = {},
): Array<{ item: T; score: number }> {
  const k = opts.k ?? RRF_K;
  const byId = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    const seenInList = new Set<string>();
    list.forEach((item, index) => {
      if (seenInList.has(item.id)) return;   // only the best rank counts
      seenInList.add(item.id);
      const contribution = 1 / (k + index + 1);
      const prev = byId.get(item.id);
      if (prev) prev.score += contribution;
      else byId.set(item.id, { item, score: contribution });
    });
  }

  return [...byId.values()].sort((a, b) =>
    b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
  );
}

// ── Rendering helpers (pure) ─────────────────────────────────────────────────

/**
 * The PostgREST `.or()` argument selecting every supplied (book, chapter) pair.
 * Composed here rather than in the dep impl so the filter is unit-testable
 * without a Supabase query-builder stub.
 */
export function chapterOrFilter(pairs: Array<{ book: string; chapter: number }>): string {
  return pairs.map((p) => `and(book.eq.${p.book},chapter.eq.${p.chapter})`).join(',');
}

/** The one place a source's display label is built. Prompts never string-build it. */
export function composeSourceLabel(s: { title: string; author: string; era: string }): string {
  return `${s.title} · ${s.author}, ${s.era}`;
}

// Ingest prepends "<author>, <era> — on <ref>:\n" to every chunk so a semantic
// hit carries its provenance into the ranking (scripts/library-adapters/
// chunk-text.ts). Prompts render sourceLabel + heading instead, which say the
// same thing more cleanly — and the prefix's own ref ("Psalm 27:4") is NOT in
// allowedVerseRefs, so leaving it in the excerpt would dangle an uncitable ref
// in front of the model. Strip it.
const EMBEDDING_PREFIX_RE = /^.{0,160}?,\s[^\n]*\d[^\n]*:\n/;

export function stripEmbeddingPrefix(content: string): string {
  return content.replace(EMBEDDING_PREFIX_RE, '');
}

// ── searchLibrary ────────────────────────────────────────────────────────────

export interface LibraryRetrievalDeps {
  /** Every chunk in the supplied chapters. The impl MUST bound its row count. */
  fetchByChapters(pairs: Array<{ book: string; chapter: number }>): Promise<LibraryChunkRow[]>;
  matchSemantic(args: { embedding: number[]; limit: number; registers?: string[] }): Promise<LibraryChunkRow[]>;
  rerank(query: string, documents: string[], topK: number): Promise<Array<{ index: number; score: number }>>;
  /** sourceId → { label, register }. Cached per invocation by the impl. */
  loadSources(): Promise<Map<string, { label: string; register: string }>>;
}

// One HNSW probe; deep enough that fusion has something to work with. Matches
// retrieval.ts's POOL_SIZE.
const SEMANTIC_POOL = 50;

export async function searchLibrary(
  deps: LibraryRetrievalDeps,
  args: {
    refs: RefAnchor[];
    queryEmbedding: number[];
    query: string;
    k: number;
    registers?: string[];
    rerankEnabled: boolean;
  },
): Promise<LibraryExcerpt[]> {
  const pairs = distinctChapters(args.refs);

  const [sources, anchorRows, semanticRows] = await Promise.all([
    safely('sources', () => deps.loadSources(), null),
    pairs.length === 0
      ? Promise.resolve<LibraryChunkRow[]>([])
      : safely('anchor channel', () => deps.fetchByChapters(pairs), []),
    safely('semantic channel', () => deps.matchSemantic({
      embedding: args.queryEmbedding,
      limit: SEMANTIC_POOL,
      ...(args.registers ? { registers: args.registers } : {}),
    }), []),
  ]);

  // Fail closed: without the source registry we can neither honour a register
  // filter nor label an excerpt, and a devotion asking for devotional voices
  // must not silently receive exegetical ones.
  if (!sources) return [];

  const inRegister = (row: LibraryChunkRow) => {
    const source = sources.get(row.source_id);
    if (!source) return false;                       // orphan chunk: never prompt it
    return !args.registers || args.registers.includes(source.register);
  };

  // The anchor channel can't express register (no join) and returns rows in
  // arbitrary order, so both are settled here: overlap + register filter, then
  // a rank.
  //
  // Ranking: semantically-corroborated rows first, then most-specific-first.
  // The reader has a whole CHAPTER open, so every chunk in it overlaps and
  // specificity alone would rank by verse number — meaning verse-1 commentary
  // would take a slot on every turn no matter what was asked. Borrowing the
  // semantic rank puts "on this passage AND about this question" at the head
  // while chunks the embedding missed still ride along for recall. Ties stay
  // deterministic.
  const semantic = semanticRows.filter(inRegister);   // already similarity-ordered
  const semanticRank = new Map(semantic.map((row, i) => [row.id, i]));
  const anchored = anchorRows
    .filter((row) => inRegister(row) && args.refs.some((ref) => overlapsRef(row, ref)))
    .sort((a, b) =>
      (semanticRank.get(a.id) ?? Number.POSITIVE_INFINITY) - (semanticRank.get(b.id) ?? Number.POSITIVE_INFINITY)
      || bySpecificity(a, b),
    );

  const fused = fuseRRF([anchored, semantic]).slice(0, args.k * 2);
  if (fused.length === 0) return [];

  const toExcerpt = (row: LibraryChunkRow, score: number): LibraryExcerpt => ({
    chunkId: row.id,
    sourceId: row.source_id,
    sourceLabel: sources.get(row.source_id)!.label,
    heading: row.heading,
    content: stripEmbeddingPrefix(row.content),
    score,
  });

  if (!args.rerankEnabled) {
    return fused.slice(0, args.k).map((f) => toExcerpt(f.item, f.score));
  }

  const documents = fused.map((f) => stripEmbeddingPrefix(f.item.content));
  const scored = await safely('rerank', () => deps.rerank(args.query, documents, args.k), null);
  if (!scored) {
    return fused.slice(0, args.k).map((f) => toExcerpt(f.item, f.score));
  }
  return scored
    .slice(0, args.k)
    .map((s) => toExcerpt(fused[s.index].item, s.score));
}

function distinctChapters(refs: RefAnchor[]): Array<{ book: string; chapter: number }> {
  const seen = new Set<string>();
  const out: Array<{ book: string; chapter: number }> = [];
  for (const r of refs) {
    const key = `${r.book}.${r.chapter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ book: r.book, chapter: r.chapter });
  }
  return out;
}

// Narrowest range first; whole-chapter chunks last; ties by verse then id so the
// channel's rank is a function of the rows alone.
function bySpecificity(a: LibraryChunkRow, b: LibraryChunkRow): number {
  const width = (c: LibraryChunkRow) =>
    c.verse_start === null ? Number.POSITIVE_INFINITY : (c.verse_end ?? c.verse_start) - c.verse_start;
  const start = (c: LibraryChunkRow) => c.verse_start ?? Number.POSITIVE_INFINITY;
  return width(a) - width(b) || start(a) - start(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ── Lexicon block ────────────────────────────────────────────────────────────
// Built from bible_strongs + bible_interlinear (migration 041) DIRECTLY, not
// from library_chunks: slice 1b dropped the STEPBible lexical source because
// those tables already hold the same public-domain Strong's data, and copying
// it into the corpus would have been pure duplication.

export interface StrongsRow {
  strongs: string;
  lemma: string;
  transliteration: string;
  short_def: string;
  language: string;
}

export interface LexiconEntry {
  strongs: string;
  lemma: string;
  transliteration: string;
  gloss: string;
  language: string;
  occurrences: number;     // within the chapter — why this word was chosen
}

export interface LexiconDeps {
  fetchInterlinear(args: { book: string; chapter: number }): Promise<Array<{ strongs: string | null }>>;
  fetchStrongs(codes: string[]): Promise<StrongsRow[]>;
}

// A guess, per the plan's open question — tune once real prompts are inspected.
const LEXICON_CAP = 12;

// How many frequency-ranked candidates to look up before capping. Headroom for
// codes with no OpenScriptures entry — chiefly STEP prefix codes (H9xxx: the
// article, conjunction, prepositions), which are among a Hebrew chapter's most
// frequent tokens. Looking up only the top `cap` would spend every slot on
// them and return an empty block.
const LEXICON_LOOKUP_MULTIPLIER = 4;

/**
 * The chapter's characteristic original-language words, most frequent first.
 *
 * Frequency (not document order) is the selector so the block reflects what the
 * chapter is *about* rather than whatever happened to be in verse 1. Ties break
 * by Strong's code so the block — and any prompt hash over it — is stable.
 *
 * Raw dStrong values are normalized BEFORE counting, so "H0430" and
 * "H9003/{H0430}" are one word occurring twice rather than two unmatched keys.
 */
export async function fetchLexiconEntries(
  deps: LexiconDeps,
  args: { book: string; chapter: number; cap?: number },
): Promise<LexiconEntry[]> {
  const rows = await safely('interlinear', () => deps.fetchInterlinear({ book: args.book, chapter: args.chapter }), null);
  if (!rows) return [];

  const cap = args.cap ?? LEXICON_CAP;
  const counts = new Map<string, number>();
  for (const row of rows) {
    // '' = untagged particle or a raw value carrying no lexical Strong's number.
    const code = row.strongs ? normalizeStrongs(row.strongs) : '';
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, cap * LEXICON_LOOKUP_MULTIPLIER);

  const defs = await safely('strongs', () => deps.fetchStrongs(ranked.map(([code]) => code)), null);
  if (!defs) return [];
  const byCode = new Map(defs.map((d) => [d.strongs, d]));

  return ranked
    .filter(([code]) => byCode.has(code))             // no entry beats a blank gloss
    .slice(0, cap)                                    // cap AFTER dropping unmapped codes
    .map(([code, occurrences]) => {
      const def = byCode.get(code)!;
      return {
        strongs: code,
        lemma: def.lemma,
        transliteration: def.transliteration,
        gloss: def.short_def,
        language: def.language,
        occurrences,
      };
    });
}

// Every I/O leaf funnels through here: log and hand back the fallback, never
// reject. This is the graceful-degradation contract in one place.
async function safely<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`[library-retrieval] ${what} failed; degrading:`, err);
    return fallback;
  }
}

// ── Library deps (§LibraryRetrieval) ──────────────────────────────────────────
// The .from('library_chunks')… / .rpc('match_library_chunks')… query strings
// live here, written ONCE, so _shared/library-retrieval.ts stays node-testable
// with plain fakes (mirrors §NoteContext).

// PostgREST truncates a response at ~1000 rows silently — the failure that left
// 91% of the corpus unembedded in slice 1b. Both caps below sit well inside it.
// A chapter's worth of commentary is a few dozen rows; the cap only bites on
// pathological chapters, where losing the tail costs nothing (the semantic
// channel still reaches it).
/**
 * Anchor-channel rows fetched **per source**, not in total.
 *
 * A single global cap made breadth a matter of physical row order. Psalm 119
 * carries 627 Treasury chunks against 22 Matthew Henry and 70 JFB — and every
 * one of those Treasury chunks has `verse_start = null`, so it overlaps ANY
 * anchor — which means one source can crowd the others out of the result
 * entirely. It does not today, but only because of how the rows happen to sit;
 * nothing in the query defends it, and the margin disappears as the corpus
 * grows.
 *
 * Fetching per source makes breadth structural: a thin source arrives whole, a
 * flooding one is bounded. 200 covers the longest chapter in the canon (Psalm
 * 119, 176 verses) at one chunk per verse.
 *
 * KNOWN LIMIT: rows are ordered by verse, so truncating a flooding source drops
 * the TAIL of the chapter. A verse-scope anchor late in a huge chapter can
 * therefore miss that source. The real fix is to push the verse-overlap filter
 * into SQL rather than filtering in `searchLibrary` after the fetch, which
 * needs `fetchByChapters` to take anchors instead of chapter pairs.
 */
const PER_SOURCE_ROW_CAP = 200;
// Psalm 119 is ~1,700 interlinear words, so this truncates there: the frequency
// ranking is then drawn from the chapter's first 1,000 words rather than all of
// them. Acceptable for a prompt heuristic; if it ever matters, page it the way
// scripts/etymology/seed-etymology.ts does (.range() in 1,000-row pages).
const LEXICON_WORD_CAP = 1000;

export function makeLibraryDeps(
  supabase: SupabaseClient,
  voyage: VoyageDeps,
): LibraryRetrievalDeps & LexiconDeps {
  let sources: Map<string, { label: string; register: string }> | null = null;

  // Shared by fetchByChapters and loadSources: the anchor channel needs the
  // source list to fan out per source, and re-reading it per turn would be a
  // second round trip for data already cached here.
  const loadSourcesOnce = async (): Promise<Map<string, { label: string; register: string }>> => {
    if (sources) return sources;
    const { data, error } = await supabase
      .from('library_sources')
      .select('id, title, author, era, register');
    if (error) throw error;
    const map = new Map<string, { label: string; register: string }>();
    for (const s of (data ?? []) as Array<{ id: string; title: string; author: string; era: string; register: string }>) {
      map.set(s.id, { label: composeSourceLabel(s), register: s.register });
    }
    sources = map;
    return map;
  };

  return {
    async fetchByChapters(pairs) {
      if (pairs.length === 0) return [];
      const sourceIds = [...(await loadSourcesOnce()).keys()];
      if (sourceIds.length === 0) return [];

      // One bounded query PER SOURCE, run together. See PER_SOURCE_ROW_CAP: a
      // single global cap let one source crowd the rest out, and with no
      // ORDER BY the survivors were whatever the planner returned first.
      const or = chapterOrFilter(pairs);
      // allSettled, NOT all: one source failing must cost that source only.
      // With `Promise.all` a single rejection propagated out of here, and
      // searchLibrary's `safely()` turned it into an empty anchor channel — so
      // one timing-out source lost ALL of them, which is strictly worse than
      // the single query this fan-out replaced.
      const batches = await Promise.allSettled(sourceIds.map(async (sourceId) => {
        const { data, error } = await supabase
          .from('library_chunks')
          .select('id, source_id, heading, content, book, chapter, verse_start, verse_end')
          .eq('source_id', sourceId)
          .or(or)
          // Deterministic, so truncation is reproducible and testable rather
          // than a function of row layout. `id` breaks ties.
          .order('verse_start', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .limit(PER_SOURCE_ROW_CAP);
        if (error) throw new Error(`${sourceId}: ${error.message}`);
        return (data ?? []) as LibraryChunkRow[];
      }));

      const rows: LibraryChunkRow[] = [];
      for (const b of batches) {
        if (b.status === 'fulfilled') { rows.push(...b.value); continue; }
        // Named, so a narrowed corpus is diagnosable. A dropped source looks
        // exactly like a normal result otherwise — the grounding floors only
        // fire at ZERO excerpts, and with eight sources one missing tradition
        // is invisible.
        console.error('[library] anchor fetch failed for', b.reason instanceof Error ? b.reason.message : b.reason);
      }
      return rows;
    },
    async matchSemantic({ embedding, limit, registers }) {
      // Raw number[] for p_query_vector, matching match_bible_embeddings in
      // _shared/retrieval.ts (PostgREST coerces it to the vector type).
      const { data, error } = await supabase.rpc('match_library_chunks', {
        p_query_vector: embedding,
        p_limit: limit,
        p_registers: registers ?? null,
      });
      if (error) throw error;
      return (data ?? []) as LibraryChunkRow[];
    },
    rerank: (query, documents, topK) => rerank(query, documents, topK, voyage),
    loadSources: loadSourcesOnce,
    async fetchInterlinear({ book, chapter }) {
      // verse_id is 'psa.27.4'; the trailing dot keeps 'psa.2.%' off 'psa.27.4'.
      const { data, error } = await supabase
        .from('bible_interlinear')
        .select('strongs')
        .like('verse_id', `${book}.${chapter}.%`)
        .limit(LEXICON_WORD_CAP);
      if (error) throw error;
      return (data ?? []) as Array<{ strongs: string | null }>;
    },
    async fetchStrongs(codes) {
      const { data, error } = await supabase
        .from('bible_strongs')
        .select('strongs, lemma, transliteration, short_def, language')
        .in('strongs', codes);
      if (error) throw error;
      return (data ?? []) as StrongsRow[];
    },
  };
}
