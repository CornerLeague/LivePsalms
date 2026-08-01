// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FakeLamplightAdapter } from '../../storage/fake-lamplight-adapter';
import { LamplightTabPanel } from './LamplightTabPanel';

vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: vi.fn(),
}));
import { useAuthSession } from '@/auth/context/useAuthSession';

const useAuthSessionMock = useAuthSession as unknown as ReturnType<typeof vi.fn>;

function renderPanel(adapter: FakeLamplightAdapter) {
  return render(
    <MemoryRouter>
      <LamplightTabPanel lamplightAdapter={adapter} />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  useAuthSessionMock.mockReset();
});

describe('LamplightTabPanel', () => {
  let adapter: FakeLamplightAdapter;

  beforeEach(() => {
    adapter = new FakeLamplightAdapter();
    useAuthSessionMock.mockReturnValue({ user: null });
  });

  it('shows SignInGate for anonymous users', async () => {
    renderPanel(adapter);
    await waitFor(() => {
      expect(screen.getByText(/today's lamp is waiting for you/i)).toBeInTheDocument();
    });
  });

  it('shows ConsentCard for signed-in users with no settings row', async () => {
    useAuthSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    renderPanel(adapter);
    await waitFor(() => {
      expect(screen.getByText(/welcome the lamp/i)).toBeInTheDocument();
    });
  });

  it('shows OptedOutCard for signed-in users with enabled=false', async () => {
    useAuthSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    await adapter.upsertSettings('user-1', {
      enabled: false,
      consentDecidedAt: new Date().toISOString(),
    });
    renderPanel(adapter);
    await waitFor(() => {
      expect(screen.getByText(/lamplight is off/i)).toBeInTheDocument();
    });
  });

  it('shows TodaysLampCard for signed-in users with enabled=true while promo is active', async () => {
    useAuthSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    await adapter.upsertSettings('user-1', {
      enabled: true,
      consentDecidedAt: new Date().toISOString(),
    });
    const today = new Date().toLocaleDateString('en-CA');
    adapter.__seedDailyDevotion('user-1', today, {
      opening: 'A quiet test greeting.',
      scripture: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley…' },
      reflection: 'Test reflection.',
      prompt: 'Test prompt.',
      note_citations: [{ note_id: 'n1', reason: 'test recurrence' }],
    });
    renderPanel(adapter);
    await waitFor(() => {
      expect(screen.getByText(/A quiet test greeting/)).toBeInTheDocument();
    });
  });

  // Reflections was promoted out of the Lamplight card into its own top-level
  // doors (desktop toolbar + mobile tab bar), so the panel no longer renders a
  // "Your Reflections" CTA in any phase.
  it('does not render a "Your Reflections" CTA (promoted to a top-level door)', async () => {
    useAuthSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    await adapter.upsertSettings('user-1', {
      enabled: true,
      consentDecidedAt: new Date().toISOString(),
    });
    const today = new Date().toLocaleDateString('en-CA');
    adapter.__seedDailyDevotion('user-1', today, {
      opening: 'A quiet test greeting.',
      scripture: { ref: 'Psalm 23:4', text: 'Even though I walk through the valley…' },
      reflection: 'Test reflection.',
      prompt: 'Test prompt.',
      note_citations: [{ note_id: 'n1', reason: 'test recurrence' }],
    });
    renderPanel(adapter);
    expect(await screen.findByText(/A quiet test greeting/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Your Reflections' })).toBeNull();
  });

  it('shows PaywallCard for opted-in users when promo is off and tier=none', async () => {
    useAuthSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    adapter.promo = { promoActive: false, promoEndsAt: null };
    await adapter.upsertSettings('user-1', {
      enabled: true,
      consentDecidedAt: new Date().toISOString(),
    });
    renderPanel(adapter);
    await waitFor(() => {
      expect(screen.getByText(/lamplight is no longer included free/i)).toBeInTheDocument();
    });
  });
});
