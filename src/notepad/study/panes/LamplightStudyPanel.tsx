// src/notepad/study/panes/LamplightStudyPanel.tsx
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStudyChatThread } from '../useStudyChatThread';
import { useNotesOnOffer } from '../useNotesOnOffer';
import { sendStudyMessage, requestStudyInsight } from '../study-chat-client';
import type { InvokeFn } from '@/notepad/bible/lamplight-chat-client';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';

const invoke: InvokeFn = (name, options) =>
  supabase!.functions.invoke(name, { body: options.body as Record<string, unknown> }) as ReturnType<InvokeFn>;

// The edge function requires an authenticated user and returns 401 otherwise,
// which supabase-js surfaces as the opaque "Edge Function returned a non-2xx
// status code". Map known reasons to something a reader can act on.
function friendlyError(reason: string): string {
  const r = (reason || '').toLowerCase();
  if (r.includes('non-2xx') || r.includes('unauthorized') || r.includes('401') || r.includes('jwt')) {
    return 'Please sign in to use Lamplight Study.';
  }
  if (r === 'not_opted_in') {
    return 'Turn on Lamplight Study in your settings to start chatting.';
  }
  return 'Something went wrong. Please try again.';
}

export interface LamplightStudyPanelProps { book: string; chapter: number; userId: string | null }

export function LamplightStudyPanel({ book, chapter, userId }: LamplightStudyPanelProps) {
  const { translation } = useBiblePrefs();
  const thread = useStudyChatThread(book, chapter, userId);
  const notes = useNotesOnOffer();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  const signedIn = !!userId;

  const doSend = useCallback(async (message: string, includeIds: string[]) => {
    setSending(true); setError(null);
    if (!includeIds.length) {
      thread.append([{ id: `local-${Date.now()}`, role: 'user', content: message, citations: [] }]);
    }
    const res = await sendStudyMessage(invoke, {
      book, chapter, message,
      includeNotes: includeIds.length > 0,
      noteIds: includeIds,
      translation,
    });
    setSending(false);
    if (!res.ok) { setError(friendlyError(res.reason)); return; }
    thread.append([{ id: `a-${Date.now()}`, role: 'assistant', content: res.reply, citations: res.citations }]);
    notes.setOffered(res.offeredNotes);
  }, [book, chapter, translation, thread, notes]);

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
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column' }}>
        {!thread.loading && thread.messages.length === 0 && notes.offered.length === 0 && !error && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--silica)', fontSize: 13, padding: 24 }}>
            {signedIn ? 'Start a conversation to dive into the Word.' : 'Sign in to use Lamplight Study.'}
          </div>
        )}
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
          disabled={!signedIn}
          placeholder={signedIn ? 'Ask Lamplight Study about this passage…' : 'Sign in to use Lamplight Study'}
          style={{
            flex: 1,
            fontSize: 13,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--pale-stone)',
            background: signedIn ? undefined : 'rgba(0,0,0,0.03)',
            cursor: signedIn ? undefined : 'not-allowed',
          }}
        />
        <button
          aria-label="Send"
          onClick={() => void send()}
          disabled={sending || !signedIn}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--lamplight-accent)',
            color: '#fff',
            opacity: sending || !signedIn ? 0.5 : 1,
            cursor: sending || !signedIn ? 'not-allowed' : 'pointer',
          }}>
          Send
        </button>
      </div>
    </div>
  );
}
