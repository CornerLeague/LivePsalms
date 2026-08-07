// @vitest-environment jsdom
// src/notepad/components/lamplight/chat/LamplightChat.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const useChatThread = vi.fn();
const sendChatMessage = vi.fn();
const requestOpeningInsight = vi.fn();
const useNoteCollection = vi.fn();
vi.mock('@/notepad/bible/useChatThread', () => ({ useChatThread: (...a: unknown[]) => useChatThread(...a) }));
vi.mock('@/notepad/bible/lamplight-chat-client', () => ({
  sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
  requestOpeningInsight: (...a: unknown[]) => requestOpeningInsight(...a),
}));
vi.mock('@/notepad/context/useNoteCollection', () => ({ useNoteCollection: () => useNoteCollection() }));

const useChatThreadList = vi.fn(() => ({ threads: [], loading: false, error: null, reload: vi.fn() }));
vi.mock('@/notepad/bible/useChatThreadList', () => ({ useChatThreadList: () => useChatThreadList() }));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({ useBiblePrefs: () => ({ translation: 'BSB' }) }));
vi.mock('./ChatHistoryList', () => ({
  ChatHistoryList: (p: { onSelect: (id: string) => void; onBack: () => void }) => (
    <div data-testid="history-list">
      <button onClick={() => p.onSelect('t1')}>open-t1</button>
      <button onClick={p.onBack}>list-back</button>
    </div>
  ),
}));
vi.mock('./ReflectionThreadView', () => ({
  ReflectionThreadView: (p: { threadId: string; onBack: () => void }) => (
    <div data-testid="thread-view">{p.threadId}<button onClick={p.onBack}>thread-back</button></div>
  ),
}));

import { LamplightChat } from './LamplightChat';

afterEach(cleanup);

beforeEach(() => {
  sendChatMessage.mockReset();
  // Reset call count then set a safe default so the effect doesn't crash when untested.
  requestOpeningInsight.mockReset();
  requestOpeningInsight.mockResolvedValue({ ok: false, reason: 'test-suppressed' });
  useChatThread.mockReset();
  useNoteCollection.mockReset();
  useNoteCollection.mockReturnValue({ notes: [] });
});

function setup(threadOverrides = {}) {
  useChatThread.mockReturnValue({
    messages: [], loading: false, error: null, append: vi.fn(), updateLast: vi.fn(), reload: vi.fn(), archiveAndReset: vi.fn(), ...threadOverrides,
  });
}

// A fake StreamInvoke whose `onEvent` is driven by a script of SseEvents. It
// captures the AbortSignal so abort tests can assert it. By default it resolves
// after replaying the script synchronously; pass { neverResolve:true } to hang.
import type { SseEvent } from '@/notepad/bible/lamplight-stream-client';
function makeFakeStream(opts: {
  script?: SseEvent[];
  neverResolve?: boolean;
  onCall?: (info: { body: unknown; signal?: AbortSignal }) => void;
} = {}) {
  const calls: { body: unknown; signal?: AbortSignal }[] = [];
  const fn = vi.fn(async (_name: string, body: unknown, handlers: { onEvent: (ev: SseEvent) => void; signal?: AbortSignal }) => {
    calls.push({ body, signal: handlers.signal });
    opts.onCall?.({ body, signal: handlers.signal });
    for (const ev of opts.script ?? []) handlers.onEvent(ev);
    if (opts.neverResolve) return new Promise<void>(() => {});
  });
  return Object.assign(fn, { calls });
}

describe('LamplightChat', () => {
  it('sends a message and appends the user + assistant turns', async () => {
    const append = vi.fn();
    setup({ append });
    sendChatMessage.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Grace and peace.', citations: [] });
    const invoke = vi.fn();
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={invoke} />);

    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'what is this about?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(invoke, { book: 'jhn', chapter: 10, message: 'what is this about?', translation: 'BSB' }));
    await waitFor(() => expect(append).toHaveBeenCalled());
  });

  it('shows an error bubble when the send fails', async () => {
    setup();
    sendChatMessage.mockResolvedValue({ ok: false, reason: 'network' });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/reach Lamplight/i)).toBeInTheDocument());
  });
});

describe('LamplightChat reflection', () => {
  it('does NOT auto-fire a reflection on an empty thread', async () => {
    setup();
    requestOpeningInsight.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Opening thought.', citations: [] });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    // Give any stray effect a tick to fire; it must not.
    await new Promise((r) => setTimeout(r, 0));
    expect(requestOpeningInsight).not.toHaveBeenCalled();
  });

  it('shows a Reflect button on an empty thread and generates a reflection when clicked', async () => {
    const append = vi.fn();
    setup({ append });
    requestOpeningInsight.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Opening thought.', citations: [] });
    const invoke = vi.fn();
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={invoke} />);

    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));

    await waitFor(() => expect(requestOpeningInsight).toHaveBeenCalledWith(invoke, { book: 'jhn', chapter: 10, translation: 'BSB' }));
    await waitFor(() => expect(append).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'assistant', content: 'Opening thought.' }),
    ]));
  });

  it('surfaces an error when the reflection fails', async () => {
    setup();
    requestOpeningInsight.mockResolvedValue({ ok: false, reason: 'network' });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));
    await waitFor(() => expect(screen.getByText(/reach Lamplight/i)).toBeInTheDocument());
  });

  it('does not show the Reflect button when the thread already has messages', () => {
    setup({ messages: [{ id: 'm1', role: 'assistant', content: 'prior', citations: [] }] });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /reflect on this passage/i })).not.toBeInTheDocument();
  });

  it('does not show the Reflect button while the thread is loading', () => {
    setup({ loading: true });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /reflect on this passage/i })).not.toBeInTheDocument();
  });

  it('shows the reflecting indicator while a reflection is in flight', async () => {
    requestOpeningInsight.mockReturnValue(new Promise(() => {})); // never resolves
    setup();
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));
    await waitFor(() => expect(screen.getByText(/Lamplight is reflecting/i)).toBeInTheDocument());
  });

  it('does not fire a second reflection while one is in flight', async () => {
    requestOpeningInsight.mockReturnValue(new Promise(() => {})); // never resolves
    setup();
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /reflect on this passage/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(requestOpeningInsight).toHaveBeenCalledTimes(1));
  });

  it('clears the reflecting indicator when the passage changes mid-reflection', async () => {
    requestOpeningInsight.mockReturnValue(new Promise(() => {})); // never resolves: stays in-flight
    setup();
    const { rerender } = render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));
    await waitFor(() => expect(screen.getByText(/Lamplight is reflecting/i)).toBeInTheDocument());

    // Switch to a passage that already has messages — the passage-change effect resets the indicator.
    setup({ messages: [{ id: 'm1', role: 'assistant', content: 'prior', citations: [] }] });
    rerender(<LamplightChat book="rev" chapter={1} userId="u1" invoke={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText(/Lamplight is reflecting/i)).not.toBeInTheDocument());
  });

  it('discards an in-flight reflection if the passage changed before it resolved', async () => {
    let resolveInsight: (v: unknown) => void = () => {};
    requestOpeningInsight.mockReturnValueOnce(new Promise((r) => { resolveInsight = r; }));
    const appendJhn = vi.fn();
    setup({ append: appendJhn });
    const { rerender } = render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));
    await waitFor(() => expect(requestOpeningInsight).toHaveBeenCalledTimes(1));

    // Navigate to a different passage that already has messages.
    const appendRev = vi.fn();
    setup({ messages: [{ id: 'm1', role: 'assistant', content: 'prior', citations: [] }], append: appendRev });
    rerender(<LamplightChat book="rev" chapter={1} userId="u1" invoke={vi.fn()} />);

    // The jhn reflection resolves AFTER navigating away — it must NOT be appended to rev.
    resolveInsight({ ok: true, threadId: 't1', reply: 'Stale jhn insight.', citations: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(appendRev).not.toHaveBeenCalled();
    expect(screen.queryByText(/Lamplight is reflecting/i)).not.toBeInTheDocument();
  });

  it('renders a note citation chip as the note title, not the raw id', () => {
    useNoteCollection.mockReturnValue({ notes: [{ id: 'n1', title: 'On the Good Shepherd' }] });
    setup({
      messages: [{
        id: 'm1', role: 'assistant', content: 'Builds on your earlier thought.',
        citations: [{ type: 'note', ref: 'n1' }],
      }],
    });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    expect(screen.getByText('On the Good Shepherd')).toBeInTheDocument();
    expect(screen.queryByText('n1')).not.toBeInTheDocument();
  });

  it('+ New reflection archives the active thread', async () => {
    const archiveAndReset = vi.fn().mockResolvedValue(undefined);
    setup({ messages: [{ id: 'm1', role: 'assistant', content: 'old insight', citations: [] }], archiveAndReset });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /new reflection/i }));
    await waitFor(() => expect(archiveAndReset).toHaveBeenCalledTimes(1));
  });
});

describe('LamplightChat streaming', () => {
  // A live-mutating useChatThread mock: append() and updateLast() actually mutate a
  // local messages array and force a re-render, so streamed patches are observable
  // in the DOM the way the real hook would render them.
  function setupLive() {
    let messages: { id: string; role: string; content: string; citations: unknown[]; streaming?: boolean; stage?: unknown }[] = [];
    let rerender: (() => void) | null = null;
    const append = vi.fn((msgs: typeof messages) => { messages = [...messages, ...msgs]; rerender?.(); });
    const updateLast = vi.fn((patch: Record<string, unknown>) => {
      if (messages.length === 0) return;
      messages = [...messages.slice(0, -1), { ...messages[messages.length - 1], ...patch }];
      rerender?.();
    });
    useChatThread.mockImplementation(() => {
      const [, setN] = useState(0);
      rerender = () => setN((n: number) => n + 1);
      return { messages, loading: false, error: null, append, updateLast, reload: vi.fn(), archiveAndReset: vi.fn() };
    });
    return { append, updateLast, getMessages: () => messages };
  }

  it('streams the assistant reply into a growing bubble and ends with the full reply + citations', async () => {
    const { updateLast } = setupLive();
    const stream = makeFakeStream({
      script: [
        { t: 'stage', stage: 'notes' },
        { t: 'text', field: 'reply', delta: 'Grace ' },
        { t: 'text', field: 'reply', delta: 'and peace. ' },
        { t: 'piece', field: 'citations', value: [{ type: 'verse', ref: 'jhn 10:11' }] },
        { t: 'done', payload: { ok: true, thread_id: 't1', reply: 'Grace and peace.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] } },
      ],
    });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);

    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'what is this about?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(stream).toHaveBeenCalledWith(
      'lamplight-chat',
      { book: 'jhn', chapter: 10, message: 'what is this about?', translation: 'BSB' },
      expect.objectContaining({ onEvent: expect.any(Function), signal: expect.any(AbortSignal) }),
    ));
    // Buffered path must NOT be used when streaming.
    expect(sendChatMessage).not.toHaveBeenCalled();
    // Final patch carries the full reply + citations + streaming:false.
    await waitFor(() => expect(updateLast).toHaveBeenCalledWith(
      expect.objectContaining({ streaming: false, content: 'Grace and peace.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] }),
    ));
    await waitFor(() => expect(screen.getByText('Grace and peace.')).toBeInTheDocument());
  });

  it('ignores a malformed (non-array) citations piece without corrupting the bubble', async () => {
    const { updateLast } = setupLive();
    const stream = makeFakeStream({
      script: [
        { t: 'text', field: 'reply', delta: 'Grace and peace.' },
        // Malformed server frame: value is NOT an array. The guard must skip it.
        { t: 'piece', field: 'citations', value: { not: 'an array' } as unknown as [] },
        { t: 'done', payload: { ok: true, thread_id: 't1', reply: 'Grace and peace.', citations: [] } },
      ],
    });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);

    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByText('Grace and peace.')).toBeInTheDocument());
    // The non-array value was never applied as citations (guard skipped the patch).
    const citationPatches = updateLast.mock.calls
      .map((c: [Record<string, unknown>]) => c[0])
      .filter((p) => 'citations' in p);
    for (const p of citationPatches) expect(Array.isArray(p.citations)).toBe(true);
  });

  it('aborts the in-flight stream when the passage changes', async () => {
    setupLive();
    let captured: AbortSignal | undefined;
    const stream = makeFakeStream({ neverResolve: true, onCall: ({ signal }) => { captured = signal; } });
    const { rerender } = render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);

    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(captured).toBeDefined());
    expect(captured!.aborted).toBe(false);

    // Navigate to a different passage — the passageKey effect must abort the stream.
    rerender(<LamplightChat book="rev" chapter={1} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);
    await waitFor(() => expect(captured!.aborted).toBe(true));
  });

  it('falls back to the buffered sendChatMessage when the stream ends with no terminal event', async () => {
    setupLive();
    // Simulates a JSON gate error swallowed by the transport: resolves, emits nothing.
    const stream = makeFakeStream({ script: [] });
    sendChatMessage.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Buffered reply.', citations: [] });
    const invoke = vi.fn();
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={invoke} streamInvoke={stream} />);

    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(invoke, { book: 'jhn', chapter: 10, message: 'hi', translation: 'BSB' }));
    await waitFor(() => expect(screen.getByText('Buffered reply.')).toBeInTheDocument());
  });

  it('falls back to the buffered path when the stream throws', async () => {
    setupLive();
    const stream = vi.fn(async () => { throw new Error('boom'); });
    sendChatMessage.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Recovered reply.', citations: [] });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);

    fireEvent.change(screen.getByPlaceholderText(/ask about this passage/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Recovered reply.')).toBeInTheDocument());
  });
});

describe('LamplightChat reflection streaming', () => {
  // Reuse the live-mutating thread mock so streamed reflection patches render.
  function setupLive() {
    let messages: { id: string; role: string; content: string; citations: unknown[]; streaming?: boolean; stage?: unknown }[] = [];
    let rerender: (() => void) | null = null;
    const append = vi.fn((msgs: typeof messages) => { messages = [...messages, ...msgs]; rerender?.(); });
    const updateLast = vi.fn((patch: Record<string, unknown>) => {
      if (messages.length === 0) return;
      messages = [...messages.slice(0, -1), { ...messages[messages.length - 1], ...patch }];
      rerender?.();
    });
    useChatThread.mockImplementation(() => {
      const [, setN] = useState(0);
      rerender = () => setN((n: number) => n + 1);
      return { messages, loading: false, error: null, append, updateLast, reload: vi.fn(), archiveAndReset: vi.fn() };
    });
    return { append, updateLast, getMessages: () => messages };
  }

  it('streams the reflection into a growing bubble in insight mode and finalizes with the full reply + citations', async () => {
    const { updateLast } = setupLive();
    const stream = makeFakeStream({
      script: [
        { t: 'stage', stage: 'notes' },
        { t: 'text', field: 'reply', delta: 'A quiet ' },
        { t: 'text', field: 'reply', delta: 'opening thought. ' },
        { t: 'piece', field: 'citations', value: [{ type: 'verse', ref: 'jhn 10:11' }] },
        { t: 'done', payload: { ok: true, thread_id: 't1', reply: 'A quiet opening thought.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] } },
      ],
    });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);

    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));

    // Reflection routes through the SAME streaming transport, in insight mode.
    await waitFor(() => expect(stream).toHaveBeenCalledWith(
      'lamplight-chat',
      { book: 'jhn', chapter: 10, mode: 'opener', translation: 'BSB' },
      expect.objectContaining({ onEvent: expect.any(Function), signal: expect.any(AbortSignal) }),
    ));
    // Buffered insight path must NOT be used when streaming.
    expect(requestOpeningInsight).not.toHaveBeenCalled();
    // Final patch carries the full reply + citations + streaming:false.
    await waitFor(() => expect(updateLast).toHaveBeenCalledWith(
      expect.objectContaining({ streaming: false, content: 'A quiet opening thought.', citations: [{ type: 'verse', ref: 'jhn 10:11' }] }),
    ));
    await waitFor(() => expect(screen.getByText('A quiet opening thought.')).toBeInTheDocument());
  });

  it('falls back to the buffered requestOpeningInsight when the reflection stream ends with no terminal event', async () => {
    setupLive();
    const stream = makeFakeStream({ script: [] }); // resolves, emits nothing (JSON gate swallowed)
    requestOpeningInsight.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Buffered reflection.', citations: [] });
    const invoke = vi.fn();
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={invoke} streamInvoke={stream} />);

    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));

    await waitFor(() => expect(requestOpeningInsight).toHaveBeenCalledWith(invoke, { book: 'jhn', chapter: 10, translation: 'BSB' }));
    await waitFor(() => expect(screen.getByText('Buffered reflection.')).toBeInTheDocument());
  });

  it('falls back to the buffered requestOpeningInsight when the reflection stream throws', async () => {
    setupLive();
    const stream = vi.fn(async () => { throw new Error('boom'); });
    requestOpeningInsight.mockResolvedValue({ ok: true, threadId: 't1', reply: 'Recovered reflection.', citations: [] });
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} streamInvoke={stream} />);

    fireEvent.click(screen.getByRole('button', { name: /reflect on this passage/i }));

    await waitFor(() => expect(requestOpeningInsight).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Recovered reflection.')).toBeInTheDocument());
  });
});

describe('LamplightChat history', () => {
  it('opens the history list, then a thread, then returns to live', async () => {
    setup(); // live thread with messages, from the existing helper
    render(<LamplightChat book="jhn" chapter={10} userId="u1" invoke={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(screen.getByTestId('history-list')).toBeInTheDocument();

    fireEvent.click(screen.getByText('open-t1'));
    expect(screen.getByTestId('thread-view')).toHaveTextContent('t1');

    fireEvent.click(screen.getByText('thread-back'));
    expect(screen.getByTestId('history-list')).toBeInTheDocument();

    fireEvent.click(screen.getByText('list-back'));
    expect(screen.queryByTestId('history-list')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask about this passage/i)).toBeInTheDocument();
  });
});
