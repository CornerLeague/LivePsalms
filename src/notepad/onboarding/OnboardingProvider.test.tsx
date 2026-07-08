// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { OnboardingProvider } from './OnboardingProvider';
import { useOnboarding } from './useOnboarding';

const authState = vi.fn();
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => authState() }));
// Force the localStorage path for account progress (supabase null).
vi.mock('@/lib/supabase', () => ({ supabase: null }));

function Probe() {
  const o = useOnboarding();
  return (
    <div>
      <span data-testid="actions">{o.actions.map((a) => a.kind).join(',')}</span>
      <button onClick={() => o.reportOnboardingEvent('note-created')}>note</button>
      <span data-testid="anon-first">{String(o.anon?.items['write-first-note'] != null)}</span>
      <span data-testid="acct-first">{String(o.account?.items['first-study-note'] != null)}</span>
      <span data-testid="acct-dates">{(o.account?.studyDates ?? []).join(',')}</span>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  authState.mockReturnValue({ user: null, loading: false });
});
afterEach(cleanup);

describe('OnboardingProvider', () => {
  it('signed-out first visit yields start-tour only (get-started stays hidden during the tour)', async () => {
    render(<OnboardingProvider><Probe /></OnboardingProvider>);
    await waitFor(() => expect(screen.getByTestId('actions').textContent).toBe('start-tour'));
  });

  it('reportOnboardingEvent(note-created) marks the anon checklist item', async () => {
    render(<OnboardingProvider><Probe /></OnboardingProvider>);
    await act(async () => { screen.getByText('note').click(); });
    await waitFor(() => expect(screen.getByTestId('anon-first').textContent).toBe('true'));
    expect(localStorage.getItem('onboarding_anon_checklist')).toContain('write-first-note');
  });

  it('never throws when adapter/auth is degraded', async () => {
    authState.mockReturnValue({ user: { id: 'u1', created_at: '2026-06-12T00:00:00Z' }, loading: false });
    expect(() => render(<OnboardingProvider><Probe /></OnboardingProvider>)).not.toThrow();
  });

  it('returning eligible user: pre-existing merged account progress is not clobbered by the merge effect', async () => {
    const stored = {
      guidedNote: 'done',
      items: { 'first-study-note': '2026-06-11T10:00:00.000Z' },
      dismissed: false,
      studyDates: ['2026-06-11', '2026-06-12'],
      merged: true,
    };
    localStorage.setItem('onboarding_account_progress_u1', JSON.stringify(stored));
    authState.mockReturnValue({ user: { id: 'u1', created_at: '2026-06-12T00:00:00Z' }, loading: false });

    render(<OnboardingProvider><Probe /></OnboardingProvider>);

    // Wait for the async account load to surface the real stored progress.
    await waitFor(() => expect(screen.getByTestId('acct-first').textContent).toBe('true'));
    await waitFor(() => expect(screen.getByTestId('acct-dates').textContent).toBe('2026-06-11,2026-06-12'));

    // Give the (one-time) merge effect a chance to run / re-run after load.
    await act(async () => { await Promise.resolve(); });

    const after = JSON.parse(localStorage.getItem('onboarding_account_progress_u1')!);
    expect(after.items['first-study-note']).toBe('2026-06-11T10:00:00.000Z');
    expect(after.studyDates).toEqual(['2026-06-11', '2026-06-12']);
    expect(after.guidedNote).toBe('done');
  });
});
