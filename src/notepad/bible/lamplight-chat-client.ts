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

export async function requestOpeningInsight(invoke: InvokeFn, args: RequestInsightArgs): Promise<SendChatResult> {
  const { data, error } = await invoke('lamplight-chat', { body: { book: args.book, chapter: args.chapter, mode: 'insight', translation: args.translation } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; skipped?: boolean; thread_id?: string; reply?: string; citations?: ChatCitation[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  if (d.skipped || typeof d.reply !== 'string') return { ok: false, reason: 'skipped' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply, citations: d.citations ?? [] };
}
