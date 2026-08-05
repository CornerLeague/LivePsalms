// supabase/functions/etymology-insight/index.ts
// Generates + persists the shared per-(word, verse) etymology insight. Reads are
// pure client DB queries; ONLY generation lives here so the OpenAI key stays
// server-side. Gated on the 'inline' entitlement (Plus/promo) — see Open Decision.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { createOpenAIAdapter } from '../_shared/openai.ts';
import { fetchPassageText, formatVerseRef } from '../_shared/bible-passage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { hasInlineInsightAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { buildEtymologyInsightOutcome } from './insight-body.ts';
import { VERSE_INSIGHT_PROMPT } from './prompts/verse-insight.ts';

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return jsonResp({ error: 'OPENAI_API_KEY missing' }, 500);

    let body: { strongs?: string; verse_id?: string };
    try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }
    const strongs = typeof body.strongs === 'string' ? body.strongs : '';
    const verseId = typeof body.verse_id === 'string' ? body.verse_id : '';
    if (!strongs || !verseId) return jsonResp({ error: 'bad payload' }, 400);

    const supabase = serviceClient();

    const userId = await deriveUserId(supabase, bearerToken(req));
    if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

    const [{ data: ent }, { data: promoRow }] = await Promise.all([
      supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
      supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
    ]);
    const tier = (ent?.tier ?? 'none') as LamplightTier;
    if (!hasInlineInsightAccess({ tier, promoActive: promoRow?.value === true })) {
      return jsonResp({ error: 'inline insight requires Plus' }, 403);
    }

    const quotaCfg = resolveQuotaLimits(Deno.env);
    const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });
    const lifecycleDeps: GenerationLifecycleDeps = {
      checkQuota: async (uid) => {
        const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.generation, quotaCfg.global, { userId: uid, nowMs: Date.now() });
        return q.ok ? { ok: true } : { ok: false, reason: q.reason };
      },
      recordUsage: (row) => recordLamplightUsage(supabase, row),
      classifyError: (err) => (err instanceof Error ? err.message : 'unknown').slice(0, 64),
    };

    const { status, response } = await runGeneration(
      lifecycleDeps,
      { userId, artifactKind: 'etymology_insight' },
      () => buildEtymologyInsightOutcome(
        {
          loadExistingInsight: async (s, v) => {
            const { data } = await supabase.from('bible_etymology_verse_insight').select('body').eq('strongs', s).eq('verse_id', v).maybeSingle();
            return (data as { body?: string } | null)?.body ?? null;
          },
          loadEntry: async (s) => {
            const { data } = await supabase.from('bible_etymology')
              .select('lemma, root, root_gloss, development, related').eq('strongs', s).eq('reviewed', true).maybeSingle();
            if (!data) return null;
            const d = data as { lemma: string; root: string; root_gloss: string; development: string; related: Array<{ word: string; gloss: string }> | null };
            return { lemma: d.lemma, root: d.root, rootGloss: d.root_gloss, development: d.development, related: d.related ?? [] };
          },
          loadVerseText: async (v) => {
            const byId = await fetchPassageText(supabase as never, [v], 'BSB');
            const row = byId.get(v);
            return row ? { reference: formatVerseRef(row), text: row.text } : null;
          },
          generate: async (ctx) => {
            const out = await llm.generate<{ body: string }>({
              // Flagship tier for a ≤40-word line, but only light reasoning: the
              // facts are supplied and the job is to connect them, not derive them.
              model: 'deep', effort: 'low', system: VERSE_INSIGHT_PROMPT.system,
              messages: VERSE_INSIGHT_PROMPT.buildMessages(ctx), tool: VERSE_INSIGHT_PROMPT.tool,
            });
            return { body: out.parsed.body, modelUsed: out.modelUsed, promptTokens: out.promptTokens, completionTokens: out.completionTokens };
          },
          insertInsight: async (row) => {
            const { error } = await supabase.from('bible_etymology_verse_insight')
              .upsert(row, { onConflict: 'strongs,verse_id', ignoreDuplicates: true });
            if (error) throw new Error(error.message);
          },
          reloadInsight: async (s, v) => {
            const { data } = await supabase.from('bible_etymology_verse_insight').select('body').eq('strongs', s).eq('verse_id', v).maybeSingle();
            return (data as { body?: string } | null)?.body ?? null;
          },
        },
        { strongs, verseId, userId },
      ),
    );
    return jsonResp(response, status);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
