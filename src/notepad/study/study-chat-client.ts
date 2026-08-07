// src/notepad/study/study-chat-client.ts
import type { ChatCitation, InvokeFn } from '../bible/lamplight-chat-client';
import type { BibleTranslation } from '../bible/translations';

export interface OfferedNote { id: string; title: string; snippet: string }

export interface SendStudyArgs {
  book: string; chapter: number; message: string;
  includeNotes?: boolean; noteIds?: string[];
  translation?: BibleTranslation;
  threadId?: string;
}

export type SendStudyResult =
  | { ok: true; threadId: string; reply: string; citations: ChatCitation[]; offeredNotes: OfferedNote[] }
  | { ok: false; reason: string };

export async function sendStudyMessage(invoke: InvokeFn, args: SendStudyArgs): Promise<SendStudyResult> {
  const body: Record<string, unknown> = {
    book: args.book, chapter: args.chapter, message: args.message,
    include_notes: args.includeNotes ?? false,
    note_ids: args.noteIds ?? [],
    translation: args.translation,
  };
  if (args.threadId) body.thread_id = args.threadId;
  const { data, error } = await invoke('lamplight-study', { body });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply ?? '', citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}

export interface RequestStudyOpenerArgs { book: string; chapter: number; translation?: BibleTranslation }

/**
 * The study OPENER — one grounded observation on a passage the reader has just
 * opened and not yet asked about. Renamed from `requestStudyInsight` in B4:
 * "insight" had come to mean three things, and the feature called Insights is
 * one of them (parent design §10).
 *
 * STILL PARKED, deliberately. Un-parking it is a product decision rather than
 * part of a rename: it fires an unprompted, per-reader, per-open generation
 * answering "what is going on in this passage?" — which is now Door 1's
 * question, answered once and cached globally for everyone. A billed-per-open
 * opener beside a shared cached door is a call for Myles.
 *
 */
export async function requestStudyOpener(invoke: InvokeFn, args: RequestStudyOpenerArgs): Promise<SendStudyResult> {
  const { data, error } = await invoke('lamplight-study', { body: { book: args.book, chapter: args.chapter, mode: 'opener', translation: args.translation } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; skipped?: boolean; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  if (d.skipped || typeof d.reply !== 'string') return { ok: false, reason: 'skipped' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply, citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}
