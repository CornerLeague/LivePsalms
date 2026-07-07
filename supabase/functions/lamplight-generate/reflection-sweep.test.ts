import { describe, it, expect, vi } from 'vitest';
import { runReflectionSweep, CLAIM_LIMIT, type ReflectionJobRow } from './reflection-sweep';
import type { LLMAdapter, GenerateOutput } from '../_shared/anthropic';
import type { ReflectionArtifact } from '../_shared/artifacts';
import type { EdgeSupabase } from './reflection-candidates';

// Exemplar-grade artifact (§2.2) — clears all 6 deterministic validators so the happy
// path reaches (and passes) the register judge, mirroring monthly-reflection-pipeline.test.ts.
const ARTIFACT: ReflectionArtifact = {
  title: 'The Month You Stopped Waiting',
  letter:
    'You began May circling one decision, turning it over on the drive to work and again before sleep. ' +
    'On the twelfth something in you set it down — not because the answer arrived, but because the circling ' +
    'had done its work and you were ready to stop. The rest of the month you wrote less about it. The stone ' +
    'stands where you left it; the details can rest now.',
  markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
};

function makeAdapter(responses: unknown[]): LLMAdapter {
  let i = 0;
  return {
    async generate<U>(): Promise<GenerateOutput<U>> {
      const parsed = responses[Math.min(i, responses.length - 1)] as unknown as U;
      i++;
      return { parsed, modelUsed: 'claude-sonnet-4-6', promptTokens: 10, completionTokens: 20 };
    },
    generateStream: (async () => { throw new Error('unused'); }) as unknown as LLMAdapter['generateStream'],
  };
}

function job(over: Partial<ReflectionJobRow> = {}): ReflectionJobRow {
  return {
    id: 'job-1', user_id: 'u1', kind: 'monthly_reflection',
    payload: { period_key: '2026-05' }, attempts: 0,
    ...over,
  };
}

// Minimal EdgeSupabase double covering exactly the two tables the runner's own
// wiring touches directly: lamplight_artifacts (pre-check + upsert, inside the real
// pipeline) and lamplight_jobs (recordReflectionJobFailure's update / clearReflectionJob's
// delete). notes/candidates assembly is bypassed via the injected `buildContext` fake
// (see monthly-reflection-context.test.ts + reflection-candidates.test.ts for that layer
// in isolation), so this double never needs a `.from('notes')` branch.
function makeSupabase(opts: { existingArtifact?: { id: string } | null } = {}) {
  const existingArtifact = opts.existingArtifact ?? null;
  const jobUpdates: Array<Record<string, unknown>> = [];
  const jobDeletes: Array<Array<[string, unknown]>> = [];
  const upserts: Array<Record<string, unknown>> = [];

  const supabase = {
    from(table: string) {
      if (table === 'lamplight_artifacts') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({
              async maybeSingle() {
                return existingArtifact ? { data: existingArtifact, error: null } : { data: null, error: null };
              },
            }) }) }),
          }),
          upsert: (row: Record<string, unknown>) => {
            upserts.push(row);
            return { select: () => ({ async single() { return { data: { id: 'artifact-99' }, error: null }; } }) };
          },
        };
      }
      if (table === 'lamplight_jobs') {
        return {
          update: (row: Record<string, unknown>) => ({
            eq: async () => { jobUpdates.push(row); return { error: null }; },
          }),
          delete: () => {
            const trail: Array<[string, unknown]> = [];
            const mkEq = (depth: number): { eq: (c: string, v: unknown) => unknown } => ({
              eq: (c, v) => {
                trail.push([c, v]);
                if (depth > 1) return mkEq(depth - 1);
                jobDeletes.push(trail);
                return { then(res: (v: { error: null }) => void) { res({ error: null }); } };
              },
            });
            return mkEq(3);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase: supabase as unknown as EdgeSupabase, jobUpdates, jobDeletes, upserts };
}

function makeCtx() {
  return {
    periodKey: '2026-05',
    periodLabel: 'May 2026',
    monthStart: '2026-05-01',
    monthEnd: '2026-05-31',
    notes: [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }],
    candidates: [],
    allowedVerseRefs: new Set(['Ps 27:14']),
    allowedNoteDays: new Set(['2026-05-12']),
  };
}

describe('runReflectionSweep', () => {
  it('an empty claim is a no-op — no context built, no DB writes', async () => {
    const { supabase, jobUpdates, jobDeletes } = makeSupabase();
    const claim = vi.fn().mockResolvedValue([]);
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([ARTIFACT, { pass: true, reasons: [] }]),
      claim,
      embed: async () => [],
      loadTimezone: async () => null,
    });
    expect(outcomes).toEqual([]);
    expect(claim).toHaveBeenCalledWith(CLAIM_LIMIT);
    expect(jobUpdates).toHaveLength(0);
    expect(jobDeletes).toHaveLength(0);
  });

  it('success path: generates, upserts the artifact, then clears the job row (not a status update)', async () => {
    const { supabase, jobDeletes, jobUpdates, upserts } = makeSupabase();
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([ARTIFACT, { pass: true, reasons: [] }]),
      claim: async () => [job()],
      embed: async () => [],
      loadTimezone: async (uid) => { expect(uid).toBe('u1'); return 'America/New_York'; },
      buildContext: async (_s, args) => { expect(args).toMatchObject({ userId: 'u1', periodKey: '2026-05', timezone: 'America/New_York' }); return makeCtx(); },
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ jobId: 'job-1', userId: 'u1', periodKey: '2026-05' });
    expect(outcomes[0].result.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    // clearReflectionJob (delete), never a status='done' update — this job kind has no
    // markDone equivalent; delete IS the success disposal (mirrors index.ts's on-demand path).
    expect(jobDeletes).toEqual([[['user_id', 'u1'], ['kind', 'monthly_reflection'], ['payload->>period_key', '2026-05']]]);
    expect(jobUpdates).toHaveLength(0);
  });

  it('cache-hit success (existing artifact) also clears the job row', async () => {
    const { supabase, jobDeletes, upserts } = makeSupabase({ existingArtifact: { id: 'existing-1' } });
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([ARTIFACT]),
      claim: async () => [job()],
      embed: async () => [],
      loadTimezone: async () => null,
      buildContext: async () => makeCtx(),
    });
    expect(outcomes[0].result).toEqual({ ok: true, cached: true, artifactId: 'existing-1', usage: null });
    expect(upserts).toHaveLength(0); // never generated — the pre-check short-circuited
    expect(jobDeletes).toHaveLength(1);
  });

  it('no_notes failure (null context — empty month) records a ledger failure, does not clear', async () => {
    const { supabase, jobUpdates, jobDeletes } = makeSupabase();
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([ARTIFACT]),
      claim: async () => [job({ attempts: 1 })],
      embed: async () => [],
      loadTimezone: async () => null,
      buildContext: async () => null, // empty month
    });
    expect(outcomes[0].result).toEqual({ ok: false, reason: 'no_notes', usage: null });
    // recordReflectionJobFailure({attempts: 1}) → attempts becomes 2, still below RETRY_ATTEMPT_CAP (3).
    expect(jobUpdates).toEqual([{ status: 'failed', attempts: 2 }]);
    expect(jobDeletes).toHaveLength(0);
  });

  it('validators_failed failure records a ledger failure and defers at the attempt cap', async () => {
    const tooShort: ReflectionArtifact = { ...ARTIFACT, letter: 'Too short to pass the word floor.' };
    const { supabase, jobUpdates, jobDeletes } = makeSupabase();
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([tooShort]),
      claim: async () => [job({ attempts: 2 })], // this failure pushes attempts to 3 = RETRY_ATTEMPT_CAP → deferred
      embed: async () => [],
      loadTimezone: async () => null,
      buildContext: async () => makeCtx(),
    });
    expect(outcomes[0].result).toEqual({ ok: false, reason: 'validators_failed', usage: { status: 'error', model_used: 'claude-sonnet-4-6', error_code: 'validators_failed' } });
    expect(jobUpdates).toEqual([{ status: 'failed', attempts: 3 }]);
    expect(jobDeletes).toHaveLength(0);
  });

  it('a malformed job (no period_key in payload) is routed to the ledger without building context', async () => {
    const { supabase, jobUpdates } = makeSupabase();
    const buildContext = vi.fn();
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([ARTIFACT]),
      claim: async () => [job({ payload: {} })],
      embed: async () => [],
      loadTimezone: async () => null,
      buildContext,
    });
    expect(outcomes[0]).toMatchObject({ periodKey: '', result: { ok: false, reason: 'no_notes' } });
    expect(buildContext).not.toHaveBeenCalled();
    expect(jobUpdates).toEqual([{ status: 'failed', attempts: 1 }]);
  });

  it('processes multiple claimed jobs across different users independently', async () => {
    const { supabase, jobDeletes } = makeSupabase();
    // Each claimed job runs its own generateWithRetry (sonnet artifact call + haiku judge
    // call), so with 2 jobs the shared adapter needs 4 responses in sequence, not 2.
    const outcomes = await runReflectionSweep({
      supabase,
      llm: makeAdapter([ARTIFACT, { pass: true, reasons: [] }, ARTIFACT, { pass: true, reasons: [] }]),
      claim: async () => [job({ id: 'job-1', user_id: 'u1' }), job({ id: 'job-2', user_id: 'u2', payload: { period_key: '2026-06' } })],
      embed: async () => [],
      loadTimezone: async () => null,
      buildContext: async (_s, args) => ({ ...makeCtx(), periodKey: args.periodKey }),
    });
    expect(outcomes.map((o) => [o.jobId, o.userId, o.periodKey])).toEqual([
      ['job-1', 'u1', '2026-05'],
      ['job-2', 'u2', '2026-06'],
    ]);
    expect(jobDeletes).toHaveLength(2);
  });
});
