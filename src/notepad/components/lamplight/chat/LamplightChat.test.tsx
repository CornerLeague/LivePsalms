// @vitest-environment jsdom
// src/notepad/components/lamplight/chat/LamplightChat.test.tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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
    messages: [], loading: false, error: null, append: vi.fn(), reload: vi.fn(), archiveAndReset: vi.fn(), ...threadOverrides,
  });
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
