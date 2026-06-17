// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const sendStudyMessage = vi.fn();
vi.mock('../study-chat-client', () => ({
  sendStudyMessage: (...a: unknown[]) => sendStudyMessage(...a),
  requestStudyInsight: vi.fn().mockResolvedValue({ ok: false, reason: 'skipped' }),
}));
vi.mock('../useStudyChatThread', () => ({
  useStudyChatThread: () => ({ messages: [], loading: false, error: null, append: vi.fn(), reload: vi.fn(), archiveAndReset: vi.fn() }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { LamplightStudyPanel } from './LamplightStudyPanel';

describe('LamplightStudyPanel notes-on-offer', () => {
  it('shows the offer after a reply returns offered notes', async () => {
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'r', citations: [], offeredNotes: [{ id: 'n1', title: 'A', snippet: 's' }] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'what about shepherd?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeTruthy());
  });
});
