import { describe, it, expect } from 'vitest';
import {
  validateShapeAndBounds,
  validateScriptureAllowlist,
  validateAnchoring,
  validateNoScorecard,
  validateWitnessedNotReopened,
  validateProvenance,
} from './reflection-validators';
import type { ReflectionArtifact } from './artifacts';

// The §2.2 gold exemplar — every validator must pass it (deletion-test direction A).
const EXEMPLAR: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling a decision you had been holding since March. On the twelfth the circling stopped - that entry doesn\'t argue with itself; it simply asks to be led, and then goes quiet. ' +
    'The middle of the month held a hard week. You know which one. You wrote through it rather than around it, and the writing held you. The stone stands; the details can rest. ' +
    'And a small thing you almost didn\'t record: the early walks, Psalm 27 open again and again. You kept returning without calling it returning. That thread is what this month was made of.',
  markers: [
    { date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' },
    { date: '2026-05-17', date_end: '2026-05-23', verse: 'Ps 34:18', phrase: 'a hard week, witnessed' },
    { date: '2026-05-27', verse: 'Ps 27:4', phrase: 'the walk you kept taking' },
  ],
};
const EXEMPLAR_ALLOWED = new Set(['Ps 27:14', 'Ps 34:18', 'Ps 27:4']);
const EXEMPLAR_NOTE_DAYS = new Set(['2026-05-12', '2026-05-19', '2026-05-27']);
const EXEMPLAR_NOTES = [
  { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision from March.' },
  { id: 'n2', day: '2026-05-19', text: 'This week has been so heavy I can barely write.' },
  { id: 'n3', day: '2026-05-27', text: 'Early walk again, the psalm open on my phone.' },
];

describe('validateShapeAndBounds', () => {
  it('passes the exemplar', () => {
    expect(validateShapeAndBounds(EXEMPLAR).ok).toBe(true);
  });
  it('fails when there are zero markers (MARKER_MIN)', () => {
    const bad = { ...EXEMPLAR, markers: [] };
    const r = validateShapeAndBounds(bad);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'marker_count')).toBe(true);
  });
  it('fails when there are more than six markers (MARKER_MAX)', () => {
    const bad = { ...EXEMPLAR, markers: Array(7).fill(EXEMPLAR.markers[0]) };
    expect(validateShapeAndBounds(bad).ok).toBe(false);
  });
  it('fails when the letter is under LETTER_WORD_MIN words', () => {
    const bad = { ...EXEMPLAR, letter: 'Too short a letter by far.' };
    const r = validateShapeAndBounds(bad);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'letter_word_bounds')).toBe(true);
  });
});

describe('validateScriptureAllowlist', () => {
  it('passes the exemplar (verses on the list; prose says "Psalm 27" narratively)', () => {
    expect(validateScriptureAllowlist(EXEMPLAR, { allowedVerseRefs: EXEMPLAR_ALLOWED }).ok).toBe(true);
  });
  it('fails a marker verse that is not on the candidate list', () => {
    const bad = { ...EXEMPLAR, markers: [{ date: '2026-05-12', verse: 'John 3:16', phrase: 'x' }] };
    const r = validateScriptureAllowlist(bad, { allowedVerseRefs: EXEMPLAR_ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'verse_off_list' && v.marker_index === 0)).toBe(true);
  });
  it('allows a null (abstained) marker verse', () => {
    const ok = { ...EXEMPLAR, markers: [{ date: '2026-05-12', verse: null, phrase: 'x' }] };
    expect(validateScriptureAllowlist(ok, { allowedVerseRefs: EXEMPLAR_ALLOWED }).ok).toBe(true);
  });
  // §6.4 deletion-test, BOTH directions:
  it('PERMITS a narrative book/chapter in prose ("Psalm 27")', () => {
    const a = { ...EXEMPLAR, letter: EXEMPLAR.letter }; // contains "Psalm 27 open again and again"
    expect(validateScriptureAllowlist(a, { allowedVerseRefs: EXEMPLAR_ALLOWED }).ok).toBe(true);
  });
  it('FORBIDS a verse-level citation in prose ("Ps 27:14")', () => {
    const bad = { ...EXEMPLAR, letter: EXEMPLAR.letter + ' As Ps 27:14 says, wait for the Lord.' };
    const r = validateScriptureAllowlist(bad, { allowedVerseRefs: EXEMPLAR_ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'prose_verse_citation')).toBe(true);
  });
});

describe('validateAnchoring', () => {
  const opts = { monthStart: '2026-05-01', monthEnd: '2026-05-31', allowedNoteDays: EXEMPLAR_NOTE_DAYS };
  it('passes the exemplar (every marker day/span touches a note day)', () => {
    expect(validateAnchoring(EXEMPLAR, opts).ok).toBe(true);
  });
  it('fails a marker dated outside the month', () => {
    const bad = { ...EXEMPLAR, markers: [{ date: '2026-06-02', verse: null, phrase: 'x' }] };
    const r = validateAnchoring(bad, opts);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'marker_out_of_month')).toBe(true);
  });
  it('fails a marker on a day with no source note (unanchored)', () => {
    const bad = { ...EXEMPLAR, markers: [{ date: '2026-05-03', verse: null, phrase: 'x' }] };
    const r = validateAnchoring(bad, opts);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'marker_unanchored')).toBe(true);
  });
});

describe('validateNoScorecard', () => {
  it('passes the exemplar prose', () => {
    expect(validateNoScorecard(EXEMPLAR.letter).ok).toBe(true);
  });
  // §6.4 deletion-test, BOTH directions:
  it('PERMITS a spelled-out date ("the twelfth")', () => {
    expect(validateNoScorecard('On the twelfth you stopped waiting.').ok).toBe(true);
  });
  it('FORBIDS an activity tally ("showed up 14 days")', () => {
    const r = validateNoScorecard('You showed up 14 days this month.');
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'scorecard')).toBe(true);
  });
  it('exempts a scripture chapter number ("Psalm 27")', () => {
    expect(validateNoScorecard('You returned to Psalm 27 without calling it returning.').ok).toBe(true);
  });
  it('forbids streak language', () => {
    expect(validateNoScorecard('Keep your streak alive.').ok).toBe(false);
  });
});

describe('validateWitnessedNotReopened', () => {
  it('passes the exemplar (namings, not quotes)', () => {
    expect(validateWitnessedNotReopened(EXEMPLAR, { notes: EXEMPLAR_NOTES }).ok).toBe(true);
  });
  it('fails when the letter copies an 8+ word run verbatim from a note', () => {
    const note = { id: 'n9', day: '2026-05-10', text: 'the darkness pressed in and I could not breathe at all tonight' };
    const bad = {
      ...EXEMPLAR,
      letter: EXEMPLAR.letter + ' the darkness pressed in and I could not breathe at all tonight.',
    };
    const r = validateWitnessedNotReopened(bad, { notes: [note] });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'verbatim_run')).toBe(true);
  });
});

describe('validateProvenance', () => {
  it('passes when source ids are non-empty and ⊆ the month notes', () => {
    expect(validateProvenance({ sourceNoteIds: ['n1', 'n3'], monthNoteIds: ['n1', 'n2', 'n3'] }).ok).toBe(true);
  });
  it('fails on empty source ids', () => {
    const r = validateProvenance({ sourceNoteIds: [], monthNoteIds: ['n1'] });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'provenance_empty')).toBe(true);
  });
  it('fails when a source id is not one of the month notes', () => {
    const r = validateProvenance({ sourceNoteIds: ['n1', 'nX'], monthNoteIds: ['n1', 'n2'] });
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.rule === 'provenance_out_of_month')).toBe(true);
  });
});
