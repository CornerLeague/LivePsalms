// The server-side Insights door registry.
//
// One place that knows which doors exist, what each is called in the `door`
// column, and how each wants its library retrieved. The stream orchestration,
// the edge-function shell and the eval harness all resolve a door here rather
// than importing a prompt module directly — so adding Door 3 is an entry, not a
// call-site sweep.
//
// Deliberately NOT in prompts/insight-door.ts: that module is the shared
// mechanism and must not import either door, or the two would import each other.
// This file sits above both.
//
// Retrieval config lives HERE rather than on InsightDoorSpec, which is a
// prompts/ concern. A door's prose and a door's top-k are different kinds of
// decision — one is editorial and version-stamped, the other is measured with a
// free grounding sweep and changed without touching a prompt.
import { PASSAGE_DOOR_SPEC } from './prompts/passage-insight.ts';
import { DEEPER_DOOR_SPEC } from './prompts/deeper-insight.ts';
import type { InsightDoorSpec } from './prompts/insight-door.ts';

export interface InsightDoorRetrieval {
  /** Library excerpts supplied to the prompt. */
  libraryK: number;
  /**
   * Register filter, or absent for the whole corpus.
   *
   * ⚠️ `registers` is a HARD FILTER, not a bias — a register nothing matches
   * yields no excerpts rather than falling back. It was measured and REJECTED
   * for Door 1 twice (2026-08-07): `devotional` collapsed it from two voices to
   * one on every fixture, and on Nahum swapped JFB-on-Nahum for
   * Spurgeon-on-a-cross-referenced-psalm.
   *
   * Parent design §7 wants Door 2 biased to exegetical + confessional, which
   * after A1 is 5 of 8 sources rather than the 3 that made the Door 1 filter
   * destructive. That is a much better bet and still only a bet: it is decided
   * by a free `--grounding-only` A/B scored on SOURCE SPREAD (plan Task 8), not
   * by this comment.
   */
  registers?: readonly string[];
}

export interface InsightDoorEntry {
  spec: InsightDoorSpec;
  retrieval: InsightDoorRetrieval;
}

/**
 * The doors, in the order the overlay offers them.
 *
 * `spec.id` is the `door` column value, constrained by migration 061's check to
 * exactly these two. Adding a third means widening that check as well.
 */
export const INSIGHT_DOORS: readonly InsightDoorEntry[] = [
  {
    spec: PASSAGE_DOOR_SPEC,
    retrieval: {
      // The door carries four sections and leans on named voices throughout, so
      // it takes study CHAT's library budget rather than insight's halved one.
      libraryK: 4,
      // No register filter — measured and rejected, see InsightDoorRetrieval.
    },
  },
  {
    spec: DEEPER_DOOR_SPEC,
    retrieval: {
      // Both values MEASURED, 2026-08-07, on free `--grounding-only` sweeps —
      // `b3-deeper-unsteered` vs `b3-deeper-steered` vs `b3-deeper-steered-k6`.
      //
      // Steering earns its place, unlike on Door 1. Unsteered, Psalm 27 comes
      // back `treasury×3, jfb×1` — three of four slots to one DEVOTIONAL source,
      // on the door whose hermeneutics and theology sections want exegetical and
      // confessional ones. Steered it is `jfb×1, geneva×1, clarke×2`. Across all
      // five fixtures the filter NEVER narrowed the distinct-source count, and
      // it put a confessional voice (Geneva) in the grounding of 5/5 rather than
      // 1/5. On Nahum it also drops Treasury, which reaches that book only
      // through a psalm cross-reference anchor — Spurgeon on a psalm, informing
      // a Nahum door.
      libraryK: 6,
      registers: ['exegetical', 'confessional'],
      // k=6 over k=4 adds a FOURTH distinct source on 3 of 5 fixtures and never
      // reduces the count. The honest caveat: on `deeper-romans-9` the two extra
      // slots both went to Clarke, taking it from 1/4 to 3/6 — the crowding the
      // plan said to watch for, Clarke having 23,797 chunks against Catena's
      // 2,966. Adopted anyway because it never costs a voice; revisit if a later
      // sweep shows Clarke taking the slate on more than one fixture.
    },
  },
];

/** The default when a request does not name a door — B2's clients send no `door`. */
export const DEFAULT_INSIGHT_DOOR_ID = PASSAGE_DOOR_SPEC.id;

/**
 * Resolve a door id, or `null` if it names no registered door.
 *
 * Null rather than a fallback, on purpose: an unrecognised id is a client bug or
 * a probe, and quietly serving Door 1 would let it write Door 1's prose under
 * whatever `door` value the caller invented — the exact corruption migration
 * 061 and the required-door cache signature exist to prevent.
 */
export function insightDoorById(id: string): InsightDoorEntry | null {
  return INSIGHT_DOORS.find((d) => d.spec.id === id) ?? null;
}
