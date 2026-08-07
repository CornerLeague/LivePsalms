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

/** See the note on `requestOpeningInsight`. */
const LEGACY_OPENER_MODE = 'insight';

export interface RequestInsightArgs { book: string; chapter: number; translation: BibleTranslation }

/**
 * ⚠️ The wire value is still the LEGACY `'insight'`, on purpose.
 *
 * The mode is called `opener` everywhere else now (parent design §10) and both
 * edge functions accept either spelling — see `_shared/chat-mode.ts`. But the
 * client and the functions do not deploy together: Vercel ships the client
 * automatically on merge, while `supabase functions deploy` is run by hand. So
 * the client reaches production FIRST, and a deployed function that predates
 * this branch would read `'opener'` as `'chat'`, find an empty message, and
 * return `400 bad payload` — on every journaling passage open, for every
 * reader.
 *
 * Keeping the old spelling here makes the ordering a property of the code
 * rather than something an operator has to remember. Flip it to `'opener'` in a
 * follow-up once both functions are deployed; nothing breaks either way at that
 * point, which is the whole reason the tolerance exists.
 */
export async function requestOpeningInsight(invoke: InvokeFn, args: RequestInsightArgs): Promise<SendChatResult> {
  const { data, error } = await invoke('lamplight-chat', { body: { book: args.book, chapter: args.chapter, mode: LEGACY_OPENER_MODE, translation: args.translation } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; skipped?: boolean; thread_id?: string; reply?: string; citations?: ChatCitation[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  if (d.skipped || typeof d.reply !== 'string') return { ok: false, reason: 'skipped' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply, citations: d.citations ?? [] };
}
