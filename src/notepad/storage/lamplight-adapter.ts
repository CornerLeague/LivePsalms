// Lamplight adapter contract. Implementations live in
// supabase-lamplight-adapter.ts (production) and fake-lamplight-adapter.ts
// (tests). This file is intentionally narrow — sub-projects 2-5 will extend
// it; keep it free of implementation to minimise merge churn.

export type LamplightTier = 'plus' | 'lite' | 'none';
export type LamplightEntitlementSource =
  | 'promo'
  | 'subscription'
  | 'grant';

export interface LamplightSettings {
  userId: string;
  enabled: boolean;
  quietMode: boolean;
  inlineSuggestions: boolean;
  weeklyEmail: boolean;
  consentDecidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LamplightEntitlement {
  userId: string;
  tier: LamplightTier;
  source: LamplightEntitlementSource | null;
  grantedAt: string | null;
  expiresAt: string | null;
}

export interface PromoConfig {
  promoActive: boolean;
  promoEndsAt: string | null;
}

/**
 * Connection-card thresholds sourced from the `app_config` table so the
 * browser strip and the edge function always agree. `minSimilarity` is the
 * only knob the server enforces today; the others are client-only gates.
 */
export interface ConnectionCardThresholds {
  minSimilarity: number;
}

import type { DailyDevotion, ReflectionArtifact } from './lamplight-artifacts';

export type DailyDevotionGenerateResult =
  | { ok: true; artifact: DailyDevotion; cached: boolean }
  | { ok: false; reason: 'no_notes' | 'validators_failed' | 'network' };

export type DailyDevotionStreamEvent =
  | { kind: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
  | { kind: 'piece'; field: keyof DailyDevotion; value: unknown }
  | { kind: 'refining' }
  | { kind: 'done'; artifact: DailyDevotion; cached: boolean }
  | { kind: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };

export type MonthlyReflectionGenerateResult =
  | { ok: true; artifact: ReflectionArtifact; cached: boolean }
  | { ok: false; reason: 'no_notes' | 'validators_failed' | 'network' };

// Forward-compat with a future streaming backend (buffered fallback covers MVP). Mirrors
// DailyDevotionStreamEvent; stage names track the reflection pipeline (notes → candidates → composing).
export type MonthlyReflectionStreamEvent =
  | { kind: 'stage'; stage: 'notes' | 'candidates' | 'composing' }
  | { kind: 'piece'; field: keyof ReflectionArtifact; value: unknown }
  | { kind: 'refining' }
  | { kind: 'done'; artifact: ReflectionArtifact; cached: boolean }
  | { kind: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };

// The Path row (list view). hiddenAt/annotation are LEFT-JOINed from lamplight_reflection_state.
export interface ReflectionListItem {
  periodKey: string;   // 'YYYY-MM'
  title: string;
  createdAt: string;   // ISO
  hiddenAt: string | null;    // null = visible; non-null → The Path omits the stone (Task 17)
  annotation: string | null;  // the user's words, if any
}

// The letter view (detail). savedToNotes rides on the artifact row (lamplight_artifacts).
export interface ReflectionRecord {
  periodKey: string;
  title: string;
  artifact: ReflectionArtifact;
  createdAt: string;
  savedToNotes: boolean;
}

// Satellite state, natural-keyed (user_id, artifact_type, period_key). Never written by generation.
export interface ReflectionState {
  hiddenAt: string | null;
  annotation: string | null;
  annotationUpdatedAt: string | null;
}

export interface ConnectionNeighbor {
  relatedNoteId: string;
  similarity: number;
}

export type ConnectionWhyResult =
  | { ok: true; why: string; cached: boolean }
  | { ok: false; reason: 'no_embedding' | 'validators_failed' | 'not_neighbor' | 'network' };

export type EtymologyInsightResult =
  | { ok: true; body: string; cached: boolean }
  | { ok: false; reason: 'no_entry' | 'network' };

export interface LamplightAdapter {
  getSettings(userId: string): Promise<LamplightSettings | null>;
  upsertSettings(
    userId: string,
    patch: Partial<Omit<LamplightSettings, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<LamplightSettings>;
  deleteAllUserData(userId: string): Promise<void>;
  /**
   * Enqueue an embedding refresh for the given note. Calls the
   * `enqueue_lamplight_embedding` RPC, which is a no-op (returns null) when:
   *   - the user is opted out (`lamplight_settings.enabled = false`)
   *   - the supplied `contentHash` matches the existing embedding's hash
   *   - a queued job for the same note already exists (returns its id)
   * Returns the job id, or null when the RPC was a no-op.
   */
  enqueueEmbedding(noteId: string, contentHash: string): Promise<string | null>;
  getEntitlement(userId: string): Promise<LamplightEntitlement | null>;
  getPromoConfig(): Promise<PromoConfig>;
  /**
   * Returns the connection-card similarity threshold (and any future
   * server-enforced thresholds) from `app_config`. Used by the strip so it
   * only renders cards the edge function will agree to explain.
   */
  getConnectionCardThresholds(): Promise<ConnectionCardThresholds>;
  /** Returns the persisted daily devotion for (userId, periodKey) if it exists, else null. */
  getDailyDevotion(userId: string, periodKey: string): Promise<DailyDevotion | null>;
  /** Invokes lamplight-generate Edge Function with kind='daily_devotion'. */
  generateDailyDevotion(userId: string, localDate: string): Promise<DailyDevotionGenerateResult>;
  /** Streams daily devotion SSE events. On transport failure emits {kind:'error',reason:'network'}.
   *  Callers (D2 controller) own the fallback to generateDailyDevotion on error/no-terminal-event. */
  streamDailyDevotion?(
    userId: string,
    localDate: string,
    onEvent: (ev: DailyDevotionStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Returns neighboring notes with similarity scores using the `match_my_note_neighbors` RPC.
   *  `minSimilarity` overrides the RPC default (0.78); pass a lower value while testing. */
  getConnectionNeighbors(
    sourceNoteId: string,
    k?: number,
    minSimilarity?: number,
  ): Promise<ConnectionNeighbor[]>;
  /** Returns true if the given note has an embedding. */
  hasNoteEmbedding(noteId: string): Promise<boolean>;
  /** Invokes lamplight-generate Edge Function with kind='connection_card_why'. */
  generateConnectionWhy(sourceNoteId: string, relatedNoteId: string): Promise<ConnectionWhyResult>;
  /** Invokes the etymology-insight Edge Function to generate + persist the shared
   *  per-(word, verse) insight. Reads are done directly against the DB, not here. */
  generateEtymologyInsight(strongs: string, verseId: string): Promise<EtymologyInsightResult>;
  isLamplightAdmin(): Promise<boolean>;
  adminListJobs(filters: AdminJobFilters): Promise<AdminJobRow[]>;
  adminJobCounts(sinceIso: string): Promise<AdminJobCounts>;
  adminRequeueJob(jobId: string): Promise<AdminJobRow>;
  adminRequeueAllFailed(kind?: string, limit?: number): Promise<number>;
  adminUsageTop(windowDays: number, limit?: number): Promise<AdminUsageRow[]>;

  // ── Waymarks / monthly reflections ──────────────────────────────────────────
  listReflections(userId: string): Promise<ReflectionListItem[]>;
  getReflection(userId: string, periodKey: string): Promise<ReflectionRecord | null>;
  generateMonthlyReflection(userId: string, periodKey: string): Promise<MonthlyReflectionGenerateResult>;
  streamMonthlyReflection?(
    userId: string,
    periodKey: string,
    onEvent: (event: MonthlyReflectionStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  getReflectionState(
    userId: string,
    artifactType: string,
    periodKey: string,
  ): Promise<ReflectionState | null>;
  setReflectionHidden(
    userId: string,
    artifactType: string,
    periodKey: string,
    hidden: boolean,
  ): Promise<void>;
  setReflectionAnnotation(
    userId: string,
    artifactType: string,
    periodKey: string,
    text: string | null,
  ): Promise<void>;
  listBackfillTargets(userId: string): Promise<string[]>; // period_keys with notes-but-no-artifact, newest-first
  /** Flip the artifact-row saved_to_notes flag (client-owned; no artifactType — it lives on the artifact, not the satellite state). */
  setReflectionSavedToNotes(userId: string, periodKey: string, saved: boolean): Promise<void>;
}

export interface AdminJobFilters {
  status?: Array<'queued' | 'running' | 'done' | 'failed'>;
  kind?: string[];
  userSearch?: string;
  since?: string; // ISO timestamp
  limit?: number;
}

export interface AdminJobRow {
  id: string;
  userId: string;
  email: string | null;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  payload: unknown;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface AdminJobCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  since: string;
}

export interface AdminUsageRow {
  userId: string;
  email: string | null;
  tokensIn: number;
  tokensOut: number;
  calls: number;
  errors: number;
}
