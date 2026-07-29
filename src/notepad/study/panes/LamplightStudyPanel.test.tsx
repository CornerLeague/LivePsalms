// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

afterEach(cleanup);

const sendStudyMessage = vi.fn();
vi.mock('../study-chat-client', () => ({
  sendStudyMessage: (...a: unknown[]) => sendStudyMessage(...a),
  requestStudyInsight: vi.fn().mockResolvedValue({ ok: false, reason: 'skipped' }),
}));
const studyThreadMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: unknown[] }> = [];
const studyThreadCalls: Array<unknown[]> = [];
vi.mock('../useStudyChatThread', () => ({
  useStudyChatThread: (...args: unknown[]) => {
    studyThreadCalls.push(args);
    return {
      messages: studyThreadMessages,
      loading: false,
      error: null,
      append: vi.fn((msgs: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: unknown[] }>) => {
        studyThreadMessages.push(...msgs);
      }),
      reload: vi.fn(),
      archiveAndReset: vi.fn().mockResolvedValue(undefined),
    };
  },
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
}));
vi.mock('@/notepad/bible/prefs/bible-prefs-context', () => ({
  useBiblePrefs: () => ({
    translation: 'BSB',
    verseLayout: 'inline',
    setLocalTranslation: vi.fn(),
    setLocalVerseLayout: vi.fn(),
    saveGlobalPrefs: vi.fn(async () => ({ ok: true })),
  }),
}));
const streamStudyMessage = vi.fn();
vi.mock('../study-stream-client', () => ({
  makeStudyStreamInvoke: () => (...a: unknown[]) => streamStudyMessage(...a),
}));

const historyItems: Array<{ threadId: string; book: string; chapter: number; title: string; updatedAt: string }> = [];
const historyReload = vi.fn();
vi.mock('../useStudyChatHistory', () => ({
  useStudyChatHistory: () => ({ items: historyItems, loading: false, error: null, reload: historyReload }),
}));

import { LamplightStudyPanel } from './LamplightStudyPanel';

describe('LamplightStudyPanel notes-on-offer', () => {
  afterEach(() => { studyThreadMessages.length = 0; });
  it('shows an inviting empty state when there are no messages yet', () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    expect(screen.getByText(/start a conversation to dive into the word/i)).toBeTruthy();
  });

  it('shows the offer after a reply returns offered notes', async () => {
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'r', citations: [], offeredNotes: [{ id: 'n1', title: 'A', snippet: 's' }] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'what about shepherd?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeTruthy());
  });

  it('gates the chat behind sign-in when logged out', () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId={null} />);
    expect(screen.getByText(/sign in to use lamplight study/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('maps the raw edge-function error to a friendly sign-in message', async () => {
    sendStudyMessage.mockResolvedValue({ ok: false, reason: 'Edge Function returned a non-2xx status code' });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/please sign in to use lamplight study/i)).toBeTruthy());
    expect(screen.queryByText(/non-2xx/i)).toBeNull();
  });

  it('themes the input so typed text follows the theme (visible in dark mode)', () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    const input = screen.getByPlaceholderText(/ask/i) as HTMLInputElement;
    // inline style uses CSS vars so the field + ink follow --surface-elevated / --deep-umber
    expect(input.style.color).toBe('var(--deep-umber)');
    expect(input.style.background).toBe('var(--surface-elevated)');
  });
});

describe('LamplightStudyPanel refined-flat layout', () => {
  afterEach(() => { studyThreadMessages.length = 0; });

  it('renders a user turn right-aligned with a "You" label', () => {
    studyThreadMessages.push({ id: 'u1', role: 'user', content: 'hi there', citations: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    const row = document.querySelector('[data-role="user"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('You');
    expect(row.textContent).toContain('hi there');
    expect(row.style.textAlign).toBe('right');
  });

  it('renders an assistant turn with a theme-accent bar + "Lamplight" label', () => {
    studyThreadMessages.push({ id: 'a1', role: 'assistant', content: 'Grace and peace.', citations: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    const row = document.querySelector('[data-role="assistant"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Lamplight');
    expect(row.textContent).toContain('Grace and peace.');
    const bar = row.querySelector('[data-testid="lamplight-accent-bar"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.background).toBe('var(--lamplight-accent)');
  });
});

describe('LamplightStudyPanel streaming', () => {
  beforeEach(() => { sendStudyMessage.mockReset(); streamStudyMessage.mockReset(); });
  afterEach(() => { studyThreadMessages.length = 0; streamStudyMessage.mockReset(); sendStudyMessage.mockReset(); });

  it('streams the assistant reply live then commits the finalized turn + offered notes', async () => {
    streamStudyMessage.mockImplementation(async (_args: unknown, handlers: { onEvent: (ev: unknown) => void }) => {
      handlers.onEvent({ t: 'stage', stage: 'notes' });
      handlers.onEvent({ t: 'text', field: 'reply', delta: 'Grace ' });
      handlers.onEvent({ t: 'text', field: 'reply', delta: 'and peace.' });
      handlers.onEvent({ t: 'done', payload: { ok: true, reply: 'Grace and peace.', citations: [], offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] } });
    });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/grace and peace\./i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeTruthy());
    expect(sendStudyMessage).not.toHaveBeenCalled(); // streaming succeeded → no buffered fallback
  });

  it('falls back to the buffered send when the stream throws', async () => {
    streamStudyMessage.mockRejectedValue(new Error('network'));
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'Buffered reply.', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sendStudyMessage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/buffered reply\./i)).toBeTruthy());
  });

  it('does NOT fall back to buffered send when the stream drops after it started (no double-charge)', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();                                            // 200 SSE received → server already persisted
      h.onEvent({ t: 'text', field: 'reply', delta: 'Grac' });
      throw new Error('network blip mid-stream');
    });
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'should-not-appear', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/your message was saved/i)).toBeTruthy());
    expect(sendStudyMessage).not.toHaveBeenCalled();           // the fix: no buffered fallback after start
  });

  it('shows a server-reason-specific message (not the generic one) on an error beat, no fallback', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'error', reason: 'validators_failed' });
    });
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'should-not-appear', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    // friendlyError('validators_failed') → generic "Something went wrong" message, and the
    // post-stream gate must NOT clobber it with the STREAM_INTERRUPTED ("…message was saved…") copy.
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy());
    expect(screen.queryByText(/your message was saved/i)).toBeNull();
    expect(sendStudyMessage).not.toHaveBeenCalled();
  });

  it('lets an error beat win even when a done beat also arrives AFTER it (no reply committed)', async () => {
    // Defense-in-depth: this client treats the SSE wire as untrusted. If a buggy/malformed
    // stream emits an error beat and THEN a done beat, the error must win — the gate must not
    // commit the finalized reply on top of an error banner (contradictory UI).
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'error', reason: 'validators_failed' });
      h.onEvent({ t: 'done', payload: { ok: true, reply: 'committed-after-error', citations: [], offered_notes: [] } });
    });
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'should-not-appear', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy());
    expect(screen.queryByText(/committed-after-error/i)).toBeNull();
    expect(sendStudyMessage).not.toHaveBeenCalled();
  });

  it('lets an error beat win even when a done beat arrived BEFORE it (no reply committed)', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'done', payload: { ok: true, reply: 'committed-before-error', citations: [], offered_notes: [] } });
      h.onEvent({ t: 'error', reason: 'validators_failed' });
    });
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'should-not-appear', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy());
    expect(screen.queryByText(/committed-before-error/i)).toBeNull();
    expect(sendStudyMessage).not.toHaveBeenCalled();
  });

  it('does NOT fall back when the stream ends after starting with no terminal event', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'text', field: 'reply', delta: 'partial' });
      // resolves with no done/error
    });
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'should-not-appear', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/your message was saved/i)).toBeTruthy());
    expect(sendStudyMessage).not.toHaveBeenCalled();
  });
});

describe('LamplightStudyPanel history + resume', () => {
  beforeEach(() => { historyItems.length = 0; studyThreadCalls.length = 0; sendStudyMessage.mockReset(); streamStudyMessage.mockReset(); });
  afterEach(() => { studyThreadMessages.length = 0; historyItems.length = 0; studyThreadCalls.length = 0; });

  it('shows New conversation + History controls in the header', () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /history/i })).toBeTruthy();
  });

  it('opens the history list and reopens a conversation in thread mode', () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    // Label uses the history-label helper → "Romans 8 · …"
    const item = screen.getByText(/romans 8 ·/i);
    fireEvent.click(item);
    // After reopening, the thread hook is called with the thread's id.
    const lastCall = studyThreadCalls[studyThreadCalls.length - 1];
    expect(lastCall[3]).toBe('thread-42');
  });

  it('resume send carries threadId + the thread\'s book/chapter (not the reader\'s)', async () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'done', payload: { ok: true, reply: 'ok', citations: [], offered_notes: [] } });
    });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(screen.getByText(/romans 8 ·/i));
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'connect to psalm 23?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(streamStudyMessage).toHaveBeenCalled());
    const sentArgs = streamStudyMessage.mock.calls[0][0] as { book: string; chapter: number; threadId?: string };
    expect(sentArgs.book).toBe('rom');
    expect(sentArgs.chapter).toBe(8);
    expect(sentArgs.threadId).toBe('thread-42');
  });

  it('New conversation archives + returns to passage mode', async () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    // reopen a thread first
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(screen.getByText(/romans 8 ·/i));
    // now start a new conversation
    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));
    await waitFor(() => {
      const lastCall = studyThreadCalls[studyThreadCalls.length - 1];
      expect(lastCall[3]).toBeUndefined(); // back to passage mode → no threadId
    });
  });

  it('resets to passage mode when the reader navigates to a new chapter', () => {
    historyItems.push({ threadId: 'thread-42', book: 'rom', chapter: 8, title: 'Paul', updatedAt: '2026-06-27T12:00:00Z' });
    const { rerender } = render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(screen.getByText(/romans 8 ·/i));
    rerender(<LamplightStudyPanel book="jhn" chapter={11} userId="u1" />);
    const lastCall = studyThreadCalls[studyThreadCalls.length - 1];
    expect(lastCall[3]).toBeUndefined(); // navigation dropped the reopened thread
  });
});

describe('LamplightStudyPanel history list stays in sync after mutations', () => {
  beforeEach(() => { historyReload.mockReset(); sendStudyMessage.mockReset(); streamStudyMessage.mockReset(); });
  afterEach(() => { studyThreadMessages.length = 0; historyReload.mockReset(); sendStudyMessage.mockReset(); streamStudyMessage.mockReset(); });

  it('reloads the history list after a successful streaming send (the new thread appears)', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'done', payload: { ok: true, reply: 'ok', citations: [], offered_notes: [] } });
    });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(historyReload).toHaveBeenCalled());
  });

  it('reloads the history list after a buffered-fallback send', async () => {
    streamStudyMessage.mockRejectedValue(new Error('network'));
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'buffered', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sendStudyMessage).toHaveBeenCalled());
    await waitFor(() => expect(historyReload).toHaveBeenCalled());
  });

  it('does NOT reload the history list when the send fails', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void; onStart?: () => void }) => {
      h.onStart?.();
      h.onEvent({ t: 'error', reason: 'validators_failed' });
    });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy());
    expect(historyReload).not.toHaveBeenCalled();
  });

  it('reloads the history list after starting a new conversation', async () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));
    await waitFor(() => expect(historyReload).toHaveBeenCalled());
  });
});

describe('LamplightStudyPanel history timestamps keep ticking while open', () => {
  beforeEach(() => { historyItems.length = 0; });
  afterEach(() => { studyThreadMessages.length = 0; historyItems.length = 0; });

  it('advances the relative timestamp on an interval while the panel stays open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00Z'));
    try {
      historyItems.push({ threadId: 't1', book: 'rom', chapter: 8, title: 'x', updatedAt: '2026-06-29T11:59:00Z' });
      render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      expect(screen.getByText(/1 minute ago/i)).toBeTruthy();
      // Panel left open; clock moves on. The list must re-render and re-derive "now".
      act(() => { vi.advanceTimersByTime(120_000); });
      expect(screen.getByText(/3 minutes ago/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
