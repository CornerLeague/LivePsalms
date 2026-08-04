// supabase/functions/transcribe-note/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { createOpenAIAdapter } from '../_shared/openai.ts';
import { verifyVerseRefs } from '../_shared/verse-verify.ts';
import { extractVerseRefsFromNoteContent } from '../_shared/note-signals.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { handleTranscribe } from './handler.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const OPENAI_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Prefer the stored blob's content-type; fall back to the key's extension so a
// PNG/WebP isn't mislabeled as JPEG (which OpenAI would reject).
function mimeFromKey(key: string, blobType: string): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

// extractVerseRefsFromNoteContent expects TipTap JSON; wrap plain transcription
// text into a one-paragraph doc so we can reuse the canonical extractor.
function extractVerseRefsFromText(text: string): string[] {
  const doc = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  return extractVerseRefsFromNoteContent(doc);
}

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);
  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return jsonResp({ error: 'OPENAI_API_KEY missing' }, 500);

    let body: { image_key?: string };
    try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }

    const supabase = serviceClient();

    // Identity from the verified JWT, never from the request body.
    const userId = await deriveUserId(supabase, bearerToken(req));
    if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

    // Transcription quota — a separate bucket from generation (counts only
    // note_transcription rows). A count error throws and is surfaced as a 500
    // by the top-level catch (fail closed). Every call that reaches the model
    // records exactly one usage row, so the count is reliable.
    const cfg = resolveQuotaLimits(Deno.env);
    const quota = await checkQuota(supabaseQuotaDeps(supabase), cfg.transcription, cfg.global, { userId, nowMs: Date.now() });
    if (!quota.ok) return jsonResp({ error: 'quota_exceeded', reason: quota.reason }, 429);

    const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });

    const res = await handleTranscribe({
      llm,
      supabase,
      extractVerseRefs: extractVerseRefsFromText,
      verifyVerseRefs,
      downloadImage: async (key) => {
        const { data, error } = await supabase.storage.from('note-scans').download(key.replace(/^note-scans\//, ''));
        if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`);
        const buf = new Uint8Array(await data.arrayBuffer());
        if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('image exceeds 10 MB limit');
        const mime = mimeFromKey(key, data.type);
        if (!OPENAI_IMAGE_MIME.has(mime)) throw new Error(`unsupported image type: ${mime}`);
        return { base64: encodeBase64(buf), mimeType: mime };
      },
      insertRow: async (row) => {
        const { data, error } = await supabase.from('note_transcriptions').insert(row).select('id').single();
        if (error) throw new Error(error.message);
        return data!.id as string;
      },
      recordUsage: (usageRow) => recordLamplightUsage(supabase, usageRow),
    }, body, userId);

    return jsonResp(res.body, res.status);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
