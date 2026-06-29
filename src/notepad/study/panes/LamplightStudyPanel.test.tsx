// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

afterEach(cleanup);

const sendStudyMessage = vi.fn();
vi.mock('../study-chat-client', () => ({
  sendStudyMessage: (...a: unknown[]) => sendStudyMessage(...a),
  requestStudyInsight: vi.fn().mockResolvedValue({ ok: false, reason: 'skipped' }),
}));
const studyThreadMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: unknown[] }> = [];
vi.mock('../useStudyChatThread', () => ({
  useStudyChatThread: () => ({
    messages: studyThreadMessages,
    loading: false,
    error: null,
    append: vi.fn((msgs: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: unknown[] }>) => {
      studyThreadMessages.push(...msgs);
    }),
    reload: vi.fn(),
    archiveAndReset: vi.fn(),
  }),
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

  it('renders an assistant turn with an indigo accent bar + "Lamplight" label', () => {
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

  it('falls back to buffered send when the stream emits an error beat', async () => {
    streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void }) => {
      h.onEvent({ t: 'error', reason: 'validators_failed' });
    });
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'Recovered.', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sendStudyMessage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/recovered\./i)).toBeTruthy());
  });

  it('falls back to buffered send when the stream resolves without any terminal event', async () => {
    streamStudyMessage.mockResolvedValue(undefined);
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'Recovered no-terminal.', citations: [], offeredNotes: [] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(sendStudyMessage).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/recovered no-terminal\./i)).toBeTruthy());
  });
});
