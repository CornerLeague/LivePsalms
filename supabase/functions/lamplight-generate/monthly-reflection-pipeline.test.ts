import { describe, it, expect } from 'vitest';
import { runMonthlyReflectionPipeline, repairOffListVerses } from './monthly-reflection-pipeline';
import type { LLMAdapter, GenerateInput, GenerateOutput } from '../_shared/openai';
import type { ReflectionArtifact } from '../_shared/artifacts';
import type { MonthlyReflectionContext } from './prompts/monthly-reflection';
import type { EdgeSupabase } from './reflection-candidates';

// Returns each response in sequence; the last is repeated (so a validator-failing
// artifact is re-served on the stricter retry). generate() serves BOTH the sonnet
// artifact call and the haiku judge call, so a happy path passes [artifact, verdict].
function makeAdapter(responses: unknown[]): { llm: LLMAdapter; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  let i = 0;
  const llm: LLMAdapter = {
    async generate<U>(input: GenerateInput): Promise<GenerateOutput<U>> {
      calls.push(input);
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'gpt-5.6-terra', promptTokens: 10, completionTokens: 20 };
    },
    generateStream: (async () => { throw new Error('unused'); }) as unknown as LLMAdapter['generateStream'],
  };
  return { llm, calls };
}

function makeSupabaseMock(opts: {
  existing?: { id: string; body: unknown; model_used: string; prompt_version: string } | null;
  upsertedId?: string;
  upsertError?: { message: string } | null;
} = {}) {
  const existing = opts.existing ?? null;
  const upsertedId = opts.upsertedId ?? 'artifact-1';
  const upsertError = opts.upsertError ?? null;
  const upserts: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table !== 'lamplight_artifacts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({
            async maybeSingle() { return existing ? { data: existing, error: null } : { data: null, error: null }; },
            async single() { return existing ? { data: existing, error: null } : { data: null, error: { message: 'no row' } }; },
          }) }) }),
        }),
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return { select: () => ({ async single() {
            return upsertError ? { data: null, error: upsertError } : { data: { id: upsertedId }, error: null };
          } }) };
        },
      };
    },
  };
  return { supabase: supabase as unknown as EdgeSupabase, upserts };
}

// Exemplar-grade (§2.2): a 60+ word letter, one in-month marker citing an allowed verse.
// Must clear all 6 validators so the happy path reaches the judge.
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

describe('runMonthlyReflectionPipeline', () => {
  it('generates, judges, then UPSERTs — omitting saved_to_notes and updated_at (DESIGN DECISION 2)', async () => {
    const { llm, calls } = makeAdapter([ARTIFACT, { pass: true, reasons: [] }]);
    const { supabase, upserts } = makeSupabaseMock({ upsertedId: 'artifact-99' });
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: true, cached: false, artifactId: 'artifact-99', usage: { status: 'ok', model_used: 'gpt-5.6-terra', prompt_tokens: 10, completion_tokens: 20 } });
    // sonnet artifact call, then haiku judge call
    expect(calls[0].model).toBe('balanced');
    expect(calls[1].model).toBe('fast');
    expect(upserts).toHaveLength(1);
    const row = upserts[0];
    expect(row.type).toBe('reflection_recap');
    expect(row.period_key).toBe('2026-05');
    expect(row.prompt_version).toBe('monthly-reflection-v1');
    expect(row.source_note_ids).toEqual(['n1']);
    expect(row.source_verses).toEqual(['Ps 27:14']);
    // the two forbidden columns
    expect('saved_to_notes' in row).toBe(false);
    expect(row.updated_at).toBeUndefined();
  });

  it('returns the cached artifact without generating or upserting', async () => {
    const { llm, calls } = makeAdapter([ARTIFACT]);
    const { supabase, upserts } = makeSupabaseMock({ existing: { id: 'existing-1', body: {}, model_used: 'm', prompt_version: 'monthly-reflection-v1' } });
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: true, cached: true, artifactId: 'existing-1', usage: null });
    expect(calls).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it('returns no_notes when the context is null (empty month)', async () => {
    const { llm } = makeAdapter([ARTIFACT]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: null, userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: false, reason: 'no_notes', usage: null });
    expect(upserts).toHaveLength(0);
  });

  it('repairs an off-allowlist verse to null (§6.5) and excludes it from source_verses', async () => {
    const offList: ReflectionArtifact = { ...ARTIFACT, markers: [{ date: '2026-05-12', verse: 'Ps 23:1', phrase: 'the day the circling stopped' }] };
    const { llm } = makeAdapter([offList, { pass: true, reasons: [] }]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result.ok).toBe(true);
    const body = upserts[0].body as ReflectionArtifact;
    expect(body.markers[0].verse).toBeNull();
    expect(upserts[0].source_verses).toEqual([]);
  });

  it('returns validators_failed with an error usage row and does NOT upsert', async () => {
    const tooShort: ReflectionArtifact = { ...ARTIFACT, letter: 'Too short to pass the word floor.' };
    const { llm } = makeAdapter([tooShort]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result).toEqual({ ok: false, reason: 'validators_failed', usage: { status: 'error', model_used: 'gpt-5.6-terra', error_code: 'validators_failed' } });
    expect(upserts).toHaveLength(0);
  });

  it('content rules gate the letter BEFORE the judge: a prophetic line fails without consulting the judge', async () => {
    const prophetic: ReflectionArtifact = {
      ...ARTIFACT,
      letter: ARTIFACT.letter + ' God is telling you to stop waiting now and step into what he has prepared.',
    };
    const { llm, calls } = makeAdapter([prophetic]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('validators_failed');
    expect(upserts).toHaveLength(0);
    // every call was an artifact attempt on 'balanced' — the fast-tier judge never ran
    expect(calls.every((c) => c.model === 'balanced')).toBe(true);
  });

  it('a marker verse inside a contested range does NOT trip content rules (refs are excluded from the prose flatten)', async () => {
    const contestedMarker: ReflectionArtifact = {
      ...ARTIFACT,
      markers: [{ date: '2026-05-12', verse: 'Romans 9:16', phrase: 'the day the circling stopped' }],
    };
    const { llm } = makeAdapter([contestedMarker, { pass: true, reasons: [] }]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({
      llm, supabase,
      ctx: makeCtx({ allowedVerseRefs: new Set(['Romans 9:16']) }),
      userId: 'u1', periodKey: '2026-05',
    });

    expect(result.ok).toBe(true);
    expect(upserts).toHaveLength(1);
  });

  it('threads deps.classifier (Layer C) into content rules; its violations fail validation', async () => {
    const seen: string[] = [];
    const classifier = async (text: string) => {
      seen.push(text);
      return [{ family: 'banned' as const, rule: 'classifier:paraphrased prophetic claim', snippet: 'circling stopped' }];
    };
    const { llm, calls } = makeAdapter([ARTIFACT]);
    const { supabase, upserts } = makeSupabaseMock();
    const result = await runMonthlyReflectionPipeline({
      llm, classifier, supabase, ctx: makeCtx(), userId: 'u1', periodKey: '2026-05',
    });

    expect(result.ok).toBe(false);
    expect(upserts).toHaveLength(0);
    // classifier saw the prose flatten: title + letter + marker phrases
    expect(seen[0]).toContain('The Month You Stopped Waiting');
    expect(seen[0]).toContain('the day the circling stopped');
    // judge never consulted
    expect(calls.every((c) => c.model === 'balanced')).toBe(true);
  });

  it('repairOffListVerses nulls out only the verses outside the allowlist', () => {
    const repaired = repairOffListVerses(
      { ...ARTIFACT, markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'a' }, { date: '2026-05-13', verse: 'Ps 23:1', phrase: 'b' }] },
      new Set(['Ps 27:14']),
    );
    expect(repaired.markers[0].verse).toBe('Ps 27:14');
    expect(repaired.markers[1].verse).toBeNull();
  });
});
