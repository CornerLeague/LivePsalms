import { describe, it, expect } from 'vitest';
import { resolveQuotaLimits, checkQuota, type QuotaDeps, type QuotaScope } from './quota';

const env = (map: Record<string, string>) => ({ get: (k: string) => map[k] });

describe('resolveQuotaLimits', () => {
  it('returns the default config when no env overrides are set', () => {
    const cfg = resolveQuotaLimits(env({}));
    expect(cfg.generation.kinds).toEqual(['smoke_test', 'daily_devotion', 'connection_card_why', 'bible_chat', 'etymology_insight']);
    expect(cfg.generation.perUser).toEqual({ none: 10, lite: 50, plus: 200 });
    expect(cfg.transcription.kinds).toEqual(['note_transcription']);
    expect(cfg.transcription.perUser).toEqual({ none: 5, lite: 20, plus: 50 });
    expect(cfg.global).toBe(2000);
  });

  it('applies valid generation + global overrides (Batch A key names preserved)', () => {
    const cfg = resolveQuotaLimits(env({ LAMPLIGHT_QUOTA_NONE: '3', LAMPLIGHT_QUOTA_GLOBAL: '1000' }));
    expect(cfg.generation.perUser.none).toBe(3);
    expect(cfg.global).toBe(1000);
    expect(cfg.generation.perUser.plus).toBe(200);
  });

  it('applies transcription-specific overrides', () => {
    const cfg = resolveQuotaLimits(env({ LAMPLIGHT_QUOTA_TRANSCRIPTION_NONE: '2', LAMPLIGHT_QUOTA_TRANSCRIPTION_PLUS: '99' }));
    expect(cfg.transcription.perUser.none).toBe(2);
    expect(cfg.transcription.perUser.plus).toBe(99);
    expect(cfg.transcription.perUser.lite).toBe(20);
  });

  it('ignores invalid/negative overrides; 0 is valid', () => {
    const cfg = resolveQuotaLimits(env({
      LAMPLIGHT_QUOTA_TRANSCRIPTION_LITE: 'abc',
      LAMPLIGHT_QUOTA_TRANSCRIPTION_PLUS: '-3',
      LAMPLIGHT_QUOTA_TRANSCRIPTION_NONE: '0',
    }));
    expect(cfg.transcription.perUser.lite).toBe(20);
    expect(cfg.transcription.perUser.plus).toBe(50);
    expect(cfg.transcription.perUser.none).toBe(0);
  });
});

const GEN: QuotaScope = { kinds: ['smoke_test', 'daily_devotion', 'connection_card_why'], perUser: { none: 10, lite: 50, plus: 200 } };
const TRANSCRIPTION: QuotaScope = { kinds: ['note_transcription'], perUser: { none: 5, lite: 20, plus: 50 } };
const GLOBAL = 2000;
const NOW = 1_700_000_000_000; // fixed epoch ms for deterministic sinceIso

function deps(over: Partial<QuotaDeps>): QuotaDeps {
  return {
    getTier: async () => 'none',
    countUserUsage: async () => 0,
    countGlobalUsage: async () => 0,
    ...over,
  };
}

describe('checkQuota', () => {
  it('allows when under both limits', async () => {
    const r = await checkQuota(deps({ countUserUsage: async () => 3 }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(r.ok).toBe(true);
  });

  it('blocks with user_quota at the scope tier limit', async () => {
    const r = await checkQuota(deps({ getTier: async () => 'none', countUserUsage: async () => 10 }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(r).toMatchObject({ ok: false, reason: 'user_quota', tier: 'none', userLimit: 10 });
  });

  it('uses the transcription scope limit independently of generation', async () => {
    const r = await checkQuota(deps({ getTier: async () => 'none', countUserUsage: async () => 6 }), TRANSCRIPTION, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(r).toMatchObject({ ok: false, reason: 'user_quota', userLimit: 5 });
  });

  it('allows a plus-tier user under the higher limit', async () => {
    const r = await checkQuota(deps({ getTier: async () => 'plus', countUserUsage: async () => 150 }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(r.ok).toBe(true);
  });

  it('blocks a lite-tier user at the lite limit', async () => {
    const r = await checkQuota(deps({ getTier: async () => 'lite', countUserUsage: async () => 50 }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(r).toMatchObject({ ok: false, reason: 'user_quota', tier: 'lite', userLimit: 50 });
  });

  it('propagates a countUserUsage error (fail closed)', async () => {
    await expect(
      checkQuota(deps({ countUserUsage: async () => { throw new Error('db down'); } }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW })
    ).rejects.toThrow('db down');
  });

  it('propagates a countGlobalUsage error (fail closed)', async () => {
    await expect(
      checkQuota(deps({ countGlobalUsage: async () => { throw new Error('db down'); } }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW })
    ).rejects.toThrow('db down');
  });

  it('throws on an empty kinds scope (refuses to fail open)', async () => {
    const EMPTY: QuotaScope = { kinds: [], perUser: { none: 10, lite: 50, plus: 200 } };
    await expect(
      checkQuota(deps({}), EMPTY, GLOBAL, { userId: 'u1', nowMs: NOW })
    ).rejects.toThrow();
  });

  it('passes the scope kinds to the user counter', async () => {
    let capturedKinds: string[] = [];
    await checkQuota(deps({ countUserUsage: async (_u, _since, kinds) => { capturedKinds = kinds; return 0; } }), TRANSCRIPTION, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(capturedKinds).toEqual(['note_transcription']);
  });

  it('blocks with global_quota when the ceiling is reached (user under)', async () => {
    const r = await checkQuota(deps({ countUserUsage: async () => 1, countGlobalUsage: async () => 2000 }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(r).toMatchObject({ ok: false, reason: 'global_quota' });
  });

  it('passes a 24h-ago ISO string to the counters', async () => {
    let captured = '';
    await checkQuota(deps({ countUserUsage: async (_u, since) => { captured = since; return 0; } }), GEN, GLOBAL, { userId: 'u1', nowMs: NOW });
    expect(captured).toBe(new Date(NOW - 24 * 60 * 60 * 1000).toISOString());
  });
});

const envFrom = (m: Record<string, string>) => ({ get: (k: string) => m[k] });

describe('resolveQuotaLimits — study scope', () => {
  it('defaults the study scope to a tighter cap and counts only bible_study', () => {
    const cfg = resolveQuotaLimits(envFrom({}));
    expect(cfg.study.kinds).toEqual(['bible_study']);
    expect(cfg.study.perUser).toEqual({ none: 3, lite: 10, plus: 30 });
  });
  it('honors per-tier study env overrides (0 is a valid override)', () => {
    const cfg = resolveQuotaLimits(envFrom({
      LAMPLIGHT_QUOTA_STUDY_NONE: '0',
      LAMPLIGHT_QUOTA_STUDY_LITE: '5',
      LAMPLIGHT_QUOTA_STUDY_PLUS: '50',
    }));
    expect(cfg.study.perUser).toEqual({ none: 0, lite: 5, plus: 50 });
  });
});
