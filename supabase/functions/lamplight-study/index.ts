// supabase/functions/lamplight-study/index.ts
// Lamplight Study chat (Opus). Sibling of lamplight-chat. Mirrors its gates and
// envelope; grounds in apparatus data; offers (never auto-injects) notes.
// Body: { book, chapter, message?, mode?, include_notes?, note_ids? }
// Resp: { ok, thread_id, reply, citations, offered_notes } | { ok, thread_id, skipped } | { ok:false, reason }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../_shared/supabase.ts';
import { type VoyageDeps } from '../_shared/voyage.ts';
import { createOpenAIAdapter } from '../_shared/openai.ts';
import { makeDoctrinalClassifier } from '../_shared/doctrinal-classifier.ts';
import { hasChatAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { classifyGenerateError } from '../lamplight-generate/classify-error.ts';
import { runBibleChatPipeline } from '../lamplight-chat/bible-chat-pipeline.ts';
import { streamBibleChat, type BibleChatStreamDeps } from '../lamplight-chat/bible-chat-stream.ts';
import { buildStudyContext } from './study-context.ts';
import { STUDY_CHAT_PROMPT } from './prompts/study-chat.ts';
import { STUDY_INSIGHT_PROMPT } from './prompts/study-insight.ts';
import { parseStudyBody, type ParsedStudyBody, VALID_TRANSLATIONS, type Translation } from './parse-body.ts';
import { verifyStudyThread } from './verify-thread.ts';

export { parseStudyBody, type ParsedStudyBody };

const HISTORY_LIMIT = 10;
const NOTE_K = 4;
const CROSSREF_K = 5;

// Study runs the flagship tier; effort differs by mode. Chat streams while the
// reader waits, so it stays low to protect first-token latency; insight fires on
// passage-open with nobody typing, so it can afford to think longer. Reasoning
// tokens share the output budget, hence the raised ceilings.
const STUDY_EFFORT = { chat: 'low', insight: 'medium' } as const;
const STUDY_MAX_TOKENS = { chat: 4096, insight: 3072 } as const;

// Library excerpts per turn (design §Retrieval budgets). Chat carries a real
// question worth answering from the church's study; insight is one opening
// observation, so it takes half. 0 disables the library for a mode.
const LIBRARY_K = { chat: 4, insight: 2 } as const;

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);
  try {
    return await handleStudy(req);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleStudy(req: Request): Promise<Response> {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const voyageKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!openaiKey) return jsonResp({ error: 'OPENAI_API_KEY missing' }, 500);
  if (!voyageKey) return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

  let raw: Record<string, unknown>;
  try { raw = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }
  const parsed = parseStudyBody(raw);
  if (!parsed.ok) return jsonResp({ error: 'bad payload' }, 400);
  const { book, chapter, message, mode, includeNotes, noteIds } = parsed;
  const passageRef = `${book}.${chapter}`;

  const supabase = serviceClient();

  const userId = await deriveUserId(supabase, bearerToken(req));
  if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

  let translation: Translation = parsed.translation ?? 'BSB';
  if (!parsed.translation) {
    try {
      const { data: profilePref } = await supabase
        .from('profiles').select('bible_translation').eq('id', userId).maybeSingle();
      const pref = (profilePref as { bible_translation?: unknown } | null)?.bible_translation;
      if (typeof pref === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(pref)) {
        translation = pref as Translation;
      }
    } catch { /* non-fatal: fall through with BSB */ }
  }

  const wantsStream = req.headers.get('accept')?.includes('text/event-stream') || parsed.stream === true;

  const { data: settings, error: sErr } = await supabase
    .from('lamplight_settings').select('enabled').eq('user_id', userId).maybeSingle();
  if (sErr) return jsonResp({ error: sErr.message }, 500);
  if (!settings?.enabled) return jsonResp({ ok: false, reason: 'not_opted_in' }, 403);

  const [{ data: ent }, { data: promoRow }] = await Promise.all([
    supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
  ]);
  const tier = ((ent?.tier as LamplightTier) ?? 'none');
  const promoActive = promoRow?.value === true;
  if (!hasChatAccess({ tier, promoActive })) return jsonResp({ ok: false, reason: 'no_entitlement' }, 402);

  // B1: resume-in-place. When a thread_id is supplied, verify ownership up-front
  // (cheap, no write) and ground on the thread's STORED passage — not the body's
  // open chapter. The ownership 404 precedes the quota gate; the opt-in/entitlement
  // gates above already ran identically. A new send (no thread_id) keeps body
  // grounding and lazy upsert so quota still gates thread creation.
  let groundBook = book;
  let groundChapter = chapter;
  let groundPassageRef = passageRef;
  let resolvedThreadId: string | null = null;
  if (parsed.threadId) {
    const verified = await verifyStudyThread(supabase, { threadId: parsed.threadId, userId });
    if (!verified.ok) return jsonResp({ ok: false, reason: verified.reason }, 404);
    groundBook = verified.thread.book;
    groundChapter = verified.thread.chapter;
    groundPassageRef = verified.thread.passageRef;
    resolvedThreadId = verified.thread.threadId;
  }

  const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
  const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
  const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });
  const classifier = makeDoctrinalClassifier(llm);
  const quotaCfg = resolveQuotaLimits(Deno.env);

  // Streaming branch: SSE over the same gates + study context as the buffered
  // path. Reuses the shared streamBibleChat helper; offered_notes ride the
  // done event via extraDoneFields (captured from buildStudyContext's `offered`).
  if (wantsStream) {
    type HistoryRow = { role: 'user' | 'assistant'; content: string };
    let capturedOffered: unknown[] = [];
    const streamQuota = async (uid: string) => {
      const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.study, quotaCfg.global, { userId: uid, nowMs: Date.now() });
      return q.ok ? { ok: true as const } : { ok: false as const, reason: q.reason };
    };
    const deps: BibleChatStreamDeps = {
      cors,
      isOptedIn: async (uid) => {
        const { data } = await supabase.from('lamplight_settings').select('enabled').eq('user_id', uid).maybeSingle();
        return !!(data as { enabled?: boolean } | null)?.enabled;
      },
      hasChatAccess: async () => hasChatAccess({ tier, promoActive }),
      checkQuota: streamQuota,
      recordUsage: (row) => recordLamplightUsage(supabase, row),
      upsertThread: (firstMessage) =>
        resolvedThreadId
          ? Promise.resolve(resolvedThreadId)
          : upsertStudyThread(supabase, userId, groundBook, groundChapter, groundPassageRef, firstMessage),
      loadHistory: async (threadId) => {
        const { data } = await supabase
          .from('lamplight_chat_messages')
          .select('role, content')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT);
        return ((data ?? []) as HistoryRow[]).reverse();
      },
      persistUserMessage: async (threadId) => {
        await supabase.from('lamplight_chat_messages').insert({ thread_id: threadId, user_id: userId, role: 'user', content: message, citations: [] });
      },
      persistAssistant: async (threadId, reply, citations) => {
        await supabase.from('lamplight_chat_messages').insert({ thread_id: threadId, user_id: userId, role: 'assistant', content: reply, citations });
        await supabase.from('lamplight_chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
      },
      buildContext: async ({ history }) => {
        let retrievalQuery = message;
        if (mode === 'insight') {
          const { data: chRows } = await supabase
            .from('bible_passages').select('text')
            .like('id', `${groundBook}.${groundChapter}.%`).order('verse_start', { ascending: true }).limit(20);
          retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${groundBook} ${groundChapter}`;
        }
        const { ctx, offered } = await buildStudyContext(supabase, {
          userId, book: groundBook, chapter: groundChapter, passageRef: groundPassageRef,
          message: mode === 'insight' ? '' : message,
          retrievalQuery, history,
          includeNotes, noteIds,
          voyageDeps, rerankEnabled,
          crossRefK: CROSSREF_K, noteK: NOTE_K,
          translation,
          libraryK: LIBRARY_K[mode],
        });
        capturedOffered = offered;
        return ctx;
      },
      llm,
      prompt: mode === 'insight' ? STUDY_INSIGHT_PROMPT : STUDY_CHAT_PROMPT,
      // Streaming and buffered MUST stay on the same tier/effort — they diverged
      // once already (streaming silently ran a tier below design).
      model: 'deep',
      effort: STUDY_EFFORT[mode],
      maxTokens: STUDY_MAX_TOKENS[mode],
      classifier,
      extraDoneFields: () => ({ offered_notes: capturedOffered }),
      artifactKind: 'bible_study',
    };
    return await streamBibleChat(deps, {
      userId, mode, message, threadTitle: message || `Study of ${groundBook} ${groundChapter}`, signal: req.signal,
    });
  }

  const lifecycleDeps: GenerationLifecycleDeps = {
    checkQuota: async (uid) => {
      const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.study, quotaCfg.global, { userId: uid, nowMs: Date.now() });
      return q.ok ? { ok: true } : { ok: false, reason: q.reason };
    },
    recordUsage: (row) => recordLamplightUsage(supabase, row),
    classifyError: classifyGenerateError,
  };

  const { status, response } = await runGeneration(
    lifecycleDeps,
    { userId, artifactKind: 'bible_study' },
    async () => {
      const threadId = resolvedThreadId
        ?? await upsertStudyThread(supabase, userId, groundBook, groundChapter, groundPassageRef, message || `Study of ${groundBook} ${groundChapter}`);

      const { data: histRows } = await supabase
        .from('lamplight_chat_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      const history = ((histRows ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse();

      if (mode === 'insight' && history.length > 0) {
        return { response: { ok: true, thread_id: threadId, skipped: true }, usage: null };
      }

      let retrievalQuery = message;
      if (mode === 'insight') {
        const { data: chRows } = await supabase
          .from('bible_passages').select('text')
          .like('id', `${groundBook}.${groundChapter}.%`).order('verse_start', { ascending: true }).limit(20);
        retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${groundBook} ${groundChapter}`;
      }

      const { ctx, offered } = await buildStudyContext(supabase, {
        userId, book: groundBook, chapter: groundChapter, passageRef: groundPassageRef,
        message: mode === 'insight' ? '' : message,
        retrievalQuery, history,
        includeNotes, noteIds,
        voyageDeps, rerankEnabled,
        crossRefK: CROSSREF_K, noteK: NOTE_K,
        translation,
        libraryK: LIBRARY_K[mode],
      });

      const result = await runBibleChatPipeline({
        llm, ctx, model: 'deep',
        effort: STUDY_EFFORT[mode],
        maxTokens: STUDY_MAX_TOKENS[mode],
        prompt: mode === 'insight' ? STUDY_INSIGHT_PROMPT : STUDY_CHAT_PROMPT,
        classifier,
      });
      if (!result.ok) {
        return { response: { ok: false, reason: result.reason }, usage: result.usage };
      }

      const rows = mode === 'insight'
        ? [{ thread_id: threadId, user_id: userId, role: 'assistant', content: result.reply, citations: result.citations }]
        : [
            { thread_id: threadId, user_id: userId, role: 'user', content: message, citations: [] },
            { thread_id: threadId, user_id: userId, role: 'assistant', content: result.reply, citations: result.citations },
          ];
      await supabase.from('lamplight_chat_messages').insert(rows);
      await supabase.from('lamplight_chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);

      return {
        response: { ok: true, thread_id: threadId, reply: result.reply, citations: result.citations, offered_notes: offered },
        usage: result.usage,
      };
    },
  );
  return jsonResp(response, status);
}

async function upsertStudyThread(
  supabase: SupabaseClient, userId: string, book: string, chapter: number, passageRef: string, firstMessage: string,
): Promise<string> {
  const existing = await supabase
    .from('lamplight_chat_threads').select('id')
    .eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'study').eq('archived', false).maybeSingle();
  if (existing.data?.id) return existing.data.id as string;
  const title = firstMessage.slice(0, 80);
  const ins = await supabase
    .from('lamplight_chat_threads')
    .insert({ user_id: userId, book, chapter, passage_ref: passageRef, title, surface: 'study' })
    .select('id').single();
  if (ins.data?.id) return ins.data.id as string;
  const reread = await supabase
    .from('lamplight_chat_threads').select('id')
    .eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'study').eq('archived', false).single();
  if (reread.error || !reread.data) throw ins.error ?? reread.error ?? new Error('study thread upsert failed');
  return reread.data.id as string;
}
