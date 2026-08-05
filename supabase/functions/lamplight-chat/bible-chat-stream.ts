// Node-testable streaming orchestration for one bible-chat turn.
//
// index.ts (the Deno shell) wires the real deps into this module; the module
// itself has NO deno.land value imports and reads NO bare Deno — every runtime
// dependency is injected. It owns the streaming-only gates (opt-in 403,
// entitlement 402, quota 429) that must precede any SSE, persists the user
// message before generation, then drives runBibleChatStreaming and forwards its
// beats as SSE events. The buffered JSON path stays in index.ts.

import { sseResponse, sseStreamFromWriter } from '../_shared/sse.ts';
import { runBibleChatStreaming, type BibleChatContext, type ChatPromptModule } from './bible-chat-pipeline.ts';
import type { ChatReply, ContentRuleViolation } from '../_shared/validators.ts';
import type { UsageRow } from '../_shared/usage.ts';
import type { LLMAdapter, LLMModel, ReasoningEffort } from '../_shared/openai.ts';

type HistoryRow = { role: 'user' | 'assistant'; content: string };

export interface BibleChatStreamDeps {
  cors: Record<string, string>;
  isOptedIn: (userId: string) => Promise<boolean>;
  hasChatAccess: (userId: string) => Promise<boolean>;
  checkQuota: (userId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  recordUsage: (row: UsageRow) => void | Promise<void>;
  upsertThread: (firstMessage: string) => Promise<string>;
  loadHistory: (threadId: string) => Promise<HistoryRow[]>;
  persistUserMessage: (threadId: string) => Promise<void>;
  persistAssistant: (threadId: string, reply: string, citations: ChatReply['citations']) => Promise<void>;
  buildContext: (input: { history: HistoryRow[] }) => Promise<BibleChatContext>;
  llm: LLMAdapter;
  prompt?: ChatPromptModule; // insight passes BIBLE_INSIGHT_PROMPT; chat leaves undefined
  // Model tier for the streamed turn; defaults to 'balanced' downstream. Study
  // passes 'deep' so streaming matches its buffered path — omitting this was the
  // tier-drift bug where production Study chat silently ran a tier below design.
  model?: LLMModel;
  /** Reasoning effort for the streamed turn; omitted means the adapter's tier default. */
  effort?: ReasoningEffort;
  /** Output budget; defaults to 2048 downstream. Raise where reasoning is on. */
  maxTokens?: number;
  // Layer C (P0-5) doctrinal classifier, threaded to applyContentRules.
  classifier?: (text: string) => Promise<ContentRuleViolation[]>;
  // Optional extra fields spread into the `done` event payload (after the base
  // fields). Study supplies offered_notes here; bible chat omits it → unchanged.
  extraDoneFields?: () => Record<string, unknown>;
  // Usage artifact_kind for recordUsage; defaults to 'bible_chat'. Study passes 'bible_study'.
  artifactKind?: string;
}

function jsonResponse(cors: Record<string, string>, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

// Streaming-only quota wrapper. Reuses the SAME injected checkQuota dep the
// buffered path consumes via lifecycleDeps; returns a JSON 429 Response on
// block (no SSE), or null to proceed. The 429 shape is aligned with the
// buffered path's { error: 'quota_exceeded', reason } contract (Part C).
async function checkQuotaOrError(
  checkQuota: BibleChatStreamDeps['checkQuota'],
  userId: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const quota = await checkQuota(userId);
  if (!quota.ok) return jsonResponse(cors, { error: 'quota_exceeded', reason: quota.reason }, 429);
  return null;
}

export async function streamBibleChat(
  deps: BibleChatStreamDeps,
  args: { userId: string; mode: 'chat' | 'insight'; message: string; threadTitle: string; signal?: AbortSignal },
): Promise<Response> {
  // 1. Opt-in gate → JSON 403, no stream.
  if (!(await deps.isOptedIn(args.userId))) {
    return jsonResponse(deps.cors, { ok: false, reason: 'not_opted_in' }, 403);
  }

  // 2. Entitlement gate → JSON 402, no stream.
  if (!(await deps.hasChatAccess(args.userId))) {
    return jsonResponse(deps.cors, { ok: false, reason: 'no_entitlement' }, 402);
  }

  // 3. Quota gate → JSON 429, no stream.
  const quotaError = await checkQuotaOrError(deps.checkQuota, args.userId, deps.cors);
  if (quotaError) return quotaError;

  // 4. Load-or-create the thread, then read existing history.
  const threadId = await deps.upsertThread(args.threadTitle);
  const history = await deps.loadHistory(threadId);

  // 5. Insight only fires on an empty thread — refuse otherwise (idempotent,
  //    no stream). Mirrors the buffered path's skip.
  if (args.mode === 'insight' && history.length > 0) {
    return jsonResponse(deps.cors, { ok: true, thread_id: threadId, skipped: true }, 200);
  }

  // 6. Chat mode persists the USER message BEFORE generation, so that on a
  //    validators_failed the user message remains with no assistant row.
  //    (Insight has no user message.)
  if (args.mode === 'chat') await deps.persistUserMessage(threadId);

  // 7. Stream.
  return sseResponse(
    deps.cors,
    sseStreamFromWriter(async (emit) => {
      void emit({ t: 'stage', stage: 'notes' });
      void emit({ t: 'stage', stage: 'scripture' });
      const ctx = await deps.buildContext({ history });

      const result = await runBibleChatStreaming(
        {
          llm: deps.llm, ctx, prompt: deps.prompt,
          model: deps.model, effort: deps.effort, maxTokens: deps.maxTokens,
          classifier: deps.classifier, signal: args.signal,
        },
        {
          onStage: (s) => void emit({ t: 'stage', stage: s }),
          onText: (field, delta) => void emit({ t: 'text', field, delta }),
          // Emission policy: suppress the `reply` piece — it is already streamed
          // via `text` deltas. `citations` (and any non-text field) still emits
          // a piece. General rule: suppress `piece` for fields in textFields
          // (here textFields === ['reply']).
          onPiece: (field, value) => { if (field === 'reply') return; void emit({ t: 'piece', field, value }); },
          onRefining: () => void emit({ t: 'refining' }),
        },
      );

      if (result.ok) {
        await deps.persistAssistant(threadId, result.reply, result.citations);
        void emit({
          t: 'done',
          payload: {
            ok: true,
            thread_id: threadId,
            reply: result.reply,
            citations: result.citations,
            ...(deps.extraDoneFields?.() ?? {}),
          },
        });
      } else {
        // validators_failed → error beat (the streaming analogue of the buffered
        // ok:false JSON). User message already persisted; no assistant row.
        void emit({ t: 'error', reason: result.reason });
      }

      // Usage recorded AFTER the stream, fire-and-forget, only when the path
      // actually spent (validators_failed still carries an error-usage row).
      if (result.usage) {
        void Promise.resolve(
          deps.recordUsage({ ...result.usage, user_id: args.userId, artifact_kind: deps.artifactKind ?? 'bible_chat' }),
        ).catch(() => {});
      }
    }),
  );
}
