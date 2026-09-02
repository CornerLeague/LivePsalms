// supabase/functions/bible-text/index.ts
//
// One chapter of an api-sourced Bible translation (NLT, ESV), fetched from the
// publisher and returned as { verse, text } rows. The publisher keys stay here:
// ESV_API_KEY and NLT_API_KEY are read from the function's secrets, never
// shipped to the browser.
//
// Req:  POST { book: "psa", chapter: 23, translation: "NLT" | "ESV" }
// Resp: { ok: true, verses: [{ verse, text }], translation, book, chapter }
//     | { ok: false, reason, translation, book, chapter }   (HTTP 200)
//     | { error }                                           (400 / 405 / 500)
//
// Soft failures (missing key, rate limit, provider down, empty chapter) are
// HTTP 200 with ok:false on purpose: supabase-js collapses any non-2xx into
// "Edge Function returned a non-2xx status code", and the reader needs the
// reason to say something useful and offer a retry.
//
// NEVER persists: no Postgres client is even imported. The ESV free licence
// forbids storing more than 500 verses locally; the browser caches a handful
// of chapters in session memory and nothing else.
//
// Trust model: deployed WITH JWT verification (platform default, pinned in
// config.toml). The publishers' daily quotas are shared by every reader of
// this deployment, so only signed-in users spend them.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { fetchChapter, isApiTranslation } from '../_shared/bible-text-providers.ts';
import { NLT_BOOKS } from '../_shared/nlt-book-codes.ts';

const MAX_CHAPTER = 150;

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);

  let body: { book?: unknown; chapter?: unknown; translation?: unknown };
  try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }

  const translation = body.translation;
  if (!isApiTranslation(translation)) return jsonResp({ error: 'translation is not api-sourced' }, 400);
  const book = typeof body.book === 'string' ? body.book.trim().toLowerCase() : '';
  if (!book || !(book in NLT_BOOKS)) return jsonResp({ error: 'unknown book' }, 400);
  const chapter = body.chapter;
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 1 || chapter > MAX_CHAPTER) {
    return jsonResp({ error: 'bad chapter' }, 400);
  }

  try {
    const result = await fetchChapter(translation, book, chapter, { fetch, env: Deno.env });
    if (!result.ok) console.warn(`[bible-text] ${translation} ${book}.${chapter}: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`);
    return jsonResp({ ...result, translation, book, chapter });
  } catch (err) {
    return jsonResp({ error: String(err) }, 500);
  }
});
