// src/notepad/components/lamplight/chat/LamplightChat.tsx
import { useState, useEffect, useRef, useMemo } from 'react';
import { useChatThread, type ChatThreadMessage } from '@/notepad/bible/useChatThread';
import { sendChatMessage, requestOpeningInsight, type InvokeFn, type ChatCitation } from '@/notepad/bible/lamplight-chat-client';
import { createSentenceChunker } from '@/notepad/bible/sentence-chunker';
import type { StreamInvoke } from '@/notepad/bible/lamplight-stream-client';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useChatThreadList } from '@/notepad/bible/useChatThreadList';
import { ChatMessage } from './ChatMessage';
import { ChatHistoryList } from './ChatHistoryList';
import { ReflectionThreadView } from './ReflectionThreadView';

export interface LamplightChatProps {
  book: string;
  chapter: number;
  userId: string;
  invoke: InvokeFn;
  /** Optional SSE transport. When provided, send() streams the reply live;
   *  when undefined (or a stream fails) the buffered invoke path is used. */
  streamInvoke?: StreamInvoke;
}

let localIdSeq = 0;
const localId = () => `local-${++localIdSeq}`;

export function LamplightChat({ book, chapter, userId, invoke, streamInvoke }: LamplightChatProps) {
  const thread = useChatThread(book, chapter, userId);
  const { translation } = useBiblePrefs();
  const { notes } = useNoteCollection();
  // Resolve note citations to their titles (chips show names, never raw note ids).
  const resolveNoteTitle = useMemo(() => {
    const titleById = new Map(notes.map((n) => [n.id, n.title]));
    return (id: string) => titleById.get(id);
  }, [notes]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passageKey = `${book}.${chapter}`;
  type View = { kind: 'live' } | { kind: 'list' } | { kind: 'thread'; threadId: string };
  const [view, setView] = useState<View>({ kind: 'live' });
  const history = useChatThreadList(book, chapter, userId);
  const [insighting, setInsighting] = useState(false);
  const insightInFlight = useRef(false);
  const livePassageKey = useRef(passageKey);
  livePassageKey.current = passageKey;
  const mounted = useRef(true);
  // Controller for an in-flight streaming send(), so navigating chapters (or
  // unmounting) cancels the open SSE request.
  const streamAbort = useRef<AbortController | null>(null);

  // Track real unmount so an in-flight reflection isn't applied after teardown.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      streamAbort.current?.abort();
    };
  }, []);

  // Clear any stale "reflecting…" indicator / error when the passage changes, and
  // release the in-flight guard so the new passage can request its own reflection.
  // Also abort any in-flight streaming send so chapter navigation cancels it.
  useEffect(() => {
    setInsighting(false);
    setError(null);
    insightInFlight.current = false;
    streamAbort.current?.abort();
    streamAbort.current = null;
  }, [passageKey]);

  // Reset to the live conversation whenever the passage changes, so navigating
  // chapters never strands the user in a previous chapter's history view.
  useEffect(() => { setView({ kind: 'live' }); }, [passageKey]);

  // Buffered reflection: one round-trip that appends the assistant turn on
  // resolve. Used directly when no streamInvoke is provided, and as the fallback
  // when a reflection stream throws or ends with no terminal event. `forPassage`
  // pins the request so a late resolve after navigating chapters is discarded.
  const bufferedReflection = async (forPassage: string) => {
    const res = await requestOpeningInsight(invoke, { book, chapter, translation });
    if (!mounted.current || livePassageKey.current !== forPassage) return;
    if (res.ok) {
      thread.append([{ id: localId(), role: 'assistant', content: res.reply, citations: res.citations }]);
    } else {
      setError(res.reason);
    }
  };

  // Streaming reflection: mirrors streamSend() exactly (insight mode). Appends a
  // placeholder assistant bubble and drives it live from SSE events; falls back
  // to bufferedReflection on throw or when no terminal (done/error) event is seen.
  const streamReflection = async (forPassage: string, stream: StreamInvoke) => {
    thread.append([{ id: localId(), role: 'assistant', content: '', citations: [], streaming: true }]);
    const controller = new AbortController();
    streamAbort.current = controller;
    const chunker = createSentenceChunker();
    let content = '';
    let terminal = false;
    const alive = () => mounted.current && livePassageKey.current === forPassage && !controller.signal.aborted;

    const onEvent = (ev: Parameters<Parameters<StreamInvoke>[2]['onEvent']>[0]) => {
      if (!alive()) return;
      switch (ev.t) {
        case 'stage':
          thread.updateLast({ stage: ev.stage });
          break;
        case 'text': {
          if (ev.field !== 'reply') break;
          for (const chunk of chunker.push(ev.delta)) {
            content += chunk;
            thread.updateLast({ content, stage: null });
          }
          break;
        }
        case 'piece':
          if (ev.field === 'citations' && Array.isArray(ev.value)) thread.updateLast({ citations: ev.value as ChatCitation[] });
          break;
        case 'refining':
          thread.updateLast({ stage: 'composing' });
          break;
        case 'done': {
          terminal = true;
          const tail = chunker.flush();
          if (tail) content += tail;
          const payload = (ev.payload ?? {}) as { reply?: string; citations?: ChatCitation[] };
          thread.updateLast({
            streaming: false,
            content: typeof payload.reply === 'string' ? payload.reply : content,
            citations: payload.citations ?? [],
          });
          break;
        }
        case 'error':
          terminal = true;
          thread.updateLast({ streaming: false });
          setError(ev.reason);
          break;
      }
    };

    try {
      await stream('lamplight-chat', { book, chapter, mode: 'insight', translation }, { onEvent, signal: controller.signal });
    } catch {
      if (alive()) {
        thread.updateLast({ streaming: false });
        await bufferedReflection(forPassage);
      }
      return;
    } finally {
      if (streamAbort.current === controller) streamAbort.current = null;
    }
    if (!alive()) return;
    if (!terminal) {
      thread.updateLast({ streaming: false });
      await bufferedReflection(forPassage);
    }
  };

  // User-triggered reflection (replaces the old auto-fire on an empty thread).
  // Streams the opening insight when a streamInvoke transport is provided,
  // matching send(); falls back to the buffered insight path otherwise.
  const requestReflection = async () => {
    if (insightInFlight.current) return;
    insightInFlight.current = true;
    setError(null);
    setInsighting(true);
    const forPassage = passageKey;
    try {
      if (streamInvoke) {
        await streamReflection(forPassage, streamInvoke);
      } else {
        await bufferedReflection(forPassage);
      }
    } finally {
      // Release the in-flight guard only if we're still on the passage we
      // requested for — on a passage change the effect resets it for the new
      // passage, which must own it (mirrors the original early-return guard).
      if (mounted.current && livePassageKey.current === forPassage) {
        insightInFlight.current = false;
        setInsighting(false);
      }
    }
  };

  // Buffered send: a single round-trip that appends the assistant turn on resolve.
  // Used directly when no streamInvoke is provided, and as the fallback when a
  // stream throws or ends with no terminal event (e.g. a JSON gate error the SSE
  // transport silently swallows). `forPassage` pins the request so a late resolve
  // after navigating chapters is discarded.
  const bufferedSend = async (message: string, forPassage: string) => {
    const res = await sendChatMessage(invoke, { book, chapter, message, translation });
    if (!mounted.current || livePassageKey.current !== forPassage) return;
    if (res.ok) {
      thread.append([{ id: localId(), role: 'assistant', content: res.reply, citations: res.citations }]);
    } else {
      setError(res.reason);
    }
  };

  // Streaming send: append a placeholder assistant bubble and drive it live from
  // SSE events. Falls back to bufferedSend on throw or when no terminal
  // (done/error) event is seen.
  const streamSend = async (message: string, forPassage: string, stream: StreamInvoke) => {
    thread.append([{ id: localId(), role: 'assistant', content: '', citations: [], streaming: true }]);
    const controller = new AbortController();
    streamAbort.current = controller;
    const chunker = createSentenceChunker();
    let content = '';
    let terminal = false;
    // Only apply patches while still mounted, still on the same passage, and not
    // aborted — mirrors the reflection guards so a stale stream can't write.
    const alive = () => mounted.current && livePassageKey.current === forPassage && !controller.signal.aborted;

    const onEvent = (ev: Parameters<Parameters<StreamInvoke>[2]['onEvent']>[0]) => {
      if (!alive()) return;
      switch (ev.t) {
        case 'stage':
          thread.updateLast({ stage: ev.stage });
          break;
        case 'text': {
          if (ev.field !== 'reply') break;
          for (const chunk of chunker.push(ev.delta)) {
            content += chunk;
            thread.updateLast({ content, stage: null });
          }
          break;
        }
        case 'piece':
          if (ev.field === 'citations' && Array.isArray(ev.value)) thread.updateLast({ citations: ev.value as ChatCitation[] });
          break;
        case 'refining':
          thread.updateLast({ stage: 'composing' });
          break;
        case 'done': {
          terminal = true;
          const tail = chunker.flush();
          if (tail) content += tail;
          const payload = (ev.payload ?? {}) as { reply?: string; citations?: ChatCitation[] };
          thread.updateLast({
            streaming: false,
            content: typeof payload.reply === 'string' ? payload.reply : content,
            citations: payload.citations ?? [],
          });
          break;
        }
        case 'error':
          terminal = true;
          thread.updateLast({ streaming: false });
          setError(ev.reason);
          break;
      }
    };

    try {
      await stream('lamplight-chat', { book, chapter, message, translation }, { onEvent, signal: controller.signal });
    } catch {
      // Transport threw (network / parse). Drop the streaming placeholder and
      // recover via the buffered path so the error maps to a real reason.
      if (alive()) {
        thread.updateLast({ streaming: false });
        await bufferedSend(message, forPassage);
      }
      return;
    } finally {
      // Release only our own controller; the passageKey effect may have already
      // aborted + replaced it for a newer send.
      if (streamAbort.current === controller) streamAbort.current = null;
    }
    if (!alive()) return;
    if (!terminal) {
      // No done/error seen — the transport resolved with no SSE frames, which is
      // how a JSON gate response (403/402/429) arrives. Recover via buffered send.
      thread.updateLast({ streaming: false });
      await bufferedSend(message, forPassage);
    }
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft('');
    setError(null);
    setSending(true);
    const forPassage = passageKey;
    const userMsg: ChatThreadMessage = { id: localId(), role: 'user', content: message, citations: [] };
    thread.append([userMsg]);
    try {
      if (streamInvoke) {
        await streamSend(message, forPassage, streamInvoke);
      } else {
        await bufferedSend(message, forPassage);
      }
    } finally {
      setSending(false);
    }
  };

  const startNewReflection = async () => {
    await thread.archiveAndReset(); // clears to an empty thread; the Reflect button reappears
  };

  if (view.kind === 'list') {
    return (
      <ChatHistoryList
        threads={history.threads}
        loading={history.loading}
        onSelect={(threadId) => setView({ kind: 'thread', threadId })}
        onBack={() => setView({ kind: 'live' })}
      />
    );
  }
  if (view.kind === 'thread') {
    return <ReflectionThreadView threadId={view.threadId} onBack={() => setView({ kind: 'list' })} />;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--chat-panel-bg)', fontFamily: 'Outfit, sans-serif' }}>
      <div className="flex justify-end gap-2 px-3 pt-2 shrink-0">
        <button
          onClick={() => { history.reload(); setView({ kind: 'list' }); }}
          className="text-[10px] tracking-wider px-2 py-1 rounded-full"
          style={{ color: 'var(--silica)', border: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}
        >
          History
        </button>
        <button
          onClick={() => void startNewReflection()}
          className="text-[10px] tracking-wider px-2 py-1 rounded-full"
          style={{ color: 'var(--silica)', border: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}
        >
          + New reflection
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {thread.loading && <p className="text-[11px]" style={{ color: 'var(--silica)' }}>Loading conversation…</p>}
        {!thread.loading && thread.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <button
              onClick={() => void requestReflection()}
              disabled={insighting}
              className="text-[12px] tracking-wider px-4 py-2 rounded-full disabled:opacity-40"
              style={{ background: 'var(--lamplight-accent)', color: 'var(--chat-on-accent)', fontFamily: 'Outfit, sans-serif' }}
            >
              Reflect on this passage
            </button>
            <p className="text-[10px]" style={{ color: 'var(--silica)' }}>
              Lamplight draws on your own notes.
            </p>
          </div>
        )}
        {thread.messages.map((m) => (
          <ChatMessage key={m.id} role={m.role} content={m.content} citations={m.citations} resolveNoteTitle={resolveNoteTitle} streaming={m.streaming} stage={m.stage} />
        ))}
        {(sending || insighting) && <p className="text-[11px] italic" style={{ color: 'var(--silica)' }}>Lamplight is reflecting…</p>}
        {error && (
          <p className="text-[11px]" style={{ color: 'var(--error-rose, #b45454)' }}>
            Couldn't reach Lamplight ({error}). Try again.
          </p>
        )}
      </div>
      <div className="p-2.5 flex gap-2 items-center" style={{ borderTop: '1px solid var(--pale-stone)' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask about this passage…"
          className="flex-1 text-[12px] px-3 py-1.5 rounded-full"
          style={{ background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)' }}
        />
        <button
          aria-label="Send"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40"
          style={{ background: 'var(--lamplight-accent)', color: 'var(--chat-on-accent)' }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
