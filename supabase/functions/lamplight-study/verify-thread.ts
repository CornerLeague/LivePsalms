// Ownership + grounding lookup for the resume-in-place (thread_id) path.
// Extracted from index.ts so it is vitest-testable without the Deno serve()
// shell. The thread_id path intentionally does NOT filter on `archived`:
// reopening an archived conversation from history and sending a new message is
// allowed (resume in place).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface VerifiedStudyThread {
  threadId: string;
  book: string;
  chapter: number;
  passageRef: string;
}

export async function verifyStudyThread(
  supabase: SupabaseClient,
  args: { threadId: string; userId: string },
): Promise<{ ok: true; thread: VerifiedStudyThread } | { ok: false; reason: 'thread_not_found' }> {
  const { data } = await supabase
    .from('lamplight_chat_threads')
    .select('id, book, chapter, passage_ref')
    .eq('id', args.threadId)
    .eq('user_id', args.userId)
    .eq('surface', 'study')
    .maybeSingle();
  const row = data as { id: string; book: string; chapter: number; passage_ref: string } | null;
  if (!row) return { ok: false, reason: 'thread_not_found' };
  return { ok: true, thread: { threadId: row.id, book: row.book, chapter: row.chapter, passageRef: row.passage_ref } };
}
