// Sweep-mode runner for `monthly_reflection` jobs (final-review fix — job-queue sweep).
// Mirrors embed-note's claimAndRun/processJobs split (_shared/process-job.ts): the DB-touching
// wiring lives in index.ts (thin), the claimed-jobs loop lives here so it is vitest-testable
// with mocks, matching monthly-reflection-pipeline.test.ts's mock idioms.
//
// Trust model (mirrors embed-note's sweep branch exactly): JWT verification stays on at the
// platform level for this function; a `{sweep: true}` body is only ever reached by whoever
// holds a valid JWT for the deployment — in production that's the service_role JWT pg_cron
// reads from Supabase Vault (046's cron job). The handler does not additionally inspect the
// caller's identity for the sweep branch, same as embed-note's index.ts (see its header
// comment). userId and periodKey for the actual generation are read from the CLAIMED JOB ROW
// (claim_lamplight_reflection_jobs only returns rows already committed to the DB by the 046
// cron's INSERT), never from request headers or body — so this branch cannot be used to
// generate a reflection for an arbitrary user via a spoofed payload.

import type { LLMAdapter } from '../_shared/anthropic.ts';
import { buildMonthlyReflectionContext } from './monthly-reflection-context.ts';
import type { MonthlyReflectionContext } from './prompts/monthly-reflection.ts';
import { runMonthlyReflectionPipeline, type MonthlyReflectionPipelineResult } from './monthly-reflection-pipeline.ts';
import { recordReflectionJobFailure, clearReflectionJob } from '../_shared/reflection-jobs.ts';
import type { EdgeSupabase } from './reflection-candidates.ts';

// CLAIM_LIMIT mirrors embed-note's CLAIM_LIMIT (index.ts) — max jobs drained per invocation,
// keeping a single sweep call well under typical Edge Function time limits.
export const CLAIM_LIMIT = 5;

export interface ReflectionJobRow {
  id: string;
  user_id: string;
  kind: string;
  payload: { period_key?: string };
  attempts: number;
}

export type ClaimReflectionJobsFn = (limit: number) => Promise<ReflectionJobRow[]>;

export interface ReflectionSweepDeps {
  supabase: EdgeSupabase;
  llm: LLMAdapter;
  claim: ClaimReflectionJobsFn;
  /** Real embedQuery(text, voyageDeps); injected so tests never touch Voyage. */
  embed: (text: string) => Promise<number[]>;
  /** Reads lamplight_settings.timezone for the job's user_id. Injected for tests. */
  loadTimezone: (userId: string) => Promise<string | null>;
  /**
   * Defaults to the real buildMonthlyReflectionContext (production wiring — index.ts never
   * overrides this). Tests inject a fake so the sweep LOOP is exercised without needing a
   * full multi-table supabase mock for notes/candidates — that assembly is already covered
   * by monthly-reflection-context.test.ts and reflection-candidates.test.ts in isolation.
   */
  buildContext?: (
    supabase: EdgeSupabase,
    args: { userId: string; periodKey: string; timezone: string | null; embed: (text: string) => Promise<number[]> },
  ) => Promise<MonthlyReflectionContext | null>;
}

export interface ReflectionSweepJobOutcome {
  jobId: string;
  userId: string;
  periodKey: string;
  result: MonthlyReflectionPipelineResult;
}

// Claims up to `limit` queued monthly_reflection jobs via the RPC and runs each to
// completion, disposing of the job row per outcome:
//   - ok (fresh success OR cache hit) → clearReflectionJob (the SAME disposal the on-demand
//     path in index.ts uses for a fresh success; a cache hit here means a concurrent path
//     already finished the period, so clearing is equally correct — there is nothing left
//     to retry).
//   - not ok (no_notes / validators_failed) → recordReflectionJobFailure (attempt-ledger
//     increment; terminal at RETRY_ATTEMPT_CAP, mirroring the daily/embedding sweep's retry
//     semantics — Task 10's ledger + the claim RPC are load-bearing here per spec §11).
// A claim returning zero rows is a no-op — matches embed-note's claimAndRun for an empty queue.
export async function runReflectionSweep(deps: ReflectionSweepDeps): Promise<ReflectionSweepJobOutcome[]> {
  const jobs = await deps.claim(CLAIM_LIMIT);
  const outcomes: ReflectionSweepJobOutcome[] = [];

  for (const job of jobs) {
    const userId = job.user_id;
    const periodKey = job.payload?.period_key ?? '';

    // Malformed payload (should be unreachable — the 046 enqueue always sets period_key) is
    // a permanent failure, not a transient one: still routes through the same ledger so it
    // eventually defers rather than looping forever.
    if (!periodKey) {
      await recordReflectionJobFailure(deps.supabase, job.id, job.attempts);
      outcomes.push({
        jobId: job.id, userId, periodKey,
        result: { ok: false, reason: 'no_notes', usage: null },
      });
      continue;
    }

    const timezone = await deps.loadTimezone(userId);
    const buildContext = deps.buildContext ?? buildMonthlyReflectionContext;
    const ctx = await buildContext(deps.supabase, {
      userId, periodKey, timezone, embed: deps.embed,
    });
    const result = await runMonthlyReflectionPipeline({
      llm: deps.llm, supabase: deps.supabase, ctx, userId, periodKey,
    });

    if (result.ok) {
      await clearReflectionJob(deps.supabase, userId, periodKey);
    } else {
      await recordReflectionJobFailure(deps.supabase, job.id, job.attempts);
    }
    outcomes.push({ jobId: job.id, userId, periodKey, result });
  }

  return outcomes;
}

export async function claimReflectionJobs(supabase: EdgeSupabase, limit: number): Promise<ReflectionJobRow[]> {
  const { data, error } = await supabase.rpc('claim_lamplight_reflection_jobs', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ReflectionJobRow[];
}
