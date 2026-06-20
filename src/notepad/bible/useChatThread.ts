// src/notepad/bible/useChatThread.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ChatCitation } from './lamplight-chat-client';

export interface ChatThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
}

export interface UseChatThreadResult {
  messages: ChatThreadMessage[];
  loading: boolean;
  error: string | null;
  /** Append messages locally (after a send) without a re-fetch. */
  append: (msgs: ChatThreadMessage[]) => void;
  reload: () => void;
  /** Archive the active thread for this passage, then reload (becomes empty). */
  archiveAndReset: () => Promise<void>;
}

export function useChatThread(book: string, chapter: number, userId: string | null): UseChatThreadResult {
  const [messages, setMessages] = useState<ChatThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const passageRef = `${book}.${chapter}`;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const append = useCallback((msgs: ChatThreadMessage[]) => setMessages((prev) => [...prev, ...msgs]), []);

  const archiveAndReset = useCallback(async () => {
    if (!supabase || !userId) return;
    const { error: archiveErr } = await supabase
      .from('lamplight_chat_threads')
      .update({ archived: true })
      .eq('user_id', userId)
      .eq('passage_ref', passageRef)
      .eq('surface', 'chat')
      .eq('archived', false);
    // If the archive write fails, surface it and keep the current conversation
    // rather than clearing it (a reload would re-fetch the still-active thread).
    if (archiveErr) { setError(archiveErr.message); return; }
    setError(null);
    setMessages([]);
    setNonce((n) => n + 1);
  }, [userId, passageRef]);

  useEffect(() => {
    let cancelled = false;
    // Reset to a loading state whenever the passage/user changes. Mirrors the
    // sibling useBiblePassages effect; the synchronous reset is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setMessages([]);

    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    (async () => {
      const thread = await supabase
        .from('lamplight_chat_threads')
        .select('id')
        .eq('user_id', userId)
        .eq('passage_ref', passageRef)
        .eq('surface', 'chat')
        .eq('archived', false)
        .maybeSingle();
      if (cancelled) return;
      if (thread.error) { setError(thread.error.message); setLoading(false); return; }
      const threadId = (thread.data as { id?: string } | null)?.id;
      if (!threadId) { setMessages([]); setLoading(false); return; }

      const { data, error: mErr } = await supabase
        .from('lamplight_chat_messages')
        .select('id, role, content, citations')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (mErr) { setError(mErr.message); setMessages([]); }
      else setMessages((data ?? []) as ChatThreadMessage[]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [passageRef, userId, nonce]);

  return { messages, loading, error, append, reload, archiveAndReset };
}
