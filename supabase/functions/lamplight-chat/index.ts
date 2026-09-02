// supabase/functions/lamplight-chat/index.ts
// Bible-study chat endpoint. Mirrors lamplight-generate's envelope.
// Body: { book: string, chapter: number, message: string }
// Resp: { ok: true, thread_id, reply, citations } | { ok: false, reason }

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
import { isValidTranslation, type Translation } from '../_shared/bible-translations.ts';
import { makeScriptureDeps } from '../_shared/scripture-verify.ts';
import { parseChatMode } from '../_shared/chat-mode.ts';
import { classifyGenerateError } from '../lamplight-generate/classify-error.ts';
import { runBibleChatPipeline } from './bible-chat-pipeline.ts';
import { buildChatContext } from './chat-context.ts';
import { BIBLE_OPENER_PROMPT } from './prompts/bible-opener.ts';
import { streamBibleChat, type BibleChatStreamDeps } from './bible-chat-stream.ts';

const HISTORY_LIMIT = 10;

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);
  try {
    return await handleChat(req);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleChat(req: Request): Promise<Response> {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const voyageKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!openaiKey) return jsonResp({ error: 'OPENAI_API_KEY missing' }, 500);
  if (!voyageKey) return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

  let body: { book?: string; chapter?: number; message?: string; mode?: string; translation?: string; stream?: boolean };
  try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }
  const mode = parseChatMode(body.mode);
  const wantsStream = req.headers.get('accept')?.includes('text/event-stream') || body.stream === true;

  const translation: Translation = isValidTranslation(body.translation) ? body.translation : 'BSB';
  if (typeof body.book !== 'string' || typeof body.chapter !== 'number') {
    return jsonResp({ error: 'bad payload' }, 400);
  }
  if (mode === 'chat' && (typeof body.message !== 'string' || !body.message.trim())) {
    return jsonResp({ error: 'bad payload' }, 400);
  }
  const book = body.book;
  const chapter = body.chapter;
  const message = (body.message ?? '').trim().slice(0, 2000);
  const passageRef = `${book}.${chapter}`;

  const supabase = serviceClient();

  // Identity from the verified JWT.
  const userId = await deriveUserId(supabase, bearerToken(req));
  if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

  // Opt-in gate (same as lamplight-generate).
  const { data: settings, error: sErr } = await supabase
    .from('lamplight_settings').select('enabled').eq('user_id', userId).maybeSingle();
  if (sErr) return jsonResp({ error: sErr.message }, 500);
  if (!settings?.enabled) return jsonResp({ ok: false, reason: 'not_opted_in' }, 403);

  // Entitlement gate (chat = plus or active promo).
  const [{ data: ent }, { data: promoRow }] = await Promise.all([
    supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
  ]);
  const tier = ((ent?.tier as LamplightTier) ?? 'none');
  const promoActive = promoRow?.value === true;
  if (!hasChatAccess({ tier, promoActive })) return jsonResp({ ok: false, reason: 'no_entitlement' }, 402);

  const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
  const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
  const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });
  const classifier = makeDoctrinalClassifier(llm);
  const quotaCfg = resolveQuotaLimits(Deno.env);

  const lifecycleDeps: GenerationLifecycleDeps = {
    checkQuota: async (uid) => {
      const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.generation, quotaCfg.global, { userId: uid, nowMs: Date.now() });
      return q.ok ? { ok: true } : { ok: false, reason: q.reason };
    },
    recordUsage: (row) => recordLamplightUsage(supabase, row),
    classifyError: classifyGenerateError,
  };

  // Streaming branch: SSE over the same gates + pipeline as the buffered path.
  // The module re-checks opt-in/entitlement/quota so the seam is independently
  // testable; the buffered gates above are harmless redundancy.
  if (wantsStream) {
    type HistoryRow = { role: 'user' | 'assistant'; content: string };
    const buildStreamDeps = (): BibleChatStreamDeps => ({
      cors,
      isOptedIn: async (uid) => {
        const { data } = await supabase.from('lamplight_settings').select('enabled').eq('user_id', uid).maybeSingle();
        return !!data?.enabled;
      },
      hasChatAccess: async () => hasChatAccess({ tier, promoActive }),
      checkQuota: lifecycleDeps.checkQuota,
      recordUsage: (row) => recordLamplightUsage(supabase, row),
      upsertThread: (firstMessage) => upsertThread(supabase, userId, book, chapter, passageRef, firstMessage),
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
        if (mode === 'opener') {
          const { data: chRows } = await supabase
            .from('bible_passages')
            .select('text')
            .like('id', `${book}.${chapter}.%`)
            .order('verse_start', { ascending: true })
            .limit(20);
          retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${book} ${chapter}`;
        }
        return buildChatContext(supabase, {
          userId, book, chapter, passageRef,
          message: mode === 'opener' ? '' : message,
          retrievalQuery, history, voyageDeps, rerankEnabled, translation,
          // Reader-facing refs. The model prints back whatever form it is
          // handed, and this builder was handing it the OSIS key.
          displayRefs: true,
        });
      },
      llm,
      prompt: mode === 'opener' ? BIBLE_OPENER_PROMPT : undefined,
      classifier,
      verifyScripture: makeScriptureDeps(supabase, translation),
    });
    return await streamBibleChat(buildStreamDeps(), {
      userId, mode, message, threadTitle: message || `Study of ${book} ${chapter}`, signal: req.signal,
    });
  }

  const { status, response } = await runGeneration(
    lifecycleDeps,
    { userId, artifactKind: 'bible_chat' },
    async () => {
      // 1. Load-or-create the thread for this passage.
      const threadId = await upsertThread(supabase, userId, book, chapter, passageRef, message || `Study of ${book} ${chapter}`);

      // 2. Load existing messages (oldest→newest).
      const { data: histRows } = await supabase
        .from('lamplight_chat_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      const history = ((histRows ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse();

      // The opener only fires on an empty thread — refuse otherwise (idempotent, no cost).
      if (mode === 'opener' && history.length > 0) {
        return { response: { ok: true, thread_id: threadId, skipped: true }, usage: null };
      }

      // 3. Fetch the open chapter once so the opener can seed retrieval from its text.
      //    (buildChatContext fetches it again for allowed refs; acceptable for V1.)
      let retrievalQuery = message;
      if (mode === 'opener') {
        const { data: chRows } = await supabase
          .from('bible_passages')
          .select('text')
          .like('id', `${book}.${chapter}.%`)
          .order('verse_start', { ascending: true })
          .limit(20);
        retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${book} ${chapter}`;
      }

      // 4. Build context + run the right prompt.
      const ctx = await buildChatContext(supabase, {
        userId, book, chapter, passageRef,
        message: mode === 'opener' ? '' : message,
        retrievalQuery,
        history,
        voyageDeps, rerankEnabled, translation,
        // See the streaming path above; the two must not diverge.
        displayRefs: true,
      });
      const result = await runBibleChatPipeline({
        llm, ctx,
        prompt: mode === 'opener' ? BIBLE_OPENER_PROMPT : undefined,
        classifier,
        verifyScripture: makeScriptureDeps(supabase, translation),
      });
      if (!result.ok) {
        return { response: { ok: false, reason: result.reason }, usage: result.usage };
      }

      // 5. Persist. Insight = one assistant message; chat = user + assistant.
      const rows = mode === 'opener'
        ? [{ thread_id: threadId, user_id: userId, role: 'assistant', content: result.reply, citations: result.citations }]
        : [
            { thread_id: threadId, user_id: userId, role: 'user', content: message, citations: [] },
            { thread_id: threadId, user_id: userId, role: 'assistant', content: result.reply, citations: result.citations },
          ];
      await supabase.from('lamplight_chat_messages').insert(rows);
      await supabase.from('lamplight_chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);

      return { response: { ok: true, thread_id: threadId, reply: result.reply, citations: result.citations }, usage: result.usage };
    },
  );
  return jsonResp(response, status);
}

async function upsertThread(
  supabase: SupabaseClient, userId: string, book: string, chapter: number, passageRef: string, firstMessage: string,
): Promise<string> {
  const existing = await supabase
    .from('lamplight_chat_threads').select('id').eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'chat').eq('archived', false).maybeSingle();
  if (existing.data?.id) return existing.data.id as string;
  const title = firstMessage.slice(0, 80);
  const ins = await supabase
    .from('lamplight_chat_threads')
    .insert({ user_id: userId, book, chapter, passage_ref: passageRef, title })
    .select('id').single();
  if (ins.data?.id) return ins.data.id as string;
  // Race: re-read.
  const reread = await supabase
    .from('lamplight_chat_threads').select('id').eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'chat').eq('archived', false).single();
  if (reread.error || !reread.data) throw ins.error ?? reread.error ?? new Error('thread upsert failed');
  return reread.data.id as string;
}

