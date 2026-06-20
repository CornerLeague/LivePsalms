// supabase/functions/_shared/quota.ts
//
// Per-user (by tier, kind-scoped) + global daily quota for billable Lamplight
// AI calls. Counts lamplight_usage rows in a rolling 24h window. No new infra.
// Accepts a small race-window overage under concurrency — fine for a spend cap.
//
// Buckets are INDEPENDENT and scoped by artifact_kind: the generation bucket
// counts generation kinds; the transcription bucket counts note_transcription.
// The global ceiling counts ALL kinds across all users (absolute wallet guard).

import type { SupabaseClient } from '@supabase/supabase-js';

export type Tier = 'none' | 'lite' | 'plus';

export interface QuotaScope {
  kinds: string[];                 // artifact_kinds this bucket counts
  perUser: Record<Tier, number>;
}

export interface QuotaConfig {
  generation: QuotaScope;
  transcription: QuotaScope;
  study: QuotaScope;               // Opus-backed study chat — tighter cap
  global: number;                  // all-kinds daily ceiling
}

const GENERATION_KINDS = ['smoke_test', 'daily_devotion', 'connection_card_why', 'bible_chat'];
const TRANSCRIPTION_KINDS = ['note_transcription'];
const STUDY_KINDS = ['bible_study'];

const DEFAULTS = {
  generation: { none: 10, lite: 50, plus: 200 },
  transcription: { none: 5, lite: 20, plus: 50 },
  study: { none: 3, lite: 10, plus: 30 },
  global: 2000,
};

// Per-environment overrides without a code change. Invalid/negative → default;
// 0 is a valid, intentional override (disables a tier / sets a hard ceiling).
export function resolveQuotaLimits(env: { get(key: string): string | undefined }): QuotaConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env.get(key);
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    generation: {
      kinds: GENERATION_KINDS,
      perUser: {
        none: num('LAMPLIGHT_QUOTA_NONE', DEFAULTS.generation.none),
        lite: num('LAMPLIGHT_QUOTA_LITE', DEFAULTS.generation.lite),
        plus: num('LAMPLIGHT_QUOTA_PLUS', DEFAULTS.generation.plus),
      },
    },
    transcription: {
      kinds: TRANSCRIPTION_KINDS,
      perUser: {
        none: num('LAMPLIGHT_QUOTA_TRANSCRIPTION_NONE', DEFAULTS.transcription.none),
        lite: num('LAMPLIGHT_QUOTA_TRANSCRIPTION_LITE', DEFAULTS.transcription.lite),
        plus: num('LAMPLIGHT_QUOTA_TRANSCRIPTION_PLUS', DEFAULTS.transcription.plus),
      },
    },
    study: {
      kinds: STUDY_KINDS,
      perUser: {
        none: num('LAMPLIGHT_QUOTA_STUDY_NONE', DEFAULTS.study.none),
        lite: num('LAMPLIGHT_QUOTA_STUDY_LITE', DEFAULTS.study.lite),
        plus: num('LAMPLIGHT_QUOTA_STUDY_PLUS', DEFAULTS.study.plus),
      },
    },
    global: num('LAMPLIGHT_QUOTA_GLOBAL', DEFAULTS.global),
  };
}

export interface QuotaDeps {
  getTier(userId: string): Promise<Tier>;
  countUserUsage(userId: string, sinceIso: string, kinds: string[]): Promise<number>;
  countGlobalUsage(sinceIso: string): Promise<number>;
}

export type QuotaResult =
  | { ok: true; tier: Tier; userUsed: number; userLimit: number }
  | { ok: false; reason: 'user_quota' | 'global_quota'; tier: Tier; userUsed: number; userLimit: number };

const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkQuota(
  deps: QuotaDeps,
  scope: QuotaScope,
  global: number,
  args: { userId: string; nowMs: number },
): Promise<QuotaResult> {
  // Refuse an empty kinds scope: `.in('artifact_kind', [])` matches zero rows,
  // which would silently fail OPEN. A misconfigured scope must block, not pass.
  if (scope.kinds.length === 0) {
    throw new Error('quota scope has no kinds — refusing to fail open');
  }
  const sinceIso = new Date(args.nowMs - DAY_MS).toISOString();
  const [tier, userUsed] = await Promise.all([
    deps.getTier(args.userId),
    deps.countUserUsage(args.userId, sinceIso, scope.kinds),
  ]);
  const userLimit = scope.perUser[tier];
  if (userUsed >= userLimit) {
    return { ok: false, reason: 'user_quota', tier, userUsed, userLimit };
  }

  const globalUsed = await deps.countGlobalUsage(sinceIso);
  if (globalUsed >= global) {
    return { ok: false, reason: 'global_quota', tier, userUsed, userLimit };
  }

  return { ok: true, tier, userUsed, userLimit };
}

// Thin adapter from a Supabase client to QuotaDeps. Glue (not unit-tested),
// mirrors serviceClient()/VoyageDeps construction elsewhere in _shared.
export function supabaseQuotaDeps(client: SupabaseClient): QuotaDeps {
  return {
    async getTier(userId) {
      const { data } = await client
        .from('lamplight_entitlements')
        .select('tier')
        .eq('user_id', userId)
        .maybeSingle();
      const tier = data?.tier;
      return tier === 'lite' || tier === 'plus' ? tier : 'none';
    },
    async countUserUsage(userId, sinceIso, kinds) {
      const { count, error } = await client
        .from('lamplight_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('artifact_kind', kinds)
        .gte('created_at', sinceIso);
      // Fail closed: a broken quota check must block, never silently allow.
      if (error) throw new Error(`quota countUserUsage failed: ${error.message}`);
      return count ?? 0;
    },
    async countGlobalUsage(sinceIso) {
      const { count, error } = await client
        .from('lamplight_usage')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso);
      // Fail closed: a broken quota check must block, never silently allow.
      if (error) throw new Error(`quota countGlobalUsage failed: ${error.message}`);
      return count ?? 0;
    },
  };
}
