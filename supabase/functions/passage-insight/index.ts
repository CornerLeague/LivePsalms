// supabase/functions/passage-insight/index.ts
// Insights Door 1 ("The Passage") — the generate path.
//
// Body: { book, chapter, verse?, translation? }
// Resp: JSON on a cache hit (200), on the entitlement gate (403), and on the
//       quota gate (429); SSE otherwise.
//
// A READ needs none of this. `bible_passage_insight` is public-read, so the
// client queries it directly, exactly as it does `bible_etymology_verse_insight`
// — this function exists only because generation needs the OpenAI key. It still
// checks the cache first, both to keep a warmed door free of every gate and to
// settle the race where two readers press "Study this passage" at once.
//
// The orchestration lives in ../lamplight-study/passage-insight-stream.ts so it
// is Node-testable; everything here is wiring.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { createOpenAIAdapter } from '../_shared/openai.ts';
import { type VoyageDeps } from '../_shared/voyage.ts';
import { makeDoctrinalClassifier } from '../_shared/doctrinal-classifier.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveQuotaLimits, supabaseQuotaDeps } from '../_shared/quota.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { makeScriptureDeps } from '../_shared/scripture-verify.ts';
import type { LamplightTier } from '../_shared/entitlement.ts';
import { streamPassageInsight, parsePassageInsightBody } from '../lamplight-study/passage-insight-stream.ts';
import { buildStudyContext } from '../lamplight-study/study-context.ts';
import { VALID_TRANSLATIONS, type Translation } from '../lamplight-study/parse-body.ts';

const CROSSREF_K = 5;
const NOTE_K = 4;

// The door carries four sections and leans on named voices throughout, so it
// takes study CHAT's library budget rather than insight's halved one.
const LIBRARY_K = 4;

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return jsonResp({ error: 'OPENAI_API_KEY missing' }, 500);
    const voyageKey = Deno.env.get('VOYAGE_AI_KEY');
    if (!voyageKey) return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

    let raw: Record<string, unknown>;
    try { raw = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }

    const parsed = parsePassageInsightBody(raw);
    if (!parsed.ok) return jsonResp({ error: 'bad payload' }, 400);

    const translation: Translation =
      typeof raw.translation === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(raw.translation)
        ? raw.translation as Translation
        : 'BSB';

    const supabase = serviceClient();

    const userId = await deriveUserId(supabase, bearerToken(req));
    if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

    const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
    const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
    const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });

    return await streamPassageInsight(
      {
        cors,
        supabase,
        llm,
        quotaDeps: supabaseQuotaDeps(supabase),
        quotaConfig: resolveQuotaLimits(Deno.env),
        getEntitlement: async (uid) => {
          const [{ data: ent }, { data: promoRow }] = await Promise.all([
            supabase.from('lamplight_entitlements').select('tier').eq('user_id', uid).maybeSingle(),
            supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
          ]);
          return {
            tier: ((ent?.tier ?? 'none') as LamplightTier),
            promoActive: promoRow?.value === true,
          };
        },
        recordUsage: (row) => recordLamplightUsage(supabase, row),
        buildContext: async () => {
          // The passage IS the prompt — there is no reader question — so the
          // retrieval query is the chapter's own text, matching study insight.
          const { data: chRows } = await supabase
            .from('bible_passages').select('text')
            .like('id', `${parsed.book}.${parsed.chapter}.%`)
            .order('verse_start', { ascending: true }).limit(20);
          const retrievalQuery =
            ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500)
            || `${parsed.book} ${parsed.chapter}`;

          const { ctx } = await buildStudyContext(supabase, {
            userId,
            book: parsed.book,
            chapter: parsed.chapter,
            passageRef: parsed.refId,
            message: '',
            retrievalQuery,
            history: [],
            // NEVER. The door is generated once and served to everyone from a
            // shared cache; one reader's notes must not reach another reader's
            // door. This is the load-bearing difference from study chat.
            includeNotes: false,
            voyageDeps,
            rerankEnabled,
            crossRefK: CROSSREF_K,
            noteK: NOTE_K,
            translation,
            libraryK: LIBRARY_K,
            // Reader-facing refs. Door 1's prose IS the product — the first live
            // eval sweep caught it printing "2ti 2:19" at readers, because the
            // model echoes back whatever ref form it was handed.
            displayRefs: true,
            ...(parsed.verse !== undefined ? { verse: parsed.verse } : {}),
          });
          return ctx;
        },
        classifier: makeDoctrinalClassifier(llm),
        verifyScripture: makeScriptureDeps(supabase, translation),
      },
      { userId, scope: parsed.scope, refId: parsed.refId, signal: req.signal },
    );
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
