// Builds the month's verse candidate pool (§5). Five provenances, all
// month-scoped by created_at; the month's-own-trail outranks semantic
// neighbours (decision 14). Output is DISPLAY refs (the allowlist contract) —
// the OSIS↔display conversion is the load-bearing internal detail.

import type { MonthNote, ReflectionCandidate } from '../prompts/monthly-reflection.ts';
import { osisRefToDisplay } from '../_shared/bible-books.ts';
import { parseRefToIds } from '../_shared/verse-verify.ts';
import { CANDIDATE_POOL_MAX } from '../_shared/reflection-constants.ts';

// Permissive structural view of the Supabase client: the real client satisfies
// it and hand-rolled test fakes fit without an `as unknown` cast.
// deno-lint-ignore no-explicit-any
export type EdgeSupabase = { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };

export interface BuildReflectionCandidatesDeps {
  supabase: EdgeSupabase;
  userId: string;
  notes: MonthNote[];
  monthStartUtc: string; // ISO instant, inclusive
  monthEndUtc: string;   // ISO instant, exclusive
  embed: (text: string) => Promise<number[]>;
  toLocalDay: (ts: string) => string;
}

export interface ReflectionCandidatesResult {
  candidates: ReflectionCandidate[];
  allowedVerseRefs: Set<string>;
  allowedNoteDays: Set<string>;
}

interface VerseFlag { ref: string; status: 'found' | 'not_found'; canonicalText?: string }
interface TranscriptionRow { verse_flags: VerseFlag[] | null; created_at: string }
interface HighlightRow { verse_id: string; created_at: string }
interface ThreadRow { passage_ref: string; created_at: string }
interface FocusItemRow { book: string; chapter: number; verse_start: number; verse_end: number | null; created_at: string }
interface EmbeddingMatchRow { source_id: string }

function focusItemToDisplay(row: FocusItemRow): string | null {
  const base = osisRefToDisplay(`${row.book}.${row.chapter}.${row.verse_start}`);
  if (base === null) return null;
  return row.verse_end !== null && row.verse_end > row.verse_start ? `${base}-${row.verse_end}` : base;
}

export async function buildReflectionCandidates(
  deps: BuildReflectionCandidatesDeps,
): Promise<ReflectionCandidatesResult> {
  const { supabase, userId, notes, monthStartUtc, monthEndUtc, embed, toLocalDay } = deps;
  const trail: ReflectionCandidate[] = [];

  // flagged — note_transcriptions.verse_flags (display refs → normalize to short form)
  const trans: { data: TranscriptionRow[] | null; error: { message: string } | null } =
    await supabase.from('note_transcriptions').select('verse_flags, created_at')
      .eq('user_id', userId).gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (trans.error) throw new Error(`reflection-candidates flagged: ${trans.error.message}`);
  for (const row of trans.data ?? []) {
    const day = toLocalDay(row.created_at);
    for (const flag of row.verse_flags ?? []) {
      if (flag.status !== 'found') continue;
      const osis = parseRefToIds(flag.ref)?.[0];
      const ref = osis ? osisRefToDisplay(osis) : null;
      if (ref) trail.push({ ref, provenance: 'flagged', note_day: day });
    }
  }

  // highlighted — bible_highlights.verse_id (OSIS verse id)
  const hl: { data: HighlightRow[] | null; error: { message: string } | null } =
    await supabase.from('bible_highlights').select('verse_id, created_at')
      .eq('user_id', userId).gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (hl.error) throw new Error(`reflection-candidates highlighted: ${hl.error.message}`);
  for (const row of hl.data ?? []) {
    const ref = osisRefToDisplay(row.verse_id);
    if (ref) trail.push({ ref, provenance: 'highlighted', note_day: toLocalDay(row.created_at) });
  }

  // studied — lamplight_chat_threads.passage_ref (OSIS chapter-level)
  const th: { data: ThreadRow[] | null; error: { message: string } | null } =
    await supabase.from('lamplight_chat_threads').select('passage_ref, created_at')
      .eq('user_id', userId).gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (th.error) throw new Error(`reflection-candidates studied: ${th.error.message}`);
  for (const row of th.data ?? []) {
    const ref = osisRefToDisplay(row.passage_ref);
    if (ref) trail.push({ ref, provenance: 'studied', note_day: toLocalDay(row.created_at) });
  }

  // focus_listed — scripture_focus_list_items joined to the user's lists (items have no user_id)
  const fi: { data: FocusItemRow[] | null; error: { message: string } | null } =
    await supabase.from('scripture_focus_list_items')
      .select('book, chapter, verse_start, verse_end, created_at, scripture_focus_lists!inner(user_id)')
      .eq('scripture_focus_lists.user_id', userId)
      .gte('created_at', monthStartUtc).lt('created_at', monthEndUtc);
  if (fi.error) throw new Error(`reflection-candidates focus: ${fi.error.message}`);
  for (const row of fi.data ?? []) {
    const ref = focusItemToDisplay(row);
    if (ref) trail.push({ ref, provenance: 'focus_listed', note_day: toLocalDay(row.created_at) });
  }

  // semantic — match_bible_embeddings neighbours of the month's note text
  const semantic: ReflectionCandidate[] = [];
  const noteText = notes.map((n) => n.text).join('\n\n').trim();
  if (noteText.length > 0) {
    const vector = await embed(noteText);
    const res = await supabase.rpc('match_bible_embeddings', { p_query_vector: vector, p_limit: CANDIDATE_POOL_MAX });
    if (res.error) throw new Error(`reflection-candidates semantic: ${res.error.message}`);
    for (const row of (res.data as EmbeddingMatchRow[] | null) ?? []) {
      const ref = osisRefToDisplay(row.source_id);
      if (ref) semantic.push({ ref, provenance: 'semantic' });
    }
  }

  // Dedupe by display ref, trail before semantic so trail provenance wins and
  // trail refs survive the cap (decision 14). Then cap at the pool max.
  const seen = new Set<string>();
  const candidates: ReflectionCandidate[] = [];
  for (const cand of [...trail, ...semantic]) {
    if (seen.has(cand.ref)) continue;
    seen.add(cand.ref);
    candidates.push(cand);
    if (candidates.length >= CANDIDATE_POOL_MAX) break;
  }

  return {
    candidates,
    allowedVerseRefs: new Set(candidates.map((c) => c.ref)),
    allowedNoteDays: new Set(notes.map((n) => n.day)),
  };
}
