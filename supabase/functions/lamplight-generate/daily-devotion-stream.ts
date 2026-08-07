// Node-testable streaming orchestration for the daily_devotion kind.
//
// index.ts (the Deno shell) wires the real deps into this module; the module
// itself has NO deno.land value imports and reads NO bare Deno — every runtime
// dependency is injected. It owns the streaming-only gates (opt-in 403, quota
// 429) that must precede any SSE, then drives runDailyDevotionStreaming and
// forwards its beats as SSE events. The buffered JSON path stays in index.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sseResponse, sseStreamFromWriter } from '../_shared/sse.ts';
import { runDailyDevotionStreaming, type DailyDevotionContext } from './daily-devotion-pipeline.ts';
import type { UsageRow } from '../_shared/usage.ts';
import type { LLMAdapter } from '../_shared/openai.ts';
import type { ContentRuleViolation } from '../_shared/validators.ts';
import type { ScriptureDeps } from '../_shared/scripture-verify.ts';

export interface DailyDevotionStreamDeps {
  cors: Record<string, string>;
  supabase: SupabaseClient; // passed into the pipeline (idempotency read + insert)
  isOptedIn: (userId: string) => Promise<boolean>;
  checkQuota: (userId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  recordUsage: (row: UsageRow) => void | Promise<void>;
  llm: LLMAdapter;
  // Layer C (P0-5) doctrinal classifier, threaded to applyContentRules.
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
  /**
   * Scripture verification, with repair-before-reject.
   *
   * ⚠️ THIS WAS MISSING, AND THE SHELL HAS BEEN PASSING IT ALL ALONG. `index.ts`
   * builds `makeScriptureDeps(...)` and hands it in; this interface did not
   * declare it, so JavaScript dropped it silently at the boundary and the
   * streamed devotion never verified a quote — while the BUFFERED path, three
   * lines further down the same shell, always has.
   *
   * Nothing caught it because the Deno shells were outside every typechecker
   * until 2026-08-07, and the eval harness drives the buffered path.
   */
  verifyScripture?: ScriptureDeps;
  buildContext: () => Promise<DailyDevotionContext | null>;
}

function jsonResponse(cors: Record<string, string>, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

// Streaming-only quota wrapper. Reuses the SAME injected checkQuota dep the
// buffered path consumes via lifecycleDeps; returns a JSON 429 Response on
// block (no SSE), or null to proceed.
async function checkQuotaOrError(
  checkQuota: DailyDevotionStreamDeps['checkQuota'],
  userId: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const quota = await checkQuota(userId);
  if (!quota.ok) return jsonResponse(cors, { error: 'quota_exceeded', reason: quota.reason }, 429);
  return null;
}

export async function streamDailyDevotion(
  deps: DailyDevotionStreamDeps,
  args: { userId: string; localDate: string; signal?: AbortSignal },
): Promise<Response> {
  // 1. Opt-in gate → JSON 403, no stream.
  if (!(await deps.isOptedIn(args.userId))) {
    return jsonResponse(deps.cors, { error: 'not opted in' }, 403);
  }

  // 2. Quota gate → JSON 429, no stream.
  const quotaError = await checkQuotaOrError(deps.checkQuota, args.userId, deps.cors);
  if (quotaError) return quotaError;

  // 3. Stream.
  return sseResponse(
    deps.cors,
    sseStreamFromWriter(async (emit) => {
      // Both stages bracket the single buildContext() call (bible search happens
      // inside it); their relative order is cosmetic, both precede the pipeline.
      void emit({ t: 'stage', stage: 'notes' });
      void emit({ t: 'stage', stage: 'scripture' });
      const ctx = await deps.buildContext();

      const result = await runDailyDevotionStreaming(
        { llm: deps.llm, supabase: deps.supabase, ctx, userId: args.userId, localDate: args.localDate, classifier: deps.classifier, verifyScripture: deps.verifyScripture, signal: args.signal },
        {
          onStage: (s) => void emit({ t: 'stage', stage: s }),
          onPiece: (field, value) => void emit({ t: 'piece', field, value }),
          onRefining: () => void emit({ t: 'refining' }),
        },
      );

      if (result.ok) {
        void emit({ t: 'done', payload: result });
      } else {
        // no_notes and validators_failed both surface as an error beat: the
        // client gets the reason and renders the empty/failed state. (The
        // buffered path returns these as ok:false JSON; the SSE error beat is
        // the streaming analogue.)
        void emit({ t: 'error', reason: result.reason });
      }

      // Record usage AFTER content is emitted, fire-and-forget, only when the
      // path actually spent (cache-hit/no_notes record nothing → usage null).
      if (result.usage) {
        void Promise.resolve(
          deps.recordUsage({ ...result.usage, user_id: args.userId, artifact_kind: 'daily_devotion' }),
        ).catch(() => {});
      }
    }),
  );
}
