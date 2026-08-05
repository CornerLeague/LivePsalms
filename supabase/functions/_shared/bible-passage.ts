// Shared verse-reference formatting and bible_passages→passage join.
//
// formatVerseRef + buildPassages own the Reference-domain logic (per
// §Reference / §ScriptureNode) that the smoke-test and daily-devotion context
// builders in lamplight-generate/index.ts both held as byte-identical copies.

import type { RetrievedItem } from './retrieval.ts';
import { osisToBookName } from './verse-verify.ts';

// Minimal typing for the supabase client slice we need (avoids pulling in the
// full @supabase/supabase-js types in a context where the JSR import is used).
interface _SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        in(col: string, ids: string[]): PromiseLike<{ data: BiblePassageRow[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export interface BiblePassageRow {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  text: string;
}

export interface BiblePassage {
  source_id: string;
  text: string;
  ref: string;
  metadata: Record<string, unknown>;
}

export function formatVerseRef(
  p: { book: string; chapter: number; verse_start: number; verse_end: number },
): string {
  const suffix = p.verse_end !== p.verse_start
    ? `${p.verse_start}-${p.verse_end}`
    : `${p.verse_start}`;
  return `${p.book} ${p.chapter}:${suffix}`;
}

/**
 * A ref fit to show a reader, and to hand a model.
 *
 * bible_passages.book holds the OSIS CODE, so formatVerseRef yields "psa 23:4".
 * That is fine as an internal key but wrong everywhere it surfaces: it was
 * rendered on the reader's Today's Lamp card, and the first eval baseline caught
 * the model echoing the form into the reflection prose ("The image in psa 16:6
 * is not of possessing everything…").
 *
 * The full book name — not the "Ps" abbreviation reflections use — is chosen so
 * the result round-trips through parseRefToIds. An unparseable allowlist ref is
 * how Scripture verification came to silently skip every devotion.
 *
 * Unknown book values pass through untouched: a raw value is ugly, a blank ref
 * is a lie.
 */
export function formatDisplayVerseRef(
  p: { book: string; chapter: number; verse_start: number; verse_end: number },
): string {
  return formatVerseRef({ ...p, book: osisToBookName(p.book) ?? p.book });
}

export function buildPassages(
  passageRows: BiblePassageRow[],
  retrieved: RetrievedItem[],
): BiblePassage[] {
  const passageById = new Map<string, BiblePassageRow>();
  for (const r of passageRows) {
    passageById.set(r.id, r);
  }
  return retrieved
    .map(r => {
      const p = passageById.get(r.source_id);
      if (!p) return null;
      const ref = formatDisplayVerseRef(p);
      return {
        source_id: r.source_id, text: p.text, ref,
        metadata: { book: p.book, chapter: p.chapter, similarity: r.similarity, rerank_score: r.rerank_score },
      };
    })
    .filter((x): x is BiblePassage => x !== null);
}

/**
 * Fetch bible_passages by OSIS ids in the requested translation, with a
 * per-id BSB fallback for any id not present in that translation.
 *
 * - When translation === 'BSB', a single query is issued (no fallback needed).
 * - When translation !== 'BSB', a second query covers only the ids that came
 *   back empty from the first (versification fallback).
 *
 * Returns a Map<id, BiblePassageRow> covering all supplied ids that exist in
 * either the requested translation or BSB.
 */
export async function fetchPassageText(
  supabase: _SupabaseLike,
  ids: string[],
  translation: string,
): Promise<Map<string, BiblePassageRow>> {
  const byId = new Map<string, BiblePassageRow>();
  if (ids.length === 0) return byId;

  const pull = async (t: string, need: string[]): Promise<void> => {
    if (need.length === 0) return;
    const { data, error } = await supabase
      .from('bible_passages')
      .select('id, book, chapter, verse_start, verse_end, text')
      .eq('translation', t)
      .in('id', need);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as BiblePassageRow[]) byId.set(r.id, r);
  };

  await pull(translation, ids);
  if (translation !== 'BSB') {
    const missing = ids.filter((id) => !byId.has(id));
    await pull('BSB', missing); // versification fallback
  }
  return byId;
}
