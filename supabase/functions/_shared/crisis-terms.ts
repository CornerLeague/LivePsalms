// supabase/functions/_shared/crisis-terms.ts
//
// Stage one of two. Sits alongside BANNED_PHRASES / CONTESTED_PASSAGES /
// TRADITION_TERMS in voice.ts's tradition of keeping lists as reviewable
// content rather than buried code.
//
// ⚠️ THIS DECIDES NOTHING, AND IT DOES NOT GATE THE CLASSIFIER.
//
// The plan originally had it gate — hits go to the model, misses are skipped —
// and the corpus disproved that on the first run. `risk-preparation` contains
// NO crisis phrase at all: affairs put in order, a possession given away, a
// sudden calm. The quietest presentation, among the most concerning, and
// invisible to any phrase list. Measured: 2 of 3 true positives hit.
//
// Adding "preparation" phrases would not fix it — sorting paperwork and giving
// someone a guitar are ordinary journalling, and a list matching them fires
// forever without closing the gap.
//
// So EVERY note goes to the classifier, whose entire job is the
// lament-versus-risk distinction a phrase list cannot make. This module keeps
// two narrower jobs:
//   1. record `prefilter_hit`, so the list's precision stays measurable;
//   2. serve as a DETERMINISTIC FALLBACK — if the classifier is unavailable, a
//      hit is enough to withhold on its own, so the model path failing does not
//      open the door.
//
// The reason that separation is load-bearing: the phrases people use in genuine
// crisis are the same phrases people use in grief, burnout and the Psalter.
//   "I don't want to be here"    → grief, in a world without her
//   "I can't keep doing this"    → a job
//   "I wish I'd never been born" → Job 3
// A list that tried to resolve those would either miss real risk or meet
// mourners with a resource card. So it does not try.
//
// Since it no longer gates, a miss costs nothing in the normal path — the
// classifier sees the note regardless. A miss matters only in the fallback
// path, when the model is unavailable. Tune for recall anyway; that is the
// direction where being wrong is expensive.

/**
 * Recall-tuned patterns. Reviewed as content.
 *
 * Word-boundary anchored, and where a term has a common innocent use
 * ("killed the engine", "dying to see you", "dying to self") the pattern
 * carries the qualifier that separates them — not to make a judgement, but so
 * the prefilter's own hit rate stays informative.
 */
export const CRISIS_PREFILTER_TERMS: readonly RegExp[] = [
  // Explicit, self-directed.
  /\bend(ing)?\s+(my|it)\s+(own\s+)?life\b/,
  /\bkill(ing)?\s+myself\b/,
  /\btake\s+my\s+(own\s+)?life\b/,
  /\bsuicid(e|al)\b/,
  /\bwant\s+to\s+die\b/,
  /\bbetter\s+off\s+dead\b/,

  // Burden framing — quieter, and more common than the explicit statement.
  /\beveryone\s+(would\s+be|is)\s+better\s+off\s+without\s+me\b/,
  /\bburden\s+to\s+everyone\b/,

  // Not-waking / not-continuing, aimed at self.
  /\b(don'?t|do\s+not)\s+want\s+to\s+wake\s+up\b/,
  /\bnot\s+be\s+here\s+any\s*more\b/,
  /\bcan'?t\s+go\s+on\s+any\s*more\b/,

  // Self-harm.
  /\bhurt(ing)?\s+myself\b/,
  /\bharm(ing)?\s+myself\b/,
  /\bcut(ting)?\s+myself\b/,

  // Means-seeking, kept general on purpose.
  /\bhow\s+(much|many)\s+.{0,24}\b(would|to)\s+(kill|be\s+enough)\b/,
];

/** Collapse whitespace and case so a match is not defeated by a line break. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Does this note warrant a classifier call?
 *
 * `true` means "look at this", never "this is a crisis". Nothing downstream may
 * read it as a verdict — `note_distillates.prefilter_hit` records it purely so
 * the list's precision is measurable later.
 */
export function prefilterHits(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return CRISIS_PREFILTER_TERMS.some((re) => re.test(t));
}
