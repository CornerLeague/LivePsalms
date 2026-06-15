// supabase/functions/verse-search/index.ts
//
// Thin semantic-search seam for the /verse picker. Embeds an arbitrary query
// (Voyage, server-side key) and returns bible_passage matches from the
// match_bible_embeddings pgvector RPC. No persistence, no LLM.
//
// Trust model: deployed WITH JWT verification (platform default; do NOT pass
// --no-verify-jwt). Only authenticated callers reach Voyage, which protects the
// embedding budget. Anonymous users fall back to FTS + reference in the client.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { embedQuery } from '../_shared/voyage.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';

const DEFAULT_LIMIT = 30;

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);

  const apiKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!apiKey) return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

  let body: { query?: string; limit?: number };
  try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }

  const query = (body.query ?? '').trim().slice(0, 500);
  if (!query) return jsonResp({ matches: [] });
  const limit = Math.min(Math.max(body.limit ?? DEFAULT_LIMIT, 1), 50);

  try {
    const vector = await embedQuery(query, { apiKey, fetch });
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc('match_bible_embeddings', {
      p_query_vector: vector,
      p_limit: limit,
    });
    if (error) return jsonResp({ error: error.message }, 500);

    const matches = ((data ?? []) as Array<{ source_id: string; chunk_text: string; similarity: number }>)
      .map((r) => ({ sourceId: r.source_id, text: r.chunk_text, similarity: r.similarity }));
    return jsonResp({ matches });
  } catch (err) {
    return jsonResp({ error: String(err) }, 500);
  }
});
