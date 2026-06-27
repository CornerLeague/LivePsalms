// supabase/functions/lamplight-study/index.ts
// Lamplight Study chat (Opus). Sibling of lamplight-chat. Mirrors its gates and
// envelope; grounds in apparatus data; offers (never auto-injects) notes.
// Body: { book, chapter, message?, mode?, include_notes?, note_ids? }
// Resp: { ok, thread_id, reply, citations, offered_notes } | { ok, thread_id, skipped } | { ok:false, reason }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../_shared/supabase.ts';
import { type VoyageDeps } from '../_shared/voyage.ts';
import { createAnthropicAdapter } from '../_shared/anthropic.ts';
import { hasChatAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { classifyGenerateError } from '../lamplight-generate/classify-error.ts';
import { runBibleChatPipeline } from '../lamplight-chat/bible-chat-pipeline.ts';
import { buildStudyContext } from './study-context.ts';
import { STUDY_CHAT_PROMPT } from './prompts/study-chat.ts';
import { STUDY_INSIGHT_PROMPT } from './prompts/study-insight.ts';
import { parseStudyBody, type ParsedStudyBody, VALID_TRANSLATIONS, type Translation } from './parse-body.ts';

export { parseStudyBody, type ParsedStudyBody };

const HISTORY_LIMIT = 10;
const NOTE_K = 4;
const CROSSREF_K = 5;

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

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const voyageKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!anthropicKey) return jsonResp({ error: 'ANTHROPIC_API_KEY missing' }, 500);
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

  const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
  const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
  const llm = createAnthropicAdapter({ apiKey: anthropicKey, fetch });
  const quotaCfg = resolveQuotaLimits(Deno.env);

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
      const threadId = await upsertStudyThread(supabase, userId, book, chapter, passageRef, message || `Study of ${book} ${chapter}`);

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
          .like('id', `${book}.${chapter}.%`).order('verse_start', { ascending: true }).limit(20);
        retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${book} ${chapter}`;
      }

      const { ctx, offered } = await buildStudyContext(supabase, {
        userId, book, chapter, passageRef,
        message: mode === 'insight' ? '' : message,
        retrievalQuery, history,
        includeNotes, noteIds,
        voyageDeps, rerankEnabled,
        crossRefK: CROSSREF_K, noteK: NOTE_K,
        translation,
      });

      const result = await runBibleChatPipeline({
        llm, ctx, model: 'opus',
        prompt: mode === 'insight' ? STUDY_INSIGHT_PROMPT : STUDY_CHAT_PROMPT,
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
