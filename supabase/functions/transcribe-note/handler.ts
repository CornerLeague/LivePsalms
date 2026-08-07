// supabase/functions/transcribe-note/handler.ts
import type { LLMAdapter } from '../_shared/openai.ts';
import type { VerseFlag } from '../_shared/verse-verify.ts';
import { TRANSCRIBE_SYSTEM, TRANSCRIBE_TOOL } from './prompt.ts';

export interface UncertainWord { text: string; context?: string }

export interface TranscribeResult {
  transcription: string;
  confidence: number;
  uncertainWords: UncertainWord[];
  verseFlags: VerseFlag[];
  transcription_id: string;
}

/**
 * Generic over the client so the handler stays client-agnostic — it never
 * touches `supabase`, it only hands it to the injected `verifyVerseRefs` — while
 * the two still have to AGREE.
 *
 * Both were `unknown` before, which typechecks in isolation and pairs nothing:
 * a `verifyVerseRefs` requiring a real client sat happily beside a `supabase`
 * that could be anything, and the mismatch only surfaced once the Deno shells
 * entered the typecheck. `TClient` makes the pairing the thing that is checked,
 * without the handler learning what a Supabase client is.
 */
export interface TranscribeDeps<TClient = unknown> {
  llm: LLMAdapter;
  downloadImage: (key: string) => Promise<{ base64: string; mimeType: string }>;
  verifyVerseRefs: (supabase: TClient, refs: string[]) => Promise<VerseFlag[]>;
  extractVerseRefs: (text: string) => string[];
  insertRow: (row: Record<string, unknown>) => Promise<string>;
  recordUsage: (row: {
    user_id: string; model: string; artifact_kind: string;
    tokens_in: number; tokens_out: number; status: 'ok' | 'error'; error_code?: string;
  }) => Promise<void>;
  supabase: TClient;
}

export interface TranscribeBody { image_key?: string }
export interface HandlerResponse { status: number; body: TranscribeResult | { error: string } }

export async function handleTranscribe<TClient>(
  deps: TranscribeDeps<TClient>,
  body: TranscribeBody,
  userId: string,
): Promise<HandlerResponse> {
  // Defense in depth: the caller (index.ts) derives userId from the verified JWT
  // and 401s on null, but never trust that — an empty userId would make the IDOR
  // prefix `note-scans//` and accept any double-slashed key. Refuse it here too.
  if (!userId) {
    return { status: 401, body: { error: 'unauthenticated' } };
  }
  if (typeof body.image_key !== 'string') {
    return { status: 400, body: { error: 'bad image_key' } };
  }
  // IDOR guard: key must be exactly note-scans/{userId}/{single-safe-filename}.
  // userId is the JWT-verified caller (never client-supplied). A plain
  // startsWith() is not path-aware — `..` segments would escape the user's
  // folder, and the service-role client bypasses storage RLS.
  const prefix = `note-scans/${userId}/`;
  const rest = body.image_key.startsWith(prefix) ? body.image_key.slice(prefix.length) : null;
  if (rest === null || !/^[A-Za-z0-9._-]+$/.test(rest)) {
    return { status: 403, body: { error: 'forbidden image_key' } };
  }

  const { base64, mimeType } = await deps.downloadImage(body.image_key);

  let parsed: { transcription: string; confidence: number; uncertainWords: UncertainWord[] };
  let modelUsed = 'gpt-5.6-terra';
  let tokensIn = 0, tokensOut = 0;
  try {
    const out = await deps.llm.generate<typeof parsed>({
      model: 'balanced',
      // Verbatim OCR: there is nothing to deliberate about, and reasoning tokens
      // would be spend with no quality return. Pinned rather than left to the
      // tier default so a future default change cannot silently tax scanning.
      effort: 'none',
      system: TRANSCRIBE_SYSTEM,
      maxTokens: 4096,
      tool: TRANSCRIBE_TOOL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this handwritten note.' },
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        ],
      }],
    });
    if (!out.parsed || typeof out.parsed !== 'object') {
      throw new Error('empty transcription result');
    }
    parsed = out.parsed;
    modelUsed = out.modelUsed;
    tokensIn = out.promptTokens;
    tokensOut = out.completionTokens;
  } catch (err) {
    await deps.recordUsage({
      user_id: userId, model: modelUsed, artifact_kind: 'note_transcription',
      tokens_in: 0, tokens_out: 0, status: 'error',
      error_code: err instanceof Error ? err.message.slice(0, 80) : 'llm_error',
    });
    return { status: 502, body: { error: 'transcription failed' } };
  }

  const transcription = parsed.transcription ?? '';
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const uncertainWords = Array.isArray(parsed.uncertainWords) ? parsed.uncertainWords : [];

  let verseFlags: VerseFlag[] = [];
  try {
    const refs = deps.extractVerseRefs(transcription);
    if (refs.length > 0) verseFlags = await deps.verifyVerseRefs(deps.supabase, refs);
  } catch {
    verseFlags = [];
  }

  let transcription_id: string;
  try {
    transcription_id = await deps.insertRow({
      user_id: userId,
      image_key: body.image_key,
      raw_transcription: transcription,
      confidence,
      uncertain_words: uncertainWords,
      verse_flags: verseFlags,
      model: modelUsed,
      status: 'transcribed',
    });
  } catch (err) {
    await deps.recordUsage({
      user_id: userId, model: modelUsed, artifact_kind: 'note_transcription',
      tokens_in: tokensIn, tokens_out: tokensOut, status: 'error',
      error_code: err instanceof Error ? err.message.slice(0, 80) : 'insert_error',
    });
    return { status: 500, body: { error: 'failed to save transcription' } };
  }

  await deps.recordUsage({
    user_id: userId, model: modelUsed, artifact_kind: 'note_transcription',
    tokens_in: tokensIn, tokens_out: tokensOut, status: 'ok',
  });

  return {
    status: 200,
    body: { transcription, confidence, uncertainWords, verseFlags, transcription_id },
  };
}
