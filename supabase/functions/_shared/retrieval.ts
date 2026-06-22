// Retrieval helpers for the Reasoning Layer. Wraps the match_* RPCs and
// reranks via Voyage. Pure (modulo injected supabase + voyage deps).

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedQuery, rerank, type VoyageDeps } from './voyage.ts';
import { fetchPassageText } from './bible-passage.ts';

export interface RetrievalDeps {
  supabase: SupabaseClient;
  voyage: VoyageDeps;
  rerankEnabled: boolean;
}

export interface RetrievedItem {
  id: string;
  source_id: string;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
  rerank_score?: number;
  metadata: Record<string, unknown>;
}

interface MatchRow {
  id: string;
  source_id: string;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

interface SourceChunkRow {
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
}

const POOL_SIZE = 50;

export async function searchBible(
  deps: RetrievalDeps,
  args: { query: string; k: number; queryEmbedding?: number[]; translation?: string },
): Promise<RetrievedItem[]> {
  const translation = args.translation ?? 'BSB';
  const vector = args.queryEmbedding ?? await embedQuery(args.query, deps.voyage);
  const limit = deps.rerankEnabled ? POOL_SIZE : args.k;
  const { data, error } = await deps.supabase.rpc('match_bible_embeddings', {
    p_query_vector: vector,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as MatchRow[];
  if (rows.length === 0) return [];

  if (!deps.rerankEnabled) {
    return rows.slice(0, args.k).map(toRetrievedItem);
  }
  return rerankBibleRows(deps, args.query, rows, args.k, translation);
}

export async function searchNeighbors(
  deps: RetrievalDeps,
  args: { userId: string; noteId: string; k: number },
): Promise<RetrievedItem[]> {
  // 1. Fetch all chunks of the source note, ordered by chunk_index.
  const sourceChunks = await loadNoteChunks(deps.supabase, args.userId, args.noteId);
  if (sourceChunks.length === 0) return [];

  // 2. Per-chunk fan-out. Group results by target source_id; keep max-sim per target.
  type BestHit = MatchRow & { sourceChunkText: string };
  const best = new Map<string, BestHit>();

  for (const sc of sourceChunks) {
    const { data, error } = await deps.supabase.rpc('match_user_note_embeddings', {
      p_user_id: args.userId,
      p_query_vector: sc.embedding,
      p_exclude_source_id: args.noteId,
      p_limit: POOL_SIZE,
    });
    if (error) throw error;
    for (const r of (data ?? []) as MatchRow[]) {
      const prev = best.get(r.source_id);
      if (!prev || r.similarity > prev.similarity) {
        best.set(r.source_id, { ...r, sourceChunkText: sc.chunk_text });
      }
    }
  }

  // 3. Top candidates by max-chunk similarity.
  const topPool = [...best.values()].sort((a, b) => b.similarity - a.similarity);
  if (topPool.length === 0) return [];

  if (!deps.rerankEnabled) {
    return topPool.slice(0, args.k).map(toRetrievedItem);
  }

  // 4. Rerank. Query = source-chunk text that produced the top-1 candidate.
  //    Documents = each candidate's best-matching chunk text.
  const rerankPool = topPool.slice(0, POOL_SIZE);
  const query = rerankPool[0].sourceChunkText;
  const documents = rerankPool.map(c => c.chunk_text);
  const scored = await rerank(query, documents, args.k, deps.voyage);
  return scored.map(s => toRetrievedItem({
    ...rerankPool[s.index],
    rerank_score: s.score,
  } as MatchRow & { rerank_score: number }));
}

async function loadNoteChunks(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
): Promise<SourceChunkRow[]> {
  const { data, error } = await supabase
    .from('lamplight_embeddings')
    .select('chunk_index, chunk_text, embedding')
    .eq('user_id', userId)
    .eq('source_type', 'note')
    .eq('source_id', noteId)
    .order('chunk_index', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SourceChunkRow[];
}

async function rerankBibleRows(
  deps: RetrievalDeps,
  query: string,
  rows: MatchRow[],
  k: number,
  translation = 'BSB',
): Promise<RetrievedItem[]> {
  const sourceIds = rows.map(r => r.source_id);
  const byId = await fetchPassageText(deps.supabase as never, sourceIds, translation);
  const documents = rows.map(r => byId.get(r.source_id)?.text ?? '');
  const scored = await rerank(query, documents, k, deps.voyage);
  return scored.map(s => toRetrievedItem({
    ...rows[s.index],
    rerank_score: s.score,
  } as MatchRow & { rerank_score: number }));
}

function toRetrievedItem(r: MatchRow & { rerank_score?: number }): RetrievedItem {
  return {
    id: r.id,
    source_id: r.source_id,
    chunk_index: r.chunk_index,
    chunk_text: r.chunk_text,
    similarity: r.similarity,
    metadata: r.metadata,
    ...(r.rerank_score !== undefined ? { rerank_score: r.rerank_score } : {}),
  };
}

/**
 * Semantic search over a single user's note embeddings for an arbitrary text
 * query (used by Bible chat). Reuses the existing match_user_note_embeddings
 * RPC with a null exclude id. When rerankEnabled, pulls a larger pool and
 * reranks by the raw query text.
 */
export async function searchUserNotesByQuery(
  deps: RetrievalDeps,
  args: { userId: string; k: number; query?: string; queryEmbedding?: number[] },
): Promise<RetrievedItem[]> {
  const vector = args.queryEmbedding ?? await embedQuery(args.query ?? '', deps.voyage);
  const limit = deps.rerankEnabled ? POOL_SIZE : args.k;
  const { data, error } = await deps.supabase.rpc('match_user_note_embeddings', {
    p_user_id: args.userId,
    p_query_vector: vector,
    p_exclude_source_id: null,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as MatchRow[];
  if (rows.length === 0) return [];

  if (!deps.rerankEnabled || !args.query) {
    return rows.slice(0, args.k).map(toRetrievedItem);
  }
  const documents = rows.map((r) => r.chunk_text);
  const scored = await rerank(args.query, documents, args.k, deps.voyage);
  return scored.map((s) => toRetrievedItem({ ...rows[s.index], rerank_score: s.score } as MatchRow & { rerank_score: number }));
}
