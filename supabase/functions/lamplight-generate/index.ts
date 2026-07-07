// supabase/functions/lamplight-generate/index.ts
//
// Dispatches on body.kind:
//   - 'smoke_test'           → throwaway pipeline from sub-project 3 (kept for now)
//   - 'daily_devotion'       → real, persisted daily devotion (sub-project 4)
//   - 'connection_card_why'  → lazy Haiku "why" generation for Connection Cards (sub-project 5)
//
// Dispatches on body.sweep === true (ADDITIVE — final-review fix, job-queue sweep):
//   the 046 pg_cron job POSTs {"sweep": true} hourly to drain queued monthly_reflection
//   jobs, exactly mirroring embed-note's `{sweep:true}` branch. See reflection-sweep.ts.
//
// JWT verification stays on at the platform level. The function additionally
// requires lamplight_settings.enabled=true for the supplied user_id — EXCEPT the sweep
// branch below, which runs before user derivation (a service-role sweep call has no
// associated auth.users row, so deriveUserId would 401 it) and instead reads user_id
// straight off each claimed job row, same as embed-note's sweep never inspects the JWT
// beyond the platform-level check.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../_shared/supabase.ts';
import { embedQuery, type VoyageDeps } from '../_shared/voyage.ts';
import { searchBible } from '../_shared/retrieval.ts';
import { type BiblePassageRow, fetchPassageText } from '../_shared/bible-passage.ts';
import { createAnthropicAdapter } from '../_shared/anthropic.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import { retrieveNoteContext, type NoteContextDeps, type RawNoteRow } from '../_shared/note-context.ts';
import { sanitizeFirstName } from '../_shared/personalization.ts';
import {
  extractVerseRefsFromNoteContent,
  intersectTagsAndVerseRefs,
} from '../_shared/note-signals.ts';
import { runSmokeTestPipeline, type SmokeTestContext } from './pipeline.ts';
import {
  runDailyDevotionPipeline,
  type DailyDevotionContext,
} from './daily-devotion-pipeline.ts';
import { streamDailyDevotion } from './daily-devotion-stream.ts';
import {
  runConnectionWhyPipeline,
  type ConnectionWhyContext,
} from './connection-why-pipeline.ts';
import { runMonthlyReflectionPipeline } from './monthly-reflection-pipeline.ts';
import { buildMonthlyReflectionContext, isValidPeriodKey } from './monthly-reflection-context.ts';
import { hasReflectionAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
import { clearReflectionJob } from '../_shared/reflection-jobs.ts';
import { runReflectionSweep, claimReflectionJobs } from './reflection-sweep.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { classifyGenerateError } from './classify-error.ts';
export { classifyGenerateError };

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);

  // Top-level guard. An uncaught throw makes the Supabase Edge runtime emit its
  // own 500 response, which carries NONE of the CORS headers above — the browser
  // then misreports it as a CORS error ("No 'Access-Control-Allow-Origin'
  // header is present"). Routing every error through jsonResp keeps CORS on all
  // responses and surfaces the real failure to the client.
  try {
    return await handleGenerate(req);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleGenerate(req: Request): Promise<Response> {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const voyageKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!anthropicKey) return jsonResp({ error: 'ANTHROPIC_API_KEY missing' }, 500);
  if (!voyageKey)    return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

  let body: {
    kind?: string;
    local_date?: string;
    period_key?: string;
    source_note_id?: string;
    related_note_id?: string;
    translation?: string;
    stream?: boolean;
    sweep?: boolean;
  };
  try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }

  const supabase = serviceClient();

  // ── Sweep mode (ADDITIVE — final-review fix, job-queue sweep) ────────────
  // Checked BEFORE deriveUserId: the 046 cron caller holds a service_role JWT, which
  // satisfies platform-level JWT verification but has no associated auth.users row, so
  // deriveUserId would 401 it. Mirrors embed-note's sweep branch exactly — no additional
  // identity check beyond the platform-level one; every claimed job's user_id/period_key
  // comes from the DB row (trusted, not caller-spoofable), never from this request.
  if (body.sweep === true) {
    const voyageDepsForSweep: VoyageDeps = { apiKey: voyageKey, fetch };
    // Promo flag is user-independent — read ONCE per sweep invocation and cache it, rather
    // than re-querying app_config per claimed job (mirrors the on-demand path's single read
    // at ~L202-205, just hoisted above the loop since a sweep can claim several jobs). Wrapped
    // in an async IIFE (rather than chaining .then() on the query builder directly) so the
    // seam is a genuine Promise<boolean>, not a PostgrestFilterBuilder-derived thenable —
    // the latter structurally mismatches ReflectionSweepDeps['loadPromoActive']'s return type.
    const promoActiveCache: Promise<boolean> = (async () => {
      const { data } = await supabase
        .from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle();
      return (data as { value?: unknown } | null)?.value === true;
    })();
    const outcomes = await runReflectionSweep({
      supabase,
      llm: createAnthropicAdapter({ apiKey: anthropicKey, fetch }),
      claim: (limit) => claimReflectionJobs(supabase, limit),
      embed: (text) => embedQuery(text, voyageDepsForSweep),
      loadSettings: async (uid) => {
        const { data } = await supabase
          .from('lamplight_settings').select('enabled, timezone').eq('user_id', uid).maybeSingle();
        if (!data) return null;
        return { enabled: Boolean((data as { enabled?: boolean }).enabled), timezone: (data as { timezone?: string | null }).timezone ?? null };
      },
      loadTier: async (uid) => {
        const { data } = await supabase
          .from('lamplight_entitlements').select('tier').eq('user_id', uid).maybeSingle();
        return ((data as { tier?: LamplightTier })?.tier ?? 'none') as LamplightTier;
      },
      loadPromoActive: () => promoActiveCache,
    });
    return jsonResp({ processed: outcomes.length });
  }

  const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB'] as const;
  type Translation = typeof VALID_TRANSLATIONS[number];
  const bodyHasValidTranslation = (VALID_TRANSLATIONS as readonly string[]).includes(body.translation ?? '');

  // Identity comes from the verified JWT, never from body.user_id.
  const userId = await deriveUserId(supabase, bearerToken(req));
  if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

  // Translation resolution (single authoritative step):
  // 1. If the request body carries a valid translation, use it directly.
  // 2. Otherwise look up profiles.bible_translation for the authenticated user —
  //    the correct source for server-side background generation (daily_devotion,
  //    connection_card_why) where no transient client preference is threaded in.
  // 3. Defensive fallback to 'BSB' if the profile read errors or returns nothing.
  //    Never throw over a preference lookup — generation must always proceed.
  let translation: Translation = bodyHasValidTranslation
    ? (body.translation as Translation)
    : 'BSB';

  if (!bodyHasValidTranslation) {
    // body did not supply a valid translation — consult the persisted profile pref.
    try {
      const { data: profilePref } = await supabase
        .from('profiles')
        .select('bible_translation')
        .eq('id', userId)
        .maybeSingle();
      const pref = (profilePref as { bible_translation?: unknown } | null)?.bible_translation;
      if (typeof pref === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(pref)) {
        translation = pref as Translation;
      }
    } catch {
      // Profile lookup failure is non-fatal — fall through with default 'BSB'.
    }
  }

  const { data: settings, error: sErr } = await supabase
    .from('lamplight_settings')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (sErr) return jsonResp({ error: sErr.message }, 500);
  if (!settings?.enabled) return jsonResp({ error: 'not opted in' }, 403);

  // Quota: per-user (by tier) + global daily ceiling. Counts lamplight_usage
  // rows in a rolling 24h window. Runs before any model/context work. A failed
  // count throws and is surfaced as a 500 by the top-level catch (fail closed).
  // Note: the quota caps MODEL SPEND. Cache-hit paths (e.g. an already-generated
  // daily_devotion) return without calling Anthropic/Voyage and intentionally do
  // not record a usage row, so they don't consume quota — they incur no cost.
  const quotaCfg = resolveQuotaLimits(Deno.env);
  const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
  const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
  const llm = createAnthropicAdapter({ apiKey: anthropicKey, fetch });

  // The coordinator seam owns quota + usage recording + error classification.
  // checkQuota maps the internal QuotaResult.reason onto the lifecycle's shape;
  // recordUsage is the single recording site for the whole function.
  const lifecycleDeps: GenerationLifecycleDeps = {
    checkQuota: async (uid) => {
      const quota = await checkQuota(
        supabaseQuotaDeps(supabase),
        quotaCfg.generation,
        quotaCfg.global,
        { userId: uid, nowMs: Date.now() },
      );
      return quota.ok ? { ok: true } : { ok: false, reason: quota.reason };
    },
    recordUsage: (row) => recordLamplightUsage(supabase, row),
    classifyError: classifyGenerateError,
  };

  // --- monthly_reflection (Waymarks) ---
  if (body.kind === 'monthly_reflection') {
    const periodKey = String(body.period_key ?? '');
    if (!isValidPeriodKey(periodKey)) return jsonResp({ error: 'bad period_key' }, 400);

    // Plus gate (DESIGN DECISION 3) — added ON TOP of the opt-in gate above.
    const [{ data: ent }, { data: promoRow }] = await Promise.all([
      supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
    ]);
    if (!hasReflectionAccess({ tier: (ent?.tier ?? 'none') as LamplightTier, promoActive: promoRow?.value === true })) {
      return jsonResp({ error: 'reflections require Plus' }, 403);
    }

    const { data: settingsRow } = await supabase
      .from('lamplight_settings').select('timezone').eq('user_id', userId).maybeSingle();
    const timezone: string | null = settingsRow?.timezone ?? null;

    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'monthly_reflection' },
      async () => {
        const ctx = await buildMonthlyReflectionContext(supabase, {
          userId, periodKey, timezone,
          embed: (text) => embedQuery(text, voyageDeps),
        });
        const result = await runMonthlyReflectionPipeline({ llm, supabase, ctx, userId, periodKey });
        return { response: result, usage: result.usage };
      },
    );
    // On-demand mirror of Task 8's cohort SQL exclusion: a fresh success (a NEW
    // artifact was actually written, not a cache hit) wipes any lingering failed/
    // deferred job row for this (user, period) so the hourly sweep can pick the
    // period back up once the block that caused the prior deferral is gone.
    // Additive — the branch above functioned identically without this call.
    if (response && (response as { ok?: boolean; cached?: boolean }).ok === true && (response as { cached?: boolean }).cached === false) {
      await clearReflectionJob(supabase, userId, periodKey);
    }
    return jsonResp(response, status);
  }

  if (body.kind === 'smoke_test') {
    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'smoke_test' },
      async () => {
        const ctx = await buildSmokeTestContext(supabase, { userId, voyageDeps, rerankEnabled, translation });
        const result = await runSmokeTestPipeline({ llm, ctx });
        return { response: result, usage: result.usage };
      },
    );
    return jsonResp(response, status);
  }

  if (body.kind === 'daily_devotion') {
    if (typeof body.local_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.local_date)) {
      return jsonResp({ error: 'bad local_date' }, 400);
    }
    const localDate = body.local_date;

    // Streaming branch: when the request asks for SSE, drive the streaming
    // pipeline and forward its beats as Server-Sent Events. The buffered JSON
    // path below stays byte-for-byte unchanged. Opt-in + quota are re-gated
    // inside the module (JSON 403 / 429) before any SSE is emitted.
    const wantsStream = req.headers.get('accept')?.includes('text/event-stream') || body.stream === true;
    if (wantsStream) {
      return streamDailyDevotion(
        {
          cors,
          supabase,
          isOptedIn: async (uid) => {
            const { data } = await supabase
              .from('lamplight_settings')
              .select('enabled')
              .eq('user_id', uid)
              .maybeSingle();
            return Boolean(data?.enabled);
          },
          checkQuota: lifecycleDeps.checkQuota,
          recordUsage: lifecycleDeps.recordUsage,
          llm,
          buildContext: () =>
            buildDailyDevotionContext(supabase, { userId, localDate, voyageDeps, rerankEnabled, translation }),
        },
        { userId, localDate, signal: req.signal },
      );
    }

    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'daily_devotion' },
      async () => {
        const ctx = await buildDailyDevotionContext(supabase, {
          userId, localDate, voyageDeps, rerankEnabled, translation,
        });
        const result = await runDailyDevotionPipeline({ llm, supabase, ctx, userId, localDate });
        return { response: result, usage: result.usage };
      },
    );
    return jsonResp(response, status);
  }

  if (body.kind === 'connection_card_why') {
    if (
      typeof body.source_note_id !== 'string' ||
      typeof body.related_note_id !== 'string' ||
      body.source_note_id === body.related_note_id
    ) {
      return jsonResp({ error: 'bad payload' }, 400);
    }
    const sourceNoteId = body.source_note_id;
    const relatedNoteId = body.related_note_id;
    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'connection_card_why' },
      async (): Promise<{ response: unknown; usage: import('../_shared/usage.ts').UsageCore | null }> => {
        const minSimilarity = await loadConnectionMinSimilarity(supabase);
        const ctxResult = await buildConnectionWhyContext(supabase, {
          userId, sourceNoteId, relatedNoteId, minSimilarity,
        });
        if (ctxResult.kind === 'no_embedding') {
          return {
            response: { ok: false, reason: 'no_embedding', attempts: 0 },
            usage: { model: null, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'no_embedding' },
          };
        }
        if (ctxResult.kind === 'not_neighbor') {
          return {
            response: { ok: false, reason: 'not_neighbor', attempts: 0 },
            usage: { model: null, tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'not_neighbor' },
          };
        }
        const result = await runConnectionWhyPipeline({ llm, supabase, ctx: ctxResult.context });
        return { response: result, usage: result.usage };
      },
    );
    return jsonResp(response, status);
  }

  return jsonResp({ error: 'unknown kind' }, 400);
}


// ── Shared note-context retrieval deps (§NoteContext) ─────────────────────
// The .from('notes')… and .from('bible_passages')… query strings live here,
// written ONCE; both context builders pass these into retrieveNoteContext.
function noteContextDeps(
  supabase: SupabaseClient,
  voyageDeps: VoyageDeps,
  rerankEnabled: boolean,
  translation = 'BSB',
): NoteContextDeps {
  return {
    async fetchRecentNotes(userId, limit) {
      const { data, error } = await supabase
        .from('notes')
        .select('id, title, content, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as RawNoteRow[];
    },
    embedQuery: (text) => embedQuery(text, voyageDeps),
    searchBible: (queryArgs) => searchBible({ supabase, voyage: voyageDeps, rerankEnabled }, { ...queryArgs, translation }),
    async fetchPassages(sourceIds) {
      const byId = await fetchPassageText(supabase as never, sourceIds, translation);
      return [...byId.values()] as BiblePassageRow[];
    },
  };
}

// ── Smoke-test context builder ───────────────────────────────────────────
// Theme query = longest survivor's plaintext.
function buildSmokeTestContext(
  supabase: SupabaseClient,
  args: { userId: string; voyageDeps: VoyageDeps; rerankEnabled: boolean; translation?: string },
): Promise<SmokeTestContext | null> {
  return retrieveNoteContext(noteContextDeps(supabase, args.voyageDeps, args.rerankEnabled, args.translation), {
    userId: args.userId,
    noteLimit: 5,
    rerankEnabled: args.rerankEnabled,
    buildThemeQuery: (notes) =>
      [...notes].sort((a, b) => b.plaintext.length - a.plaintext.length)[0].plaintext,
  });
}

// ── Daily devotion context builder ───────────────────────────────────────
// Theme query = titled join capped at 4000. Wraps the seam with the
// profiles→firstName fetch + localDate, and only AFTER a non-null retrieval, so
// the profile is never read when the user has no notes.
async function buildDailyDevotionContext(
  supabase: SupabaseClient,
  args: { userId: string; localDate: string; voyageDeps: VoyageDeps; rerankEnabled: boolean; translation?: string },
): Promise<DailyDevotionContext | null> {
  const base = await retrieveNoteContext(noteContextDeps(supabase, args.voyageDeps, args.rerankEnabled, args.translation), {
    userId: args.userId,
    noteLimit: 3,
    rerankEnabled: args.rerankEnabled,
    buildThemeQuery: (notes) =>
      notes
        .map((n) => `${n.title}: ${n.plaintext.slice(0, 200)}`)
        .join('\n\n')
        .slice(0, 4000),
  });
  if (!base) return null;

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', args.userId)
    .maybeSingle();
  if (profileErr) throw profileErr;
  const firstName = sanitizeFirstName((profile?.full_name as string | undefined) ?? null);

  return { ...base, localDate: args.localDate, firstName };
}

// ── Connection-why context builder ───────────────────────────────────────
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type BuildConnectionWhyContextResult =
  | { kind: 'no_embedding' }
  | { kind: 'not_neighbor' }
  | { kind: 'ok'; context: ConnectionWhyContext };

// Read the connection-card similarity threshold from app_config. The browser
// strip reads the same row, so client and server stay in sync. Falls back to
// the spec value (0.78) when the row is absent or malformed — this is the
// production-safe default.
async function loadConnectionMinSimilarity(
  supabase: SupabaseClient,
): Promise<number> {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'lamplight_min_similarity')
    .maybeSingle();
  const raw = (data as { value?: unknown } | null)?.value;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
    return raw;
  }
  return 0.78;
}

async function buildConnectionWhyContext(
  supabase: SupabaseClient,
  args: {
    userId: string;
    sourceNoteId: string;
    relatedNoteId: string;
    minSimilarity: number;
  },
): Promise<BuildConnectionWhyContextResult> {
  // 1. Load both notes (including tags for shared-signal intersection).
  const { data: noteRows, error: nErr } = await supabase
    .from('notes')
    .select('id, title, content, tags')
    .eq('user_id', args.userId)
    .in('id', [args.sourceNoteId, args.relatedNoteId]);
  if (nErr) throw nErr;
  if (!noteRows || noteRows.length < 2) {
    return { kind: 'not_neighbor' };
  }
  const sourceRow = noteRows.find((r) => r.id === args.sourceNoteId)!;
  const relatedRow = noteRows.find((r) => r.id === args.relatedNoteId)!;

  const sourcePlaintext = extractTextFromNoteContent(sourceRow.content as string);
  const relatedPlaintext = extractTextFromNoteContent(relatedRow.content as string);
  if (!sourcePlaintext.trim() || !relatedPlaintext.trim()) {
    return { kind: 'not_neighbor' };
  }

  // 2. Load source embedding.
  const { data: embRow, error: eErr } = await supabase
    .from('lamplight_embeddings')
    .select('embedding')
    .eq('user_id', args.userId)
    .eq('source_type', 'note')
    .eq('source_id', args.sourceNoteId)
    .eq('chunk_index', 0) // post-016: notes have N chunk rows; chunk 0 is the deterministic proxy.
    .maybeSingle();
  if (eErr) throw eErr;
  if (!embRow) return { kind: 'no_embedding' };
  const sourceEmbedding = embRow.embedding as number[];

  // 3. Re-verify neighbor relationship via service-role RPC (migration 012).
  const { data: neighbors, error: mErr } = await supabase.rpc(
    'match_user_note_embeddings',
    {
      p_user_id: args.userId,
      p_query_vector: sourceEmbedding,
      p_exclude_source_id: args.sourceNoteId,
      p_limit: 50,
    },
  );
  if (mErr) throw mErr;

  const currentNeighbor = ((neighbors ?? []) as Array<{
    source_id: string;
    similarity: number;
  }>)
    .filter((n) => n.similarity >= args.minSimilarity)
    .slice(0, 5)
    .find((n) => n.source_id === args.relatedNoteId);
  if (!currentNeighbor) {
    return { kind: 'not_neighbor' };
  }

  // 4. Composite hash for cache lookup. content_hash invalidates when either
  // note's plaintext changes.
  const sourceHash = await sha256Hex(sourcePlaintext);
  const relatedHash = await sha256Hex(relatedPlaintext);
  const compositeHash = await sha256Hex(`${sourceHash}:${relatedHash}`);

  // 5. Shared signals via canonical Deno helper (browser mirror has the same
  // logic — see _shared/note-signals.ts and src/notepad/utils/connection-signals.ts).
  const sourceRefs = extractVerseRefsFromNoteContent(sourceRow.content as string);
  const relatedRefs = extractVerseRefsFromNoteContent(relatedRow.content as string);
  const sourceTags = (sourceRow.tags as string[] | null) ?? [];
  const relatedTags = (relatedRow.tags as string[] | null) ?? [];
  const { sharedTags, sharedVerseRefs } = intersectTagsAndVerseRefs(
    { tags: sourceTags, verseRefs: sourceRefs },
    { tags: relatedTags, verseRefs: relatedRefs },
  );

  return {
    kind: 'ok',
    context: {
      userId: args.userId,
      source: {
        id: args.sourceNoteId,
        title: ((sourceRow.title as string) ?? '').trim() || '(untitled)',
        plaintext: sourcePlaintext,
      },
      related: {
        id: args.relatedNoteId,
        title: ((relatedRow.title as string) ?? '').trim() || '(untitled)',
        plaintext: relatedPlaintext,
      },
      similarity: currentNeighbor.similarity,
      compositeHash,
      sharedTags,
      sharedVerseRefs,
    },
  };
}
