// src/notepad/study/study-chat-client.ts
import type { ChatCitation, InvokeFn } from '../bible/lamplight-chat-client';

export interface OfferedNote { id: string; title: string; snippet: string }

export interface SendStudyArgs {
  book: string; chapter: number; message: string;
  includeNotes?: boolean; noteIds?: string[];
}

export type SendStudyResult =
  | { ok: true; threadId: string; reply: string; citations: ChatCitation[]; offeredNotes: OfferedNote[] }
  | { ok: false; reason: string };

export async function sendStudyMessage(invoke: InvokeFn, args: SendStudyArgs): Promise<SendStudyResult> {
  const { data, error } = await invoke('lamplight-study', {
    body: {
      book: args.book, chapter: args.chapter, message: args.message,
      include_notes: args.includeNotes ?? false,
      note_ids: args.noteIds ?? [],
    },
  });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply ?? '', citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}

export interface RequestStudyInsightArgs { book: string; chapter: number }

export async function requestStudyInsight(invoke: InvokeFn, args: RequestStudyInsightArgs): Promise<SendStudyResult> {
  const { data, error } = await invoke('lamplight-study', { body: { book: args.book, chapter: args.chapter, mode: 'insight' } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; skipped?: boolean; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  if (d.skipped || typeof d.reply !== 'string') return { ok: false, reason: 'skipped' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply, citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}
