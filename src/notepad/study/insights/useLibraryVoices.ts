// src/notepad/study/insights/useLibraryVoices.ts
// The class-B channel: what the church's study says about THIS passage.
//
// This is the deterministic verse-anchor join — the same channel
// _shared/library-retrieval.ts runs server-side to ground study chat, minus the
// semantic half. No embedding call, no LLM, no entitlement: library_chunks and
// library_sources are public-read (migration 058), so a signed-out reader sees
// the same voices a subscriber does.
//
// GRACEFUL DEGRADATION IS THE CONTRACT. A failed query, an empty table, or a
// chapter nobody commented on all yield [] — never an error state. The section
// renders nothing at all rather than apologising for itself.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  overlapsVerseRange,
  composeSourceLabel,
  stripEmbeddingPrefix,
  type LibraryChunkRow,
  type RefAnchor,
} from './library-voices-query';

export interface LibraryVoice {
  chunkId: string;
  sourceId: string;
  sourceLabel: string;      // 'The Treasury of David · Charles H. Spurgeon, 1869–1885'
  tradition: string;        // 'Baptist (Reformed)' — drives the coverage header
  heading: string;
  content: string;
}

export interface UseLibraryVoicesResult {
  voices: LibraryVoice[];
  loading: boolean;
}

// A chapter's chunk count is small (Treasury runs richest, at a few dozen per
// psalm), but the query is unbounded by nature, so cap it. PostgREST also caps
// responses around 1000 rows — being explicit beats discovering that silently,
// which is exactly how the Phase-1 embedding pass shipped a bug.
const MAX_CHUNKS = 400;

type SourceJoin = { title: string; author: string; era: string; tradition: string } | null;
type ChunkRowWithSource = LibraryChunkRow & { library_sources: SourceJoin };

const SELECT = 'id, source_id, heading, content, book, chapter, verse_start, verse_end, library_sources(title, author, era, tradition)';

function anchorKey(a: RefAnchor): string {
  return `${a.book}.${a.chapter}.${a.verseStart ?? ''}.${a.verseEnd ?? ''}`;
}

/**
 * Voices anchored to `anchor`. Pass `null` to query nothing.
 *
 * The effect keys on the anchor's primitive fields rather than the object, so
 * callers may pass an inline literal without refetching on every render.
 *
 * `loading` is DERIVED — "we have an anchor, and the state we hold isn't for
 * it yet" — rather than set at the top of the effect. That keeps the effect
 * body free of synchronous setState (which cascades a render, and which the
 * react-hooks lint rule rejects), and it means a moved anchor clears the
 * previous passage's voices for free instead of briefly showing them under the
 * new heading.
 */
export function useLibraryVoices(anchor: RefAnchor | null): UseLibraryVoicesResult {
  const [settled, setSettled] = useState<{ key: string | null; voices: LibraryVoice[] }>(
    () => ({ key: null, voices: [] }),
  );

  const book = anchor?.book ?? null;
  const chapter = anchor?.chapter ?? null;
  const verseStart = anchor?.verseStart;
  const verseEnd = anchor?.verseEnd;

  const resolved = useMemo<RefAnchor | null>(
    () => (book === null || chapter === null
      ? null
      : { book, chapter, ...(verseStart !== undefined ? { verseStart } : {}), ...(verseEnd !== undefined ? { verseEnd } : {}) }),
    [book, chapter, verseStart, verseEnd],
  );

  const key = resolved ? anchorKey(resolved) : null;

  useEffect(() => {
    if (!resolved || !supabase) return;   // nothing to synchronize
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase!
        .from('library_chunks')
        .select(SELECT)
        .eq('book', resolved.book)
        .eq('chapter', resolved.chapter)
        .limit(MAX_CHUNKS);
      if (cancelled) return;

      // Degrade quietly: an error is indistinguishable from "nobody wrote about
      // this chapter" as far as the reader is concerned, and both are fine.
      const rows = (error ? [] : (data ?? [])) as unknown as ChunkRowWithSource[];
      setSettled({ key: anchorKey(resolved), voices: toVoices(rows, resolved) });
    })();

    return () => { cancelled = true; };
  }, [resolved]);

  const isSettled = settled.key === key;
  return {
    voices: isSettled ? settled.voices : EMPTY_VOICES,
    loading: key !== null && !isSettled,
  };
}

// Stable identity so a caller memoizing on `voices` doesn't churn while loading.
const EMPTY_VOICES: LibraryVoice[] = [];

function toVoices(rows: ChunkRowWithSource[], anchor: RefAnchor): LibraryVoice[] {
  return rows
    .filter((r) => overlapsVerseRange(r, anchor))
    // An orphan chunk (source row missing) can be neither labelled nor
    // attributed, and an unattributed excerpt is the one thing this section
    // must never render. Drop it, exactly as the server's register filter does.
    .filter((r) => r.library_sources !== null)
    .sort(compareVoices)
    .map((r) => {
      const s = r.library_sources!;
      return {
        chunkId: r.id,
        sourceId: r.source_id,
        sourceLabel: composeSourceLabel(s),
        tradition: s.tradition,
        heading: r.heading,
        content: stripEmbeddingPrefix(r.content),
      };
    });
}

// Stable ordering so the panel never reshuffles between renders: source first,
// then the source's whole-chapter comment ahead of its verse-level ones (the
// general remark reads naturally before the specific), then heading.
function compareVoices(a: ChunkRowWithSource, b: ChunkRowWithSource): number {
  if (a.source_id !== b.source_id) return a.source_id < b.source_id ? -1 : 1;
  const av = a.verse_start ?? -1;
  const bv = b.verse_start ?? -1;
  if (av !== bv) return av - bv;
  if (a.heading !== b.heading) return a.heading < b.heading ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
