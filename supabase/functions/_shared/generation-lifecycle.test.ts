import { describe, it, expect } from 'vitest';
import { runGeneration, type GenerationLifecycleDeps } from './generation-lifecycle';
import type { UsageRow } from './usage';

function makeDeps(over: Partial<GenerationLifecycleDeps> = {}): {
  deps: GenerationLifecycleDeps;
  recorded: UsageRow[];
} {
  const recorded: UsageRow[] = [];
  const deps: GenerationLifecycleDeps = {
    checkQuota: async () => ({ ok: true }),
    recordUsage: async (row) => {
      recorded.push(row);
    },
    classifyError: () => 'unknown',
    ...over,
  };
  return { deps, recorded };
}

const meta = { userId: 'u1', artifactKind: 'daily_devotion' };

describe('runGeneration', () => {
  it('quota blocked: returns 429, records an error row with model:null, does NOT run body', async () => {
    const { deps, recorded } = makeDeps({
      checkQuota: async () => ({ ok: false, reason: 'user_quota' }),
    });
    let bodyRan = false;
    const out = await runGeneration(deps, meta, async () => {
      bodyRan = true;
      return { response: { ok: true }, usage: null };
    });
    expect(bodyRan).toBe(false);
    expect(out.status).toBe(429);
    expect(out.response).toEqual({ error: 'quota_exceeded', reason: 'user_quota' });
    await Promise.resolve(); // drain fire-and-forget record
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      user_id: 'u1',
      artifact_kind: 'daily_devotion',
      model: null,
      tokens_in: 0,
      tokens_out: 0,
      status: 'error',
      error_code: 'quota_exceeded',
    });
  });

  it('success with usage: returns 200 with body response and records the merged usage row', async () => {
    const { deps, recorded } = makeDeps();
    const out = await runGeneration(deps, meta, async () => ({
      response: { ok: true, artifact_id: 'a1' },
      usage: { model: 'gpt-5.6-terra', tokens_in: 10, tokens_out: 20, status: 'ok' },
    }));
    expect(out.status).toBe(200);
    expect(out.response).toEqual({ ok: true, artifact_id: 'a1' });
    await Promise.resolve();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      user_id: 'u1',
      artifact_kind: 'daily_devotion',
      model: 'gpt-5.6-terra',
      tokens_in: 10,
      tokens_out: 20,
      status: 'ok',
    });
  });

  it('success with usage:null: returns 200 and records NOTHING (cache hit / no_notes)', async () => {
    const { deps, recorded } = makeDeps();
    const out = await runGeneration(deps, meta, async () => ({
      response: { ok: true, cached: true },
      usage: null,
    }));
    expect(out.status).toBe(200);
    await Promise.resolve();
    expect(recorded).toHaveLength(0);
  });

  it('body throws: records an error row with classifyError(err) and rethrows', async () => {
    const { deps, recorded } = makeDeps({
      classifyError: () => 'no_embedding',
    });
    const boom = new Error('embedding missing');
    await expect(
      runGeneration(deps, meta, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    await Promise.resolve();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      user_id: 'u1',
      artifact_kind: 'daily_devotion',
      model: null,
      tokens_in: 0,
      tokens_out: 0,
      status: 'error',
      error_code: 'no_embedding',
    });
  });
});
