// Retry attempt-ledger for monthly_reflection jobs (§11). Pure state math + two thin DB
// helpers. `deferred` is terminal (failed AND attempts >= cap): Task 8's cohort SQL excludes
// deferred jobs from the scheduled sweep; clearReflectionJob is the on-demand mirror.

import type { EdgeSupabase } from '../lamplight-generate/reflection-candidates.ts';

export const RETRY_ATTEMPT_CAP = 3; // §17 — MUST match the client reflection-constants value.

export interface ReflectionJobState {
  status: 'failed';
  attempts: number;
  deferred: boolean;
}

export function nextReflectionJobState(job: { attempts: number }): ReflectionJobState {
  const attempts = job.attempts + 1;
  return { status: 'failed', attempts, deferred: attempts >= RETRY_ATTEMPT_CAP };
}

export function isReflectionJobDeferred(job: { status: string; attempts: number }): boolean {
  return job.status === 'failed' && job.attempts >= RETRY_ATTEMPT_CAP;
}

export async function recordReflectionJobFailure(
  supabase: EdgeSupabase,
  jobId: string,
  currentAttempts: number,
): Promise<ReflectionJobState> {
  const next = nextReflectionJobState({ attempts: currentAttempts });
  await supabase.from('lamplight_jobs').update({ status: next.status, attempts: next.attempts }).eq('id', jobId);
  return next;
}

export async function clearReflectionJob(
  supabase: EdgeSupabase,
  userId: string,
  periodKey: string,
): Promise<void> {
  await supabase
    .from('lamplight_jobs')
    .delete()
    .eq('user_id', userId)
    .eq('kind', 'monthly_reflection')
    .eq('payload->>period_key', periodKey);
}
