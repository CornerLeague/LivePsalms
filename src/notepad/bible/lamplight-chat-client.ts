// src/notepad/bible/lamplight-chat-client.ts
import type { BibleTranslation } from './translations';

export interface ChatCitation { type: 'note' | 'verse'; ref: string }

export type InvokeFn = (
  name: string,
  options: { body: unknown },
) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface SendChatArgs { book: string; chapter: number; message: string; translation: BibleTranslation }

export type SendChatResult =
  | { ok: true; threadId: string; reply: string; citations: ChatCitation[] }
  | { ok: false; reason: string };

export async function sendChatMessage(invoke: InvokeFn, args: SendChatArgs): Promise<SendChatResult> {
  const { data, error } = await invoke('lamplight-chat', { body: { book: args.book, chapter: args.chapter, message: args.message, translation: args.translation } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; thread_id?: string; reply?: string; citations?: ChatCitation[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply ?? '', citations: d.citations ?? [] };
}

export interface RequestInsightArgs { book: string; chapter: number; translation: BibleTranslation }

/**
 * The journaling opener — one grounded observation on a passage the reader has
 * just opened and not yet asked about. Fires on every passage open.
 *
 * Sends `mode: 'opener'` (parent design §10). It sent the legacy `'insight'`
 * until the edge functions carrying `_shared/chat-mode.ts` were deployed on
 * 2026-08-07, because Vercel ships the client on merge while
 * `supabase functions deploy` is run by hand — so the client always reaches
 * production first, and a function that had not yet learned `'opener'` would
 * read it as `'chat'`, find an empty message, and return `400 bad payload` on
 * every passage open.
 *
 * ⚠️ The server's tolerance of `'insight'` is NOT dead code now that this
 * flipped, and must not be removed as such. There is no service worker, but a
 * reader with the app already open in a tab keeps whatever bundle they loaded
 * until they reload — so old clients go on sending the old spelling for as long
 * as those tabs live.
 */
export async function requestOpeningInsight(invoke: InvokeFn, args: RequestInsightArgs): Promise<SendChatResult> {
  const { data, error } = await invoke('lamplight-chat', { body: { book: args.book, chapter: args.chapter, mode: 'opener', translation: args.translation } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; skipped?: boolean; thread_id?: string; reply?: string; citations?: ChatCitation[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  if (d.skipped || typeof d.reply !== 'string') return { ok: false, reason: 'skipped' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply, citations: d.citations ?? [] };
}
