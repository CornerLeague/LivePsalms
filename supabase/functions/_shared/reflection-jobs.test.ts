import { describe, it, expect } from 'vitest';
import {
  nextReflectionJobState,
  isReflectionJobDeferred,
  recordReflectionJobFailure,
  clearReflectionJob,
  RETRY_ATTEMPT_CAP,
} from './reflection-jobs';

describe('nextReflectionJobState (attempt ledger)', () => {
  it('increments attempts and always marks failed', () => {
    expect(nextReflectionJobState({ attempts: 0 })).toEqual({ status: 'failed', attempts: 1, deferred: false });
  });
  // Deferred-boundary deletion-test, both sides of the cap:
  it('does NOT defer when the resulting attempts is 2 (below the cap)', () => {
    expect(nextReflectionJobState({ attempts: 1 })).toEqual({ status: 'failed', attempts: 2, deferred: false });
  });
  it('DOES defer when the resulting attempts reaches 3 (the cap)', () => {
    expect(nextReflectionJobState({ attempts: 2 })).toEqual({ status: 'failed', attempts: 3, deferred: true });
  });
});

describe('isReflectionJobDeferred', () => {
  it('is false below the cap and for any non-failed status', () => {
    expect(isReflectionJobDeferred({ status: 'failed', attempts: 2 })).toBe(false);
    expect(isReflectionJobDeferred({ status: 'queued', attempts: 9 })).toBe(false);
  });
  it('is true only for a failed job at or above the cap', () => {
    expect(isReflectionJobDeferred({ status: 'failed', attempts: RETRY_ATTEMPT_CAP })).toBe(true);
    expect(isReflectionJobDeferred({ status: 'failed', attempts: 4 })).toBe(true);
  });
});

describe('thin DB helpers', () => {
  it('recordReflectionJobFailure writes the incremented failed state and returns it', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = { from: () => ({ update: (row: Record<string, unknown>) => ({ eq: async () => { updates.push(row); return { error: null }; } }) }) } as never;
    const next = await recordReflectionJobFailure(supabase, 'job-1', 2);
    expect(next).toEqual({ status: 'failed', attempts: 3, deferred: true });
    expect(updates[0]).toEqual({ status: 'failed', attempts: 3 });
  });

  it('clearReflectionJob deletes the (user, kind, month) row', async () => {
    const eqs: Array<[string, unknown]> = [];
    const term = { then(res: (v: { error: null }) => void) { res({ error: null }); } };
    const mkEq = (depth: number): { eq: (c: string, v: unknown) => unknown } => ({
      eq: (c, v) => { eqs.push([c, v]); return depth > 1 ? mkEq(depth - 1) : term; },
    });
    const supabase = { from: () => ({ delete: () => mkEq(3) }) } as never;
    await clearReflectionJob(supabase, 'u1', '2026-05');
    expect(eqs).toEqual([['user_id', 'u1'], ['kind', 'monthly_reflection'], ['payload->>period_key', '2026-05']]);
  });
});
