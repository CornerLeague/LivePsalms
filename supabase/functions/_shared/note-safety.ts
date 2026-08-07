// supabase/functions/_shared/note-safety.ts
//
// THE GATE. One predicate, three call sites.
//
// `note_distillates.safety_class` is written asynchronously by a queue job, so
// it is a CACHE, not a promise. Every pipeline that puts note text in front of
// a model asks this module; none of them assumes an upstream guarantee. The
// reason is a race: `embed-note` is swept by pg_cron, so a note saved at 07:59
// may be unclassified when the 08:00 devotion runs. A guarantee that holds
// except under timing is not a guarantee, it is a default.
//
// ⚠️ UNCLASSIFIED IS WITHHELD, exactly as `risk` is. The failure modes are not
// symmetric:
//   · excluding a pending note costs a devotion that is slightly less current
//     — the note is minutes old, and tomorrow's devotion has it;
//   · including one costs precisely what this layer exists to prevent.
//
// ⚠️ THIS NEVER TOUCHES THE USER'S OWN READING. The note saves, renders, syncs
// and searches exactly as before. Withholding applies only to what the model is
// shown. Nothing is deleted, hidden, or flagged back to the reader as a problem
// with what they wrote.
//
// `lament` PASSES. It is recorded separately from `ok` only so the
// false-positive rate is countable — this app exists for people writing their
// worst days, and a gate that withheld lament would withhold the Psalter.

/** The three gate sites — kept here so the list is greppable from one place. */
export const NOTE_GATE_SITES = [
  '_shared/note-context.ts — Today\'s Lamp + smoke test',
  'lamplight-generate/monthly-reflection-context.ts — Waymarks',
  'lamplight-study/study-context.ts — study chat (included AND offered)',
] as const;

export type SafetyClass = 'ok' | 'lament' | 'risk';

export interface NoteSafetyRow {
  note_id?: string;
  /** NULL = the classification job has not run (or failed). */
  safety_class: SafetyClass | null;
}

/** The classes a model may be shown. Anything else — including nothing — is withheld. */
const GENERATABLE: ReadonlySet<string> = new Set<SafetyClass>(['ok', 'lament']);

/**
 * May this note's text be put in front of a model?
 *
 * Takes the row rather than the class so callers cannot accidentally pass
 * `undefined` and have it read as a legitimate value — a missing row and a
 * missing class are both explicit here.
 */
export function isWithheldFromGeneration(row: NoteSafetyRow | null | undefined): boolean {
  if (!row || row.safety_class == null) return true;
  return !GENERATABLE.has(row.safety_class);
}

/**
 * Split a set of notes into what a model may see and what it may not.
 *
 * Returns BOTH sides on purpose. The study path ranks before it fetches bodies,
 * so it has to know how many slots it lost — otherwise a withheld note silently
 * costs a note that would have been shown, and the reader gets a thinner answer
 * with no indication why. Callers that rank should over-fetch and top up from
 * `withheld.length`.
 */
export function partitionBySafety<T>(
  notes: readonly T[],
  rows: readonly NoteSafetyRow[],
  idOf: (note: T) => string,
): { kept: T[]; withheld: T[] } {
  const byId = new Map<string, NoteSafetyRow>();
  for (const r of rows) if (r.note_id) byId.set(r.note_id, r);

  const kept: T[] = [];
  const withheld: T[] = [];
  for (const n of notes) {
    (isWithheldFromGeneration(byId.get(idOf(n))) ? withheld : kept).push(n);
  }
  return { kept, withheld };
}
