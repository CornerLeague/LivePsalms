// Deterministic validators for Waymarks monthly/yearly reflections. Pure
// functions, no I/O — the house style of _shared/validators.ts. Each returns
// { ok, violations }. Sibling to the daily-devotion validators, not an overload.
//
// The §6.4 nuances are load-bearing: validator 2 forbids verse-level CITATIONS
// in prose but permits narrative book/chapter; validator 4 forbids activity
// TALLIES but exempts scripture chapter numbers and spelled-out dates. Both are
// deletion-tested in both directions against the §2.2 exemplar.

import type { ReflectionArtifact } from './artifacts.ts';
import {
  MARKER_MIN,
  MARKER_MAX,
  LETTER_WORD_MIN,
  LETTER_WORD_MAX,
  VERBATIM_RUN_MAX_WORDS,
} from './reflection-constants.ts';

export type ReflectionValidatorRule =
  | 'marker_count'
  | 'letter_word_bounds'
  | 'verse_off_list'
  | 'prose_verse_citation'
  | 'marker_out_of_month'
  | 'marker_unanchored'
  | 'scorecard'
  | 'verbatim_run'
  | 'provenance_empty'
  | 'provenance_out_of_month';

export interface ReflectionViolation {
  rule: ReflectionValidatorRule;
  detail: string;
  marker_index?: number;
}

export interface ReflectionCheckResult {
  ok: boolean;
  violations: ReflectionViolation[];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Lowercased word tokens with punctuation stripped (Unicode-aware).
function wordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// ── Validator 1: shape + bounds (§6.2.1) ──────────────────────────────────────
export function validateShapeAndBounds(artifact: ReflectionArtifact): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  const n = artifact.markers.length;
  if (n < MARKER_MIN || n > MARKER_MAX) {
    violations.push({ rule: 'marker_count', detail: `${n} markers, expected ${MARKER_MIN}–${MARKER_MAX}` });
  }
  const words = wordCount(artifact.letter);
  if (words < LETTER_WORD_MIN || words > LETTER_WORD_MAX) {
    violations.push({ rule: 'letter_word_bounds', detail: `${words} words, expected ${LETTER_WORD_MIN}–${LETTER_WORD_MAX}` });
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 2: scripture allowlist + no verse-level citation in prose (§6.2.2, §6.4) ──
// A verse-level citation is `Book Chapter:Verse` (the colon+verse is the tell):
// "Ps 27:14", "1 Corinthians 11:3", "John 3:16-18" match; "Psalm 27" does NOT.
const PROSE_VERSE_CITATION_RE = /\b(?:[1-3]\s)?[A-Z][a-zA-Z]*\.?\s\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?\b/;

export function validateScriptureAllowlist(
  artifact: ReflectionArtifact,
  opts: { allowedVerseRefs: Set<string> },
): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  artifact.markers.forEach((m, i) => {
    if (m.verse !== null && !opts.allowedVerseRefs.has(m.verse)) {
      violations.push({ rule: 'verse_off_list', detail: `marker verse "${m.verse}" is not a candidate`, marker_index: i });
    }
  });
  if (PROSE_VERSE_CITATION_RE.test(artifact.letter)) {
    const hit = artifact.letter.match(PROSE_VERSE_CITATION_RE)?.[0] ?? '';
    violations.push({ rule: 'prose_verse_citation', detail: `verse-level citation "${hit}" in prose (use markers)` });
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 3: anchoring (§6.2.3) ───────────────────────────────────────────
// Each marker's date/span lies inside the month AND touches ≥1 source-note day.
export function validateAnchoring(
  artifact: ReflectionArtifact,
  opts: { monthStart: string; monthEnd: string; allowedNoteDays: Set<string> },
): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  const days = [...opts.allowedNoteDays];
  artifact.markers.forEach((m, i) => {
    const end = m.date_end ?? m.date;
    const inMonth = m.date >= opts.monthStart && end <= opts.monthEnd && end >= m.date;
    if (!inMonth) {
      violations.push({ rule: 'marker_out_of_month', detail: `marker ${m.date}${m.date_end ? `..${m.date_end}` : ''} is outside ${opts.monthStart}..${opts.monthEnd}`, marker_index: i });
      return;
    }
    const anchored = days.some((d) => d >= m.date && d <= end);
    if (!anchored) {
      violations.push({ rule: 'marker_unanchored', detail: `marker ${m.date}${m.date_end ? `..${m.date_end}` : ''} touches no source-note day`, marker_index: i });
    }
  });
  return { ok: violations.length === 0, violations };
}

// ── Validator 4: no-scorecard lint (§6.2.4, §6.4) ─────────────────────────────
// Forbids tallies of the reader's activity. A digit adjacent to an activity noun
// ("14 days", "3 entries", "showed up 5 times") is a tally; a scripture chapter
// number ("Psalm 27") and a spelled-out date ("the twelfth") are not.
const ACTIVITY_NOUNS = 'times|days?|entries|entry|notes?|nights?|weeks?|mornings?|walks?|journals?|journaled|wrote|showed\\s+up';
const SCORECARD_RES: RegExp[] = [
  new RegExp(`\\b\\d+\\s+(?:${ACTIVITY_NOUNS})\\b`, 'i'),   // "14 days", "3 entries"
  new RegExp(`\\b(?:${ACTIVITY_NOUNS})\\s+\\d+\\b`, 'i'),   // "showed up 14", "wrote 20"
  /\b\d+\s+out\s+of\b/i,                                     // "12 out of 30"
  /\b\d+[-\s]?day\s+streak\b/i,
  /\bstreak\b/i,
];

export function validateNoScorecard(letter: string): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  for (const re of SCORECARD_RES) {
    const m = letter.match(re);
    if (m) {
      violations.push({ rule: 'scorecard', detail: `activity tally "${m[0]}"` });
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 5: witnessed-not-reopened lint (§6.2.5) ─────────────────────────
// No verbatim run of VERBATIM_RUN_MAX_WORDS+ words copied from any note into the
// letter or any marker phrase.
export function validateWitnessedNotReopened(
  artifact: ReflectionArtifact,
  opts: { notes: Array<{ text: string }> },
): ReflectionCheckResult {
  const n = VERBATIM_RUN_MAX_WORDS;
  const noteRuns = new Set<string>();
  for (const note of opts.notes) {
    const toks = wordTokens(note.text);
    for (let i = 0; i + n <= toks.length; i++) {
      noteRuns.add(toks.slice(i, i + n).join(' '));
    }
  }
  const violations: ReflectionViolation[] = [];
  const targets = [artifact.letter, ...artifact.markers.map((m) => m.phrase)];
  outer: for (const target of targets) {
    const toks = wordTokens(target);
    for (let i = 0; i + n <= toks.length; i++) {
      const run = toks.slice(i, i + n).join(' ');
      if (noteRuns.has(run)) {
        violations.push({ rule: 'verbatim_run', detail: `verbatim ${n}-word run "${run}"` });
        break outer;
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Validator 6: provenance (§6.2.6) ──────────────────────────────────────────
export function validateProvenance(
  opts: { sourceNoteIds: string[]; monthNoteIds: string[] },
): ReflectionCheckResult {
  const violations: ReflectionViolation[] = [];
  if (opts.sourceNoteIds.length === 0) {
    violations.push({ rule: 'provenance_empty', detail: 'source_note_ids is empty' });
  }
  const monthSet = new Set(opts.monthNoteIds);
  for (const id of opts.sourceNoteIds) {
    if (!monthSet.has(id)) {
      violations.push({ rule: 'provenance_out_of_month', detail: `source note "${id}" is not in the month` });
    }
  }
  return { ok: violations.length === 0, violations };
}
