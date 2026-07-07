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

// LamplightTabPanel now reads the username (final-review fix, Critical 2) to build a
// vanity-aware link to The Path. Mocked the same way useAuthSession is above, rather
// than wrapping every render in a real AuthProvider — this file already exercises the
// component in isolation from AuthProvider entirely.
vi.mock('@/auth/context/useAccountProfile', () => ({
  useAccountProfile: vi.fn(),
}));
import { useAccountProfile } from '@/auth/context/useAccountProfile';

const useAuthSessionMock = useAuthSession as unknown as ReturnType<typeof vi.fn>;
const useAccountProfileMock = useAccountProfile as unknown as ReturnType<typeof vi.fn>;

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
  useAccountProfileMock.mockReset();
});

describe('LamplightTabPanel', () => {
  let adapter: FakeLamplightAdapter;

  beforeEach(() => {
    adapter = new FakeLamplightAdapter();
    useAuthSessionMock.mockReturnValue({ user: null });
    useAccountProfileMock.mockReturnValue({ profile: { username: 'reader1' } });
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
    // Final-review fix (Critical 2): the invitation link targets the vanity mount, not
    // the legacy /notebook/reflections path that used to strand every signed-in reader.
    expect(screen.getByRole('link', { name: /your path of months is here/i }))
      .toHaveAttribute('href', '/notebook/u/reader1/reflections');
  });

  it('falls back to the legacy /notebook/reflections link while the username has not loaded yet', async () => {
    useAuthSessionMock.mockReturnValue({ user: { id: 'user-1' } });
    useAccountProfileMock.mockReturnValue({ profile: null });
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
      expect(screen.getByRole('link', { name: /your path of months is here/i }))
        .toHaveAttribute('href', '/notebook/reflections');
    });
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
