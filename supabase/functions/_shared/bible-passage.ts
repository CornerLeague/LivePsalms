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

// ── Psalm superscriptions ────────────────────────────────────────────────────
// BSB/KJV/WEB fuse the editorial heading ("For the choirmaster. A Psalm of
// David.") into verse 1's text. That is defensible in the READER — the heading
// belongs to the text tradition — but a devotion card must open with the verse,
// not the apparatus, so the devotion path strips it at build time. The database
// is untouched: rewriting verse-1 rows would ripple through the reader, the
// bible embeddings, and verification's canonical text.
//
// The grammar consumes leading SENTENCES while they match known superscription
// shapes, then stops. It was written against an audit of every psalm verse-1
// row in all three translations (450 rows + hab.3.1), not against examples.
// The traps that shaped it:
//   - Ps 126's BODY starts "When the LORD restored…" while Ps 51/52/54/60 have
//     narrative "When/After…" sentences that ARE superscription. In the data,
//     narrative continuations only ever follow an authorship lead, so a
//     When/After sentence is consumed only when the previous sentence names
//     the author ("…of David" / "…by David").
//   - Ps 137's body starts "By the rivers…" while WEB headings say "By David."
//     — the By-lead names specific people, never places.
//   - KJV Ps 18's heading runs into the body with a comma ("…And he said, I
//     will love thee"), so "And he said," is a terminal prefix, not a sentence.

const SUPERSCRIPTION_LEADS: RegExp[] = [
  /^\[?(To|For) the [Cc]hief Musician/,
  /^For the choirmaster\b/,
  /^\[?An? (Psalm|psalm|Song|song|Prayer|prayer|Maskil|Miktam|Michtam|Maschil|Shiggaion|Poem|poem|Meditation|meditation|Contemplation|contemplation|love song|praise psalm)\b/,
  /^Of (David|Solomon|Asaph|Moses|the sons of Korah)\b/,
  /^By (David|Solomon|Moses|Asaph|the sons of Korah)\b/,
  /^(Maschil|Michtam|Shiggaion)\b/,
  /^According to\b/,
  /^To the tune of\b/,
  /^(With|On|For) (a |the )?(stringed|wind) instruments?\b/,
  /^For Jeduthun\b/,
  /^David’s \[?[Pp]salm\]?/,
];
const NARRATIVE_CONTINUATION = /^(When|After)\b/;
const AUTHORSHIP = /\b(of|by) David\b/i;
const TERMINAL_PREFIX = /^And he said,\s*/;
const TERMINAL_CHUNK = /^He said:$/;
// '?' is a boundary too: KJV Ps 54's heading ends with a quoted question
// ("…Doth not David hide himself with us?"). Finer chunking cannot over-strip —
// every chunk after the first still has to match a lead or continuation.
const SENTENCE_END = /[.:?][”\]]?\s+/g;

export function stripPsalmSuperscription(text: string): string {
  let consumed = 0;
  let prevChunk = '';
  let any = false;

  for (;;) {
    SENTENCE_END.lastIndex = consumed;
    const m = SENTENCE_END.exec(text);
    if (!m) break;
    const end = m.index + m[0].length;
    const chunk = text.slice(consumed, end).trim();

    if (any && TERMINAL_CHUNK.test(chunk) && AUTHORSHIP.test(prevChunk)) {
      consumed = end;
      break;
    }
    const lead = SUPERSCRIPTION_LEADS.some((re) => re.test(chunk));
    const narrative = any && NARRATIVE_CONTINUATION.test(chunk) && AUTHORSHIP.test(prevChunk);
    if (!lead && !narrative) break;

    consumed = end;
    prevChunk = chunk;
    any = true;
  }

  if (any) {
    const t = text.slice(consumed).match(TERMINAL_PREFIX);
    if (t && AUTHORSHIP.test(prevChunk)) consumed += t[0].length;
  }

  const body = text.slice(consumed);
  // A heading with no body left (or nothing recognised) stays untouched: a raw
  // heading is odd, an empty verse is broken.
  return any && body.trim().length > 0 ? body : text;
}

/** The rows whose verse-1 text carries a superscription slot. */
export function superscriptionApplies(p: { book: string; chapter: number; verse_start: number }): boolean {
  if (p.verse_start !== 1) return false;
  return p.book === 'psa' || (p.book === 'hab' && p.chapter === 3);
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
        source_id: r.source_id,
        text: superscriptionApplies(p) ? stripPsalmSuperscription(p.text) : p.text,
        ref,
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
