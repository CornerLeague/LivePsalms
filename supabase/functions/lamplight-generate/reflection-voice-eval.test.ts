import { describe, it, expect } from 'vitest';
import { runMonthlyReflectionPipeline } from './monthly-reflection-pipeline';
import type { LLMAdapter, GenerateInput, GenerateOutput } from '../_shared/anthropic';
import type { ReflectionArtifact } from '../_shared/artifacts';
import type { MonthlyReflectionContext } from './prompts/monthly-reflection';
import type { EdgeSupabase } from './reflection-candidates';
import {
  validateShapeAndBounds,
  validateScriptureAllowlist,
  validateAnchoring,
  validateNoScorecard,
  validateWitnessedNotReopened,
  validateProvenance,
} from '../_shared/reflection-validators';
import { MARKER_MIN, MARKER_MAX, LETTER_WORD_MIN, LETTER_WORD_MAX } from '../_shared/reflection-constants';

// ── Co-located test doubles (verbatim from monthly-reflection-pipeline.test.ts, Task 6) ──────────
function makeAdapter(responses: unknown[]): { llm: LLMAdapter; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  let i = 0;
  const llm: LLMAdapter = {
    async generate<U>(input: GenerateInput): Promise<GenerateOutput<U>> {
      calls.push(input);
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 10, completionTokens: 20 };
    },
    generateStream: (async () => { throw new Error('unused'); }) as unknown as LLMAdapter['generateStream'],
  };
  return { llm, calls };
}

function makeSupabaseMock(opts: { upsertedId?: string } = {}) {
  const upsertedId = opts.upsertedId ?? 'artifact-1';
  const upserts: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table !== 'lamplight_artifacts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({
            async maybeSingle() { return { data: null, error: null }; },
            async single() { return { data: null, error: { message: 'no row' } }; },
          }) }) }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return { select: () => ({ async single() { return { data: { id: upsertedId }, error: null }; } }) };
        },
      };
    },
  };
  return { supabase: supabase as unknown as EdgeSupabase, upserts };
}

// §2.2 exemplar (verbatim from Task 6): 60+ word letter, one in-month marker citing an allowed verse.
const ARTIFACT: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling one decision, turning it over on the drive to work and again before sleep. ' +
    'On the twelfth something in you set it down — not because the answer arrived, but because the circling ' +
    'had done its work and you were ready to stop. The rest of the month you wrote less about it. The stone ' +
    'stands where you left it; the details can rest now.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function makeCtx(over: Partial<MonthlyReflectionContext> = {}): MonthlyReflectionContext {
  return {
    periodKey: '2026-05',
    periodLabel: 'May 2026',
    monthStart: '2026-05-01',
    monthEnd: '2026-05-31',
    notes: [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }],
    candidates: [],
    allowedVerseRefs: new Set(['Ps 27:14']),
    allowedNoteDays: new Set(['2026-05-12']),
    ...over,
  };
}

// A month-neutral variant of the exemplar letter (same validator-clean register), for fixtures set
// in other months so the prose doesn't name the wrong month.
const NEUTRAL_LETTER =
  'You began the month circling one decision, turning it over on the drive to work and again before sleep. ' +
  'On the twelfth something in you set it down — not because the answer arrived, but because the circling ' +
  'had done its work and you were ready to stop. The rest of the month you wrote less about it. The stone ' +
  'stands where you left it; the details can rest now.';

// ── Fixtures: each artifact+ctx must clear all 6 validators + the judge (→ result.ok). ───────────
interface VoiceFixture { name: string; artifact: ReflectionArtifact; ctx: MonthlyReflectionContext; }

const FIXTURES: VoiceFixture[] = [
  {
    name: 'the §2.2 exemplar (fixture #1)',
    artifact: ARTIFACT,
    ctx: makeCtx(),
  },
  {
    name: 'a different month (August), same reflective register',
    artifact: {
      title: 'The Month You Stopped Waiting',
      letter: NEUTRAL_LETTER,
      markers: [{ date: '2026-08-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
    },
    ctx: makeCtx({
      periodKey: '2026-08', periodLabel: 'August 2026',
      monthStart: '2026-08-01', monthEnd: '2026-08-31',
      notes: [{ id: 'n1', day: '2026-08-12', text: 'I keep circling this decision.' }],
      allowedNoteDays: new Set(['2026-08-12']),
    }),
  },
  {
    name: 'an abstained marker (verse: null) — no citation forced',
    artifact: {
      ...ARTIFACT,
      markers: [{ date: '2026-05-12', verse: null, phrase: 'the day the circling stopped' }],
    },
    ctx: makeCtx(),
  },
  {
    name: 'a marker that spans several days (date_end)',
    artifact: {
      ...ARTIFACT,
      markers: [{ date: '2026-05-12', date_end: '2026-05-15', verse: 'Ps 27:14', phrase: 'the days the circling slowed and stopped' }],
    },
    ctx: makeCtx({
      notes: [
        { id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' },
        { id: 'n2', day: '2026-05-15', text: 'Quieter today. The loop is losing its grip.' },
      ],
      allowedNoteDays: new Set(['2026-05-12', '2026-05-15']),
    }),
  },
  {
    name: 'a heavier month in a plainer register (grief, single marker)',
    artifact: {
      title: 'The Month the Waiting Room Was Quiet',
      letter:
        'September opened in a waiting room, in the particular quiet that arrives when the ordinary noise of a day ' +
        'stops mattering all at once. You did not have words for it and you did not go looking for any. What you ' +
        'reached for instead was an old and stubborn certainty — that there is a shelter which does not depend on ' +
        'the news being good. You sat down inside it and let the long afternoon be long.',
      markers: [{ date: '2026-09-08', verse: 'Ps 46:1', phrase: 'the quiet that fell in the waiting room' }],
    },
    ctx: makeCtx({
      periodKey: '2026-09', periodLabel: 'September 2026',
      monthStart: '2026-09-01', monthEnd: '2026-09-30',
      notes: [{ id: 'n1', day: '2026-09-08', text: 'The results came back and the waiting room went very still.' }],
      allowedVerseRefs: new Set(['Ps 46:1']),
      allowedNoteDays: new Set(['2026-09-08']),
    }),
  },
  {
    name: 'an ordinary, uneventful month (rest, single marker)',
    artifact: {
      title: 'The Month Nothing Needed Fixing',
      letter:
        'February asked very little of you, and for once you let that be enough. There was a day in the middle of ' +
        'it that held nothing worth reporting — no crisis and no triumph, only the ordinary work of being alive and ' +
        'awake to it. You noticed, almost in passing, that you were not restless. Something in you had stopped ' +
        'needing the day to prove itself, and had finally learned to rest.',
      markers: [{ date: '2026-02-17', verse: 'Ps 131:2', phrase: 'a soul quieted like a weaned child' }],
    },
    ctx: makeCtx({
      periodKey: '2026-02', periodLabel: 'February 2026',
      monthStart: '2026-02-01', monthEnd: '2026-02-28',
      notes: [{ id: 'n1', day: '2026-02-17', text: 'Nothing happened today and I was grateful for it.' }],
      allowedVerseRefs: new Set(['Ps 131:2']),
      allowedNoteDays: new Set(['2026-02-17']),
    }),
  },
  {
    name: 'two moments marked in one month (multi-marker)',
    artifact: {
      title: 'The Month That Turned Twice',
      letter:
        'March had two hinges in it. Early on there was a hard conversation you had put off for a year, and when it ' +
        'finally came it was smaller than the dread had promised. Then, near the end, an ordinary evening when nothing ' +
        'was required of you and you noticed you felt light. You did not manufacture either one. They simply arrived, ' +
        'a week and a half apart, and you were awake enough to catch them both.',
      markers: [
        { date: '2026-03-06', verse: 'Ps 27:14', phrase: 'the conversation that was smaller than the dread' },
        { date: '2026-03-19', verse: 'Ps 16:11', phrase: 'an ordinary evening that came out light' },
      ],
    },
    ctx: makeCtx({
      periodKey: '2026-03', periodLabel: 'March 2026',
      monthStart: '2026-03-01', monthEnd: '2026-03-31',
      notes: [
        { id: 'n1', day: '2026-03-06', text: 'Finally had the talk. Not as bad as I feared.' },
        { id: 'n2', day: '2026-03-19', text: 'Nice quiet evening. Felt oddly light.' },
      ],
      allowedVerseRefs: new Set(['Ps 27:14', 'Ps 16:11']),
      allowedNoteDays: new Set(['2026-03-06', '2026-03-19']),
    }),
  },
];

describe('reflection voice eval (Tier 3, offline, non-gating — guardrails only, never prose)', () => {
  for (const fx of FIXTURES) {
    it(`upserts a guardrail-clean artifact for: ${fx.name}`, async () => {
      const { llm, calls } = makeAdapter([fx.artifact, { pass: true, reasons: [] }]);
      const { supabase, upserts } = makeSupabaseMock({ upsertedId: 'x' });
      const result = await runMonthlyReflectionPipeline({
        llm, supabase, ctx: fx.ctx, userId: 'u', periodKey: fx.ctx.periodKey,
      });

      // The pipeline upserts ONLY when all six validators AND the judge pass — so result.ok is
      // itself the guardrail gate. (Voice drift is a warning, not a failure: we assert structure only.)
      expect(result.ok).toBe(true);
      expect(calls[1].model).toBe('haiku'); // the judge was consulted

      const body = upserts[0].body as ReflectionArtifact;
      expect(body.markers.length).toBeGreaterThanOrEqual(MARKER_MIN);
      expect(body.markers.length).toBeLessThanOrEqual(MARKER_MAX);
      const words = body.letter.trim().split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(LETTER_WORD_MIN);
      expect(words).toBeLessThanOrEqual(LETTER_WORD_MAX);
      for (const m of body.markers) {
        if (m.verse !== null) expect(fx.ctx.allowedVerseRefs.has(m.verse)).toBe(true);
        expect(m.date >= fx.ctx.monthStart && m.date <= fx.ctx.monthEnd).toBe(true);
        if (m.date_end) {
          expect(m.date_end >= fx.ctx.monthStart && m.date_end <= fx.ctx.monthEnd).toBe(true);
        }
      }
    });
  }

  it('all six deterministic validators pass on the §2.2 exemplar (fixture #1)', () => {
    const { artifact, ctx } = FIXTURES[0];
    expect(validateShapeAndBounds(artifact).ok).toBe(true);
    expect(validateScriptureAllowlist(artifact, { allowedVerseRefs: ctx.allowedVerseRefs }).ok).toBe(true);
    expect(
      validateAnchoring(artifact, {
        monthStart: ctx.monthStart, monthEnd: ctx.monthEnd, allowedNoteDays: ctx.allowedNoteDays,
      }).ok,
    ).toBe(true);
    expect(validateNoScorecard(artifact.letter).ok).toBe(true);
    expect(validateWitnessedNotReopened(artifact, { notes: ctx.notes.map((n) => ({ text: n.text })) }).ok).toBe(true);
    expect(
      validateProvenance({
        sourceNoteIds: ctx.notes.map((n) => n.id),
        monthNoteIds: ctx.notes.map((n) => n.id),
      }).ok,
    ).toBe(true);
  });
});
