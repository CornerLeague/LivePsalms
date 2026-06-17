// src/notepad/study/panes/LamplightStudyPanel.tsx
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStudyChatThread } from '../useStudyChatThread';
import { useNotesOnOffer } from '../useNotesOnOffer';
import { sendStudyMessage, requestStudyInsight } from '../study-chat-client';
import type { InvokeFn } from '@/notepad/bible/lamplight-chat-client';

const invoke: InvokeFn = (name, options) =>
  supabase!.functions.invoke(name, { body: options.body as Record<string, unknown> }) as ReturnType<InvokeFn>;

export interface LamplightStudyPanelProps { book: string; chapter: number; userId: string | null }

export function LamplightStudyPanel({ book, chapter, userId }: LamplightStudyPanelProps) {
  const thread = useStudyChatThread(book, chapter, userId);
  const notes = useNotesOnOffer();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');

  const doSend = useCallback(async (message: string, includeIds: string[]) => {
    setSending(true); setError(null);
    if (!includeIds.length) {
      thread.append([{ id: `local-${Date.now()}`, role: 'user', content: message, citations: [] }]);
    }
    const res = await sendStudyMessage(invoke, {
      book, chapter, message,
      includeNotes: includeIds.length > 0,
      noteIds: includeIds,
    });
    setSending(false);
    if (!res.ok) { setError(res.reason); return; }
    thread.append([{ id: `a-${Date.now()}`, role: 'assistant', content: res.reply, citations: res.citations }]);
    notes.setOffered(res.offeredNotes);
  }, [book, chapter, thread, notes]);

  const send = useCallback(async () => {
    const m = draft.trim();
    if (!m) return;
    setDraft(''); setLastMessage(m); notes.reset();
    await doSend(m, []);
  }, [draft, doSend, notes]);

  const bringInNote = useCallback(async (id: string) => {
    notes.includeNote(id);
    await doSend(lastMessage, [...notes.includedIds, id]);
  }, [doSend, lastMessage, notes]);

  // requestStudyInsight is available for future use (e.g. opening insight button)
  void requestStudyInsight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {thread.messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--silica)', marginBottom: 2 }}>{m.role === 'user' ? 'You' : 'Lamplight Study'}</div>
            <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        {notes.offered.length > 0 && (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--lamplight-accent)', fontSize: 12 }}>
            <div style={{ marginBottom: 6, color: 'var(--deep-umber)' }}>
              You have {notes.offered.length} note{notes.offered.length === 1 ? '' : 's'} touching this — bring them in?
            </div>
            {notes.offered.map((o) => (
              <button key={o.id} onClick={() => void bringInNote(o.id)}
                style={{ display: 'block', textAlign: 'left', width: '100%', marginBottom: 4, padding: '4px 8px', background: 'transparent', border: 'none', color: 'var(--lamplight-accent)', cursor: 'pointer' }}>
                + {o.title}
              </button>
            ))}
          </div>
        )}
        {error && <div style={{ color: '#b00', fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>
      <div style={{ borderTop: '1px solid var(--pale-stone)', padding: 12, display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask Lamplight Study about this passage…"
          style={{ flex: 1, fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pale-stone)' }}
        />
        <button
          aria-label="Send"
          onClick={() => void send()}
          disabled={sending}
          style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: 'var(--lamplight-accent)', color: '#fff', cursor: 'pointer' }}>
          Send
        </button>
      </div>
    </div>
  );
}
