// Insights Door 1 — the orchestration behind the edge function.
//
// Node-testable: no deno.land value imports and no bare `Deno`. The shell
// (`supabase/functions/passage-insight/index.ts`) wires the real deps in.
//
// Owns the order the door depends on:
//   cache read → entitlement → quota → stream → write on the terminal beat.
// The cache read comes FIRST and on purpose: a warmed door is a public asset,
// free to everyone signed out included, so it must never reach an entitlement
// check. It also settles the race where two readers press Study this passage
// at the same moment — the second gets the first's door instead of paying for
// a duplicate.
//
// NOT built on `streamBibleChat`, despite the design's first draft: that seam
// is thread-shaped (it upserts a chat thread and persists user and assistant
// messages), and Door 1 has no thread and no messages. The reusable layer is
// `generateStreamingWithRetry`, one below it, with this SSE shell around it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sseResponse, sseStreamFromWriter } from '../_shared/sse.ts';
import { checkQuota, type QuotaConfig, type QuotaDeps } from '../_shared/quota.ts';
import { hasInlineInsightAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { runPassageInsightStreaming } from './passage-insight-pipeline.ts';
import { readPassageDoor, writePassageDoor, sourcesFromExcerpts, type PassageScope } from './passage-insight-cache.ts';
import { PASSAGE_DOOR_SPEC } from './prompts/passage-insight.ts';
import type { InsightDoorSpec } from './prompts/insight-door.ts';
import type { BibleChatContext } from '../lamplight-chat/bible-chat-pipeline.ts';
import type { LLMAdapter } from '../_shared/openai.ts';
import type { UsageRow } from '../_shared/usage.ts';
import type { ContentRuleViolation } from '../_shared/validators.ts';
import type { ScriptureDeps } from '../_shared/scripture-verify.ts';

export const PASSAGE_INSIGHT_KIND = 'passage_insight';

export interface PassageInsightStreamDeps {
  cors: Record<string, string>;
  /**
   * Which door this request is for. ONE spec, used for the cache read, the
   * generation and the cache write alike — so the three can never disagree
   * about which door they are handling, which is the failure that would write
   * one door's prose under another door's key.
   */
  door?: InsightDoorSpec;
  supabase: SupabaseClient;
  llm: LLMAdapter;
  quotaDeps: QuotaDeps;
  /** The whole config, not a pre-bound closure: the SCOPE choice is the D1 decision, and it belongs where it can be tested. */
  quotaConfig: QuotaConfig;
  getEntitlement: (userId: string) => Promise<{ tier: LamplightTier; promoActive: boolean }>;
  recordUsage: (row: UsageRow) => void | Promise<void>;
  buildContext: () => Promise<BibleChatContext>;
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
  verifyScripture?: ScriptureDeps;
  /** Injected so the quota window is deterministic in tests. */
  nowMs?: () => number;
}

export type ParsedPassageInsightBody =
  | { ok: true; book: string; chapter: number; verse?: number; scope: PassageScope; refId: string }
  | { ok: false };

/**
 * The request contract, and with it the CACHE KEY.
 *
 * `ref_id` is composed here from book/chapter/verse rather than taken from the
 * client: it is the primary key of a globally shared table, and a client free
 * to spell it would be a client free to fragment the cache ('psa.27' vs
 * 'Psa.27' vs 'psa.27.0') or to write under a ref that means nothing.
 *
 * Two grains only — design decision 6. A multi-verse selection resolves to the
 * chapter grain in the client, so anything without a single `verse` is a
 * chapter door.
 */
export function parsePassageInsightBody(body: {
  book?: unknown; chapter?: unknown; verse?: unknown;
}): ParsedPassageInsightBody {
  if (typeof body.book !== 'string' || !body.book.trim()) return { ok: false };
  if (typeof body.chapter !== 'number' || !Number.isInteger(body.chapter) || body.chapter < 1) return { ok: false };

  const book = body.book.trim().toLowerCase();
  const hasVerse = body.verse !== undefined && body.verse !== null;
  if (hasVerse && (typeof body.verse !== 'number' || !Number.isInteger(body.verse) || body.verse < 1)) {
    return { ok: false };
  }
  const verse = hasVerse ? (body.verse as number) : undefined;

  return verse === undefined
    ? { ok: true, book, chapter: body.chapter, scope: 'chapter', refId: `${book}.${body.chapter}` }
    : { ok: true, book, chapter: body.chapter, verse, scope: 'verse', refId: `${book}.${body.chapter}.${verse}` };
}

function jsonResponse(cors: Record<string, string>, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

export async function streamPassageInsight(
  deps: PassageInsightStreamDeps,
  args: { userId: string; scope: PassageScope; refId: string; signal?: AbortSignal },
): Promise<Response> {
  const door = deps.door ?? PASSAGE_DOOR_SPEC;

  // 1. Cache read. Free, public, and ahead of every gate.
  const cached = await readPassageDoor(deps.supabase, { scope: args.scope, refId: args.refId, door });
  if (cached) {
    return jsonResponse(deps.cors, {
      ok: true,
      cached: true,
      sections: cached.sections,
      sources: cached.sources,
      model_used: cached.modelUsed,
      prompt_version: cached.promptVersion,
    }, 200);
  }

  // 2. Entitlement → JSON 403, no stream. Same gate as etymology-insight (D1).
  const { tier, promoActive } = await deps.getEntitlement(args.userId);
  if (!hasInlineInsightAccess({ tier, promoActive })) {
    return jsonResponse(deps.cors, { error: 'passage insight requires Plus', reason: 'entitlement' }, 403);
  }

  // 3. Quota → JSON 429, no stream.
  //
  // D1: the `passageInsight` scope carries `perUser: null`, so checkQuota skips
  // the per-user check entirely and only the GLOBAL daily ceiling applies. The
  // door is a public asset — charging one reader's allowance to warm it for
  // everyone else is the wrong incentive — but "uncharged" is not "unbounded",
  // and a scripted loop still trips the global ceiling.
  const quota = await checkQuota(
    deps.quotaDeps,
    deps.quotaConfig.passageInsight,
    deps.quotaConfig.global,
    { userId: args.userId, nowMs: (deps.nowMs ?? Date.now)() },
  );
  if (!quota.ok) {
    return jsonResponse(deps.cors, { error: 'quota_exceeded', reason: quota.reason }, 429);
  }

  // 4. Stream.
  return sseResponse(
    deps.cors,
    sseStreamFromWriter(async (emit) => {
      const ctx = await deps.buildContext();

      const result = await runPassageInsightStreaming(
        {
          llm: deps.llm,
          ctx,
          door,
          classifier: deps.classifier,
          verifyScripture: deps.verifyScripture,
          signal: args.signal,
        },
        {
          onStage: (stage) => void emit({ t: 'stage', stage }),
          onText: (field, delta) => void emit({ t: 'text', field, delta }),
          onPiece: (field, value) => void emit({ t: 'piece', field, value }),
          onRefining: () => void emit({ t: 'refining' }),
        },
      );

      // Usage is recorded on every path that SPENT, gated or not. "Not counted
      // against the user" never meant invisible — the admin dashboard reads
      // these rows, and an uncharged bucket is the one most worth watching.
      if (result.usage) {
        void Promise.resolve(
          deps.recordUsage({ ...result.usage, user_id: args.userId, artifact_kind: PASSAGE_INSIGHT_KIND }),
        ).catch(() => {});
      }

      if (!result.ok) {
        void emit({ t: 'error', reason: result.reason });
        return;
      }

      // 5. Write on the terminal beat, never before. An interrupted stream
      // throws out of runPassageInsightStreaming and never reaches here, so the
      // door simply stays uncached — the same way study chat declines to commit
      // an interrupted reply.
      const write = await writePassageDoor(deps.supabase, {
        scope: args.scope,
        refId: args.refId,
        door,
        sections: result.sections,
        sources: sourcesFromExcerpts(ctx.libraryExcerpts),
        modelUsed: result.modelUsed,
        promptVersion: result.promptVersion,
        createdBy: args.userId,
      });

      void emit({
        t: 'done',
        payload: {
          ok: true,
          // FALSE when the door was refused as all-empty. The client must not
          // be told a door is warm when no row landed — it would render an
          // empty door and never offer to generate again.
          cached: write.written,
          sections: result.sections,
          model_used: result.modelUsed,
          prompt_version: result.promptVersion,
        },
      });
    }),
  );
}
