import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  LamplightAdapter,
  LamplightSettings,
  LamplightEntitlement,
  PromoConfig,
  LamplightTier,
  LamplightEntitlementSource,
  DailyDevotionGenerateResult,
  ConnectionNeighbor,
  ConnectionWhyResult,
  ConnectionCardThresholds,
  AdminJobFilters,
  AdminJobRow,
  AdminJobCounts,
  AdminUsageRow,
} from './lamplight-adapter';
import type { DailyDevotion } from './lamplight-artifacts';

// Tables with a `user_id` column — deletable via `eq('user_id', userId)`.
const LAMPLIGHT_USER_ID_TABLES = [
  'lamplight_settings',
  'lamplight_entitlements',
  'lamplight_embeddings',
  'lamplight_artifacts',
  'lamplight_jobs',
  'lamplight_suggestions_log',
] as const;

// `lamplight_connections` has no `user_id` column — it's scoped to a user via
// EXISTS-against-notes in its RLS policy. The deleteAllUserData flow uses a
// tautology predicate (`note_id IS NOT NULL`) to satisfy Supabase JS's
// "delete needs a filter" guard; RLS itself does the user scoping.
const LAMPLIGHT_CONNECTIONS_TABLE = 'lamplight_connections';

export class SupabaseLamplightAdapter implements LamplightAdapter {
  #client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.#client = client;
  }

  async getSettings(userId: string): Promise<LamplightSettings | null> {
    const { data, error } = await this.#client
      .from('lamplight_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.#mapSettings(data) : null;
  }

  async upsertSettings(
    userId: string,
    patch: Partial<Omit<LamplightSettings, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<LamplightSettings> {
    const payload: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    if (patch.enabled !== undefined) payload.enabled = patch.enabled;
    if (patch.quietMode !== undefined) payload.quiet_mode = patch.quietMode;
    if (patch.inlineSuggestions !== undefined) payload.inline_suggestions = patch.inlineSuggestions;
    if (patch.weeklyEmail !== undefined) payload.weekly_email = patch.weeklyEmail;
    if (patch.consentDecidedAt !== undefined) payload.consent_decided_at = patch.consentDecidedAt;

    const { data, error } = await this.#client
      .from('lamplight_settings')
      .upsert(payload)
      .select()
      .single();
    if (error) throw error;
    return this.#mapSettings(data);
  }

  async enqueueEmbedding(noteId: string, contentHash: string): Promise<string | null> {
    const { data, error } = await this.#client.rpc('enqueue_lamplight_embedding', {
      p_note_id: noteId,
      p_content_hash: contentHash,
    });
    if (error) throw error;
    return (data as string | null) ?? null;
  }

  async deleteAllUserData(userId: string): Promise<void> {
    for (const table of LAMPLIGHT_USER_ID_TABLES) {
      const { error } = await this.#client.from(table).delete().eq('user_id', userId);
      if (error) throw error;
    }
    // lamplight_connections has no user_id column. RLS filters to the current
    // user's notes; the tautology predicate just satisfies Supabase JS's
    // "delete requires a filter" safety guard.
    const { error } = await this.#client
      .from(LAMPLIGHT_CONNECTIONS_TABLE)
      .delete()
      .not('note_id', 'is', null);
    if (error) throw error;
  }

  async getEntitlement(userId: string): Promise<LamplightEntitlement | null> {
    const { data, error } = await this.#client
      .from('lamplight_entitlements')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.#mapEntitlement(data) : null;
  }

  async getDailyDevotion(userId: string, periodKey: string): Promise<DailyDevotion | null> {
    const { data, error } = await this.#client
      .from('lamplight_artifacts')
      .select('body')
      .eq('user_id', userId)
      .eq('type', 'daily_devotion')
      .eq('period_key', periodKey)
      .maybeSingle();
    if (error) throw error;
    return data ? (data.body as DailyDevotion) : null;
  }

  async generateDailyDevotion(userId: string, localDate: string): Promise<DailyDevotionGenerateResult> {
    try {
      const { data, error } = await this.#client.functions.invoke('lamplight-generate', {
        body: { kind: 'daily_devotion', user_id: userId, local_date: localDate },
      });
      if (error) return { ok: false, reason: 'network' };
      if (!data || typeof data !== 'object') return { ok: false, reason: 'network' };
      const d = data as { ok?: boolean; artifact?: DailyDevotion; cached?: boolean; reason?: string };
      if (d.ok === true && d.artifact) {
        return { ok: true, artifact: d.artifact, cached: !!d.cached };
      }
      if (d.ok === false && (d.reason === 'no_notes' || d.reason === 'validators_failed')) {
        return { ok: false, reason: d.reason };
      }
      return { ok: false, reason: 'network' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  async getConnectionNeighbors(
    sourceNoteId: string,
    k = 5,
    minSimilarity?: number,
  ): Promise<ConnectionNeighbor[]> {
    const args: Record<string, unknown> = {
      p_source_note_id: sourceNoteId,
      p_k: k,
    };
    if (typeof minSimilarity === 'number') {
      args.p_min_similarity = minSimilarity;
    }
    const { data, error } = await this.#client.rpc('match_my_note_neighbors', args);
    if (error) throw error;
    return ((data as Array<{ related_note_id: string; similarity: number }>) ?? []).map(
      (row) => ({
        relatedNoteId: row.related_note_id,
        similarity: row.similarity,
      }),
    );
  }

  async hasNoteEmbedding(noteId: string): Promise<boolean> {
    const { count, error } = await this.#client
      .from('lamplight_embeddings')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'note')
      .eq('source_id', noteId);
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async generateConnectionWhy(
    sourceNoteId: string,
    relatedNoteId: string,
  ): Promise<ConnectionWhyResult> {
    try {
      const { data: userResp } = await this.#client.auth.getUser();
      const user = userResp?.user;
      if (!user) return { ok: false, reason: 'network' };
      const { data, error } = await this.#client.functions.invoke('lamplight-generate', {
        body: {
          kind: 'connection_card_why',
          user_id: user.id,
          source_note_id: sourceNoteId,
          related_note_id: relatedNoteId,
        },
      });
      if (error) return { ok: false, reason: 'network' };
      if (!data || typeof data !== 'object') return { ok: false, reason: 'network' };
      const d = data as Record<string, unknown>;
      if (d.ok === true && typeof d.why === 'string') {
        return { ok: true, why: d.why, cached: !!d.cached };
      }
      if (
        d.ok === false &&
        (d.reason === 'no_embedding' ||
          d.reason === 'validators_failed' ||
          d.reason === 'not_neighbor')
      ) {
        return {
          ok: false,
          reason: d.reason as 'no_embedding' | 'validators_failed' | 'not_neighbor',
        };
      }
      return { ok: false, reason: 'network' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  }

  async getPromoConfig(): Promise<PromoConfig> {
    const { data, error } = await this.#client
      .from('app_config')
      .select('key,value')
      .in('key', ['lamplight_promo_active', 'lamplight_promo_ends_at']);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ key: string; value: unknown }>;
    const promoRow = rows.find((r) => r.key === 'lamplight_promo_active');
    const endsRow = rows.find((r) => r.key === 'lamplight_promo_ends_at');
    return {
      promoActive: promoRow?.value === true,
      promoEndsAt: typeof endsRow?.value === 'string' ? endsRow.value : null,
    };
  }

  async getConnectionCardThresholds(): Promise<ConnectionCardThresholds> {
    const { data, error } = await this.#client
      .from('app_config')
      .select('value')
      .eq('key', 'lamplight_min_similarity')
      .maybeSingle();
    if (error) throw error;
    const raw = (data as { value?: unknown } | null)?.value;
    // Server falls back to 0.78 when the row is missing or malformed
    // (see lamplight-generate/index.ts loadConnectionMinSimilarity). Mirror
    // that fallback here so client and server agree even before the migration
    // is applied.
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
      return { minSimilarity: raw };
    }
    return { minSimilarity: 0.78 };
  }

  #mapSettings(row: Record<string, unknown>): LamplightSettings {
    return {
      userId: row.user_id as string,
      enabled: row.enabled as boolean,
      quietMode: row.quiet_mode as boolean,
      inlineSuggestions: row.inline_suggestions as boolean,
      weeklyEmail: row.weekly_email as boolean,
      consentDecidedAt: (row.consent_decided_at as string) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  #mapEntitlement(row: Record<string, unknown>): LamplightEntitlement {
    return {
      userId: row.user_id as string,
      tier: row.tier as LamplightTier,
      source: (row.source as LamplightEntitlementSource) ?? null,
      grantedAt: (row.granted_at as string) ?? null,
      expiresAt: (row.expires_at as string) ?? null,
    };
  }

  // Shared snake→camel mapper for admin job rows. `email` is supplied by the
  // caller because the two RPCs differ on exactly one field:
  // admin_list_lamplight_jobs joins email, admin_requeue_lamplight_job does not
  // (the requeue path passes null). Every other field maps identically.
  #mapAdminJobRow(r: Record<string, unknown>, email: string | null): AdminJobRow {
    return {
      id: r.id as string,
      userId: r.user_id as string,
      email,
      kind: r.kind as string,
      status: r.status as AdminJobRow['status'],
      attempts: r.attempts as number,
      payload: r.payload,
      scheduledAt: r.scheduled_at as string,
      startedAt: (r.started_at as string) ?? null,
      finishedAt: (r.finished_at as string) ?? null,
      error: (r.error as string) ?? null,
    };
  }

  async isLamplightAdmin(): Promise<boolean> {
    const { data, error } = await this.#client.rpc('is_lamplight_admin');
    if (error) return false;
    return Boolean(data);
  }

  async adminListJobs(filters: AdminJobFilters): Promise<AdminJobRow[]> {
    // Omit `p_since` when not provided so the RPC's own default (7 days) fires
    // rather than duplicating it on the client. Sending null would make the
    // server's `scheduled_at >= p_since` predicate match zero rows.
    const params: Record<string, unknown> = {
      p_status: filters.status ?? ['failed'],
      p_kind: filters.kind ?? null,
      p_user_search: filters.userSearch ?? null,
      p_limit: filters.limit ?? 200,
    };
    if (filters.since !== undefined) {
      params.p_since = filters.since;
    }
    const { data, error } = await this.#client.rpc('admin_list_lamplight_jobs', params);
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) =>
      this.#mapAdminJobRow(r, (r.email as string) ?? null),
    );
  }

  async adminJobCounts(sinceIso: string): Promise<AdminJobCounts> {
    const { data, error } = await this.#client.rpc('admin_lamplight_job_counts', {
      p_since: sinceIso,
    });
    if (error) throw error;
    const obj = (data ?? {}) as Record<string, unknown>;
    return {
      queued: Number(obj.queued ?? 0),
      running: Number(obj.running ?? 0),
      done: Number(obj.done ?? 0),
      failed: Number(obj.failed ?? 0),
      since: String(obj.since ?? sinceIso),
    };
  }

  async adminRequeueJob(jobId: string): Promise<AdminJobRow> {
    const { data, error } = await this.#client.rpc('admin_requeue_lamplight_job', {
      p_job_id: jobId,
    });
    if (error) throw error;
    const r = data as Record<string, unknown>;
    // The requeue RPC does not join email — keep the historical null.
    return this.#mapAdminJobRow(r, null);
  }

  async adminRequeueAllFailed(kind?: string, limit?: number): Promise<number> {
    const { data, error } = await this.#client.rpc('admin_requeue_failed_lamplight_jobs', {
      p_kind: kind ?? null,
      p_limit: limit ?? 100,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  async adminUsageTop(windowDays: number, limit?: number): Promise<AdminUsageRow[]> {
    const { data, error } = await this.#client.rpc('admin_lamplight_usage_top', {
      p_window_days: windowDays,
      p_limit: limit ?? 50,
    });
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      userId: r.user_id as string,
      email: (r.email as string) ?? null,
      tokensIn: Number(r.tokens_in ?? 0),
      tokensOut: Number(r.tokens_out ?? 0),
      calls: Number(r.calls ?? 0),
      errors: Number(r.errors ?? 0),
    }));
  }
}
