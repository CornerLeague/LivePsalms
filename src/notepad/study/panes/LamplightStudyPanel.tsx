// src/notepad/study/panes/LamplightStudyPanel.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, History as HistoryIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useStudyChatThread } from '../useStudyChatThread';
import { useStudyChatHistory } from '../useStudyChatHistory';
import { useNotesOnOffer } from '../useNotesOnOffer';
import { sendStudyMessage, requestStudyInsight } from '../study-chat-client';
import type { OfferedNote } from '../study-chat-client';
import { makeStudyStreamInvoke, type StudySseEvent } from '../study-stream-client';
import type { ChatCitation, InvokeFn } from '@/notepad/bible/lamplight-chat-client';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { formatHistoryLabel, formatPassageLabel } from '../history-label';
import { StudyChatWaiting } from './StudyChatWaiting';
import { useApplyHandoff, type StudyHandoff } from '../insights/study-handoff';

const invoke: InvokeFn = (name, options) =>
  supabase!.functions.invoke(name, { body: options.body as Record<string, unknown> }) as ReturnType<InvokeFn>;

const STREAM_INTERRUPTED = "Lamplight's reply was interrupted. Your message was saved — please try again.";

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

function AssistantRow({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div data-role="assistant" {...(streaming ? { 'data-streaming': 'true' } : {})} style={{ marginBottom: 20, display: 'flex' }}>
      <div
        data-testid="lamplight-accent-bar"
        style={{ width: 2, alignSelf: 'stretch', background: 'var(--lamplight-accent)', borderRadius: 1, flexShrink: 0 }}
      />
      <div style={{ paddingLeft: 10, flex: 1 }}>
        <div style={{ fontSize: 10, color: 'var(--silica)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Lamplight</div>
        <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>
          {content}
          {streaming && (
            <span aria-hidden style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 2, verticalAlign: 'text-bottom', background: 'var(--lamplight-accent)', animation: 'lamplight-caret 1s steps(1) infinite' }} />
          )}
        </div>
      </div>
    </div>
  );
}

export interface LamplightStudyPanelProps {
  book: string;
  chapter: number;
  userId: string | null;
  /**
   * A seeded prompt handed over from an Insights section footer (design §2).
   * Prefills the draft and NEVER sends — the reader stays the author.
   */
  handoff?: StudyHandoff | null;
}

type StudySelection =
  | { mode: 'passage' }
  | { mode: 'thread'; threadId: string; book: string; chapter: number };

export function LamplightStudyPanel({ book, chapter, userId, handoff = null }: LamplightStudyPanelProps) {
  const { translation } = useBiblePrefs();
  const [selection, setSelection] = useState<StudySelection>({ mode: 'passage' });
  const [showHistory, setShowHistory] = useState(false);
  const selectedThreadId = selection.mode === 'thread' ? selection.threadId : undefined;
  const groundBook = selection.mode === 'thread' ? selection.book : book;
  const groundChapter = selection.mode === 'thread' ? selection.chapter : chapter;
  // book/chapter (reader's passage) drive archiveAndReset; selectedThreadId loads a reopened thread.
  const thread = useStudyChatThread(book, chapter, userId, selectedThreadId);
  const history = useStudyChatHistory(userId);
  const { reload: reloadHistory } = history; // stable useCallback — safe to depend on directly
  const notes = useNotesOnOffer();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  const streamInvoke = useMemo(() => (supabase ? makeStudyStreamInvoke(supabase) : null), []);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const signedIn = !!userId;

  // Reader navigation drops any reopened thread and returns to the open chapter.
  useEffect(() => {
    setSelection({ mode: 'passage' });
    setShowHistory(false);
  }, [book, chapter]);

  // ── The Insights handoff ────────────────────────────────────────────────
  // A seeded prompt from a section footer lands here. It prefills and does not
  // send: decision 7 keeps the reader the author of their question.
  //
  // ⚠️ The selection reset is the load-bearing line. groundBook/groundChapter
  // come from the SELECTION, not the props, so if the reader has reopened a
  // history thread on another passage, a seeded prompt about Psalm 27 would
  // ground on that thread's chapter and append to that thread — breaking the
  // one thing decision 7 actually settles ("appends to the passage's existing
  // thread"). It only reproduces when the reader has been in history first,
  // which is why it is pinned by test rather than left to review.
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFocusRef = useRef(false);

  useApplyHandoff(handoff, (h) => {
    setSelection({ mode: 'passage' });
    setShowHistory(false);
    setError(null);
    setDraft(h.text);
    pendingFocusRef.current = true;
  });

  // Focus after the draft renders, so the caret lands at the end of the seeded
  // text rather than wherever the old value left it. Keyed on the handoff and
  // not on the draft: pressing the same prompt twice is a no-op `setDraft`,
  // which would skip a re-render and never fire a draft-keyed effect. The flag
  // is what keeps a remount carrying a stale handoff from stealing focus —
  // useApplyHandoff declines to apply it, so the flag is never set.
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [handoff]);

  const bufferedSend = useCallback(async (message: string, includeIds: string[]) => {
    const res = await sendStudyMessage(invoke, {
      book: groundBook, chapter: groundChapter, message,
      includeNotes: includeIds.length > 0,
      noteIds: includeIds,
      translation,
      threadId: selectedThreadId,
    });
    if (!res.ok) { setError(friendlyError(res.reason)); return; }
    thread.append([{ id: `a-${Date.now()}`, role: 'assistant', content: res.reply, citations: res.citations }]);
    notes.setOffered(res.offeredNotes);
    reloadHistory(); // a successful send creates/touches a thread server-side → keep the list in sync
  }, [groundBook, groundChapter, translation, selectedThreadId, thread, notes, reloadHistory]);

  const doSend = useCallback(async (message: string, includeIds: string[]) => {
    setSending(true); setError(null);
    try {
      if (!includeIds.length) {
        thread.append([{ id: `local-${Date.now()}`, role: 'user', content: message, citations: [] }]);
      }

      if (!streamInvoke) {
        await bufferedSend(message, includeIds);
        return;
      }

      setStreamingContent('');
      let content = '';
      let started = false;
      type DonePayload = { reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] };
      const state = { donePayload: null as DonePayload | null, errorShown: false };
      const onEvent = (ev: StudySseEvent) => {
        switch (ev.t) {
          case 'text':
            if (ev.field !== 'reply') break;
            content += ev.delta;
            setStreamingContent(content);
            break;
          case 'done':
            state.donePayload = (ev.payload ?? {}) as DonePayload;
            break;
          case 'error':
            // Terminal error beat. Surface a server-reason-specific message and mark it
            // shown so the post-stream gate doesn't overwrite it with the generic one.
            state.errorShown = true;
            setError(ev.reason ? friendlyError(ev.reason) : STREAM_INTERRUPTED);
            break;
          // stage / piece / refining are ignored for the Study refined-flat view
        }
      };

      try {
        await streamInvoke(
          { book: groundBook, chapter: groundChapter, message, includeNotes: includeIds.length > 0, noteIds: includeIds, translation, threadId: selectedThreadId },
          { onEvent, onStart: () => { started = true; } },
        );
      } catch {
        setStreamingContent(null);
        if (started) { setError(STREAM_INTERRUPTED); return; }   // post-start → no re-charge
        await bufferedSend(message, includeIds);                 // pre-start → safe recover
        return;
      }

      setStreamingContent(null);
      if (state.errorShown) {
        // Error beat wins, regardless of beat ordering. Checked FIRST so a done beat that
        // arrives alongside an error (a malformed stream — this module treats the wire as
        // untrusted) can never commit a reply on top of the error banner. The specific
        // server-reason message is already shown; nothing to commit, never buffered-recover.
      } else if (state.donePayload) {
        // success → commit the finalized turn
        const dp = state.donePayload;
        thread.append([{
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: typeof dp.reply === 'string' ? dp.reply : content,
          citations: dp.citations ?? [],
        }]);
        notes.setOffered(dp.offered_notes ?? []);
        reloadHistory(); // new/updated thread persisted → refresh the history list
      } else if (started) {
        // The 200 SSE already returned (server persisted the user message) → never
        // buffered-recover (it would re-insert + re-charge). No terminal event arrived,
        // so surface the generic interrupt copy.
        setError(STREAM_INTERRUPTED);
      } else {
        // Defensive: resolved without a 200 SSE response → safe to recover.
        await bufferedSend(message, includeIds);
      }
    } finally {
      setSending(false);
    }
  }, [groundBook, groundChapter, translation, selectedThreadId, thread, notes, streamInvoke, bufferedSend, reloadHistory]);

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

  const newConversation = useCallback(async () => {
    setSelection({ mode: 'passage' });
    setShowHistory(false);
    notes.reset();
    setError(null);
    await thread.archiveAndReset();
    reloadHistory(); // the archive changed the thread list → refresh it
  }, [thread, notes, reloadHistory]);

  const openThread = useCallback((item: { threadId: string; book: string; chapter: number }) => {
    setSelection({ mode: 'thread', threadId: item.threadId, book: item.book, chapter: item.chapter });
    setShowHistory(false);
    notes.reset();
    setError(null);
  }, [notes]);

  // Relative timestamps in the history list go stale if the panel sits open with no other
  // re-render. Tick once a minute *while it's visible* so "2 minutes ago" keeps advancing;
  // Date.now() per render (≤50 items) is cheap and keeps formatHistoryLabel pure/testable.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (!showHistory) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [showHistory]);
  const now = Date.now();
  const headerLabel = selection.mode === 'thread'
    ? formatPassageLabel(groundBook, groundChapter)
    : `${groundBook.toUpperCase()} ${groundChapter}`;

  // The window between "sent" and the first reply token: show the gentle waiting
  // stream instead of an empty bubble. True while a streaming placeholder has no
  // tokens yet ('') or a buffered send is out and the reply isn't appended yet.
  const lastMsg = thread.messages[thread.messages.length - 1];
  const awaitingReply =
    streamingContent === '' ||
    (sending && streamingContent === null && lastMsg?.role !== 'assistant');

  // requestStudyInsight is available for future use (e.g. opening insight button)
  void requestStudyInsight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--pale-stone)', flex: '0 0 auto' }}>
        <div style={{ fontSize: 11, color: 'var(--silica)', letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {headerLabel}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button type="button" aria-label="New conversation" title="New conversation" disabled={!signedIn}
            onClick={() => void newConversation()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--silica)', borderRadius: 6, cursor: signedIn ? 'pointer' : 'not-allowed' }}>
            <Plus className="w-4 h-4" />
          </button>
          <button type="button" aria-label="History" title="History" disabled={!signedIn}
            onClick={() => setShowHistory((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--silica)', borderRadius: 6, cursor: signedIn ? 'pointer' : 'not-allowed' }}>
            <HistoryIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      {showHistory ? (
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {history.loading && <div style={{ padding: 16, color: 'var(--silica)', fontSize: 12 }}>Loading…</div>}
          {history.error && <div style={{ padding: 16, color: '#b00', fontSize: 12 }}>Couldn't load history. Please try again.</div>}
          {!history.loading && !history.error && history.items.length === 0 && (
            <div style={{ padding: 16, color: 'var(--silica)', fontSize: 12 }}>No past conversations yet.</div>
          )}
          {history.items.map((it) => (
            <button key={it.threadId} type="button" onClick={() => openThread(it)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, border: 'none', borderRadius: 6, background: 'transparent', color: 'var(--deep-umber)', cursor: 'pointer', fontSize: 13 }}>
              {formatHistoryLabel(it.book, it.chapter, it.updatedAt, now)}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column' }}>
          {!thread.loading && thread.messages.length === 0 && notes.offered.length === 0 && !error && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--silica)', fontSize: 13, padding: 24 }}>
              {signedIn ? 'Start a conversation to dive into the Word.' : 'Sign in to use Lamplight Study.'}
            </div>
          )}
          {thread.messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} data-role="user" style={{ marginBottom: 20, textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: 'var(--silica)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>You</div>
                <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
              </div>
            ) : (
              <AssistantRow key={m.id} content={m.content} />
            ),
          )}
          {streamingContent !== null && streamingContent !== '' && (
            <AssistantRow content={streamingContent} streaming />
          )}
          {awaitingReply && <StudyChatWaiting />}
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
      )}
      <div style={{ borderTop: '1px solid var(--pale-stone)', padding: 12, display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
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
            background: signedIn ? 'var(--surface-elevated)' : 'rgba(0,0,0,0.03)',
            color: 'var(--deep-umber)',
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
