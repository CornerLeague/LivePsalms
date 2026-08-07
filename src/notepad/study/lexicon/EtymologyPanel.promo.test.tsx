// @vitest-environment jsdom
// src/notepad/study/lexicon/EtymologyPanel.promo.test.tsx
//
// The signed-out-during-promo case, driven through the REAL
// `useLamplightEntitlement`.
//
// ⚠️ Its own file on purpose. `EtymologyPanel.test.tsx` mocks the entitlement
// hook wholesale with `promoActive: false` and a `hasAccess` stub — so the real
// short-circuit (`if (promoActive) return true`, before it considers who is
// asking) is executed nowhere in that suite, and the mock hardcodes the safe
// side of the very condition the defect needs. A test cannot fail on a branch
// its mock has legislated away.
//
// That is #120's lesson one step deeper. There, `PassageDoor`'s own test
// asserted the right behaviour and passed the whole time because it set
// `canGenerate` directly — the defect was in the caller. Here the caller IS
// under test, and the mock still hid it.
//
// So: no entitlement mock. A FakeLamplightAdapter with a live promo, a null
// userId, and the real hook in between.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FakeLamplightAdapter } from '@/notepad/storage/fake-lamplight-adapter';
import type { EtymologyEntry } from './buildEtymologyDeck';

const useVerseLexicon = vi.fn();
const useReviewedEtymologyEntries = vi.fn();
const useEtymologyVerseInsight = vi.fn();
const generate = vi.fn();

vi.mock('./useVerseLexicon', () => ({ useVerseLexicon: (...a: unknown[]) => useVerseLexicon(...a) }));
vi.mock('./useReviewedEtymologyEntries', () => ({ useReviewedEtymologyEntries: (...a: unknown[]) => useReviewedEtymologyEntries(...a) }));
vi.mock('./useEtymologyVerseInsight', () => ({ useEtymologyVerseInsight: (...a: unknown[]) => useEtymologyVerseInsight(...a) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));
// NOTE: useLamplightEntitlement is deliberately NOT mocked.

import { EtymologyPanel } from './EtymologyPanel';

const entry: EtymologyEntry = {
  strongs: 'H7462', lemma: 'רָעָה', root: 'רעה', rootGloss: 'to tend, graze',
  development: 'From tending a flock, the shepherd-king image grew.',
  related: [], studyValue: 9, source: "Strong's + BDB",
};
const words = [{ position: 4, original: 'רֹעִי', transliteration: 'roi', strongs: 'H7462', morph: 'HVqrmsc/Sp1bs', gloss: 'my shepherd' }];

let adapter: FakeLamplightAdapter;

beforeEach(() => {
  adapter = new FakeLamplightAdapter();
  // Production's actual state, and the whole precondition of the defect.
  adapter.promo = { promoActive: true, promoEndsAt: null };
  useVerseLexicon.mockReturnValue({ words, language: 'hebrew', loading: false, error: null });
  useReviewedEtymologyEntries.mockReturnValue({ entries: new Map([['H7462', entry]]), loading: false, error: null });
  useEtymologyVerseInsight.mockReturnValue({ insight: null, loading: false, error: null, generating: false, generate });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const base = { verseId: 'psa.23.1', reference: 'Psalm 23:1' };

/**
 * The panel starts collapsed; the card under test lives behind its header.
 *
 * MemoryRouter because SignInGate and PaywallCard navigate — which the existing
 * suite never needed, since its `hasAccess` stub always returns true and so
 * neither blocked affordance ever rendered. One more way that mock kept the
 * branch that matters out of reach.
 */
function renderPanel(props: { userId: string | null }) {
  render(
    <MemoryRouter>
      <EtymologyPanel {...base} userId={props.userId} adapter={adapter} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
}

describe('EtymologyPanel while the global promo is running', () => {
  it('⚠️ offers a SIGNED-OUT reader the sign-in path, not the generate action', async () => {
    // Reproduced in a browser before this test existed: the card offered "Ask
    // Lamplight about this verse", no sign-in affordance rendered anywhere, and
    // pressing it fired a request to `etymology-insight` that 401s with no
    // bearer token — leaving nothing at all on screen.
    renderPanel({ userId: null });

    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /ask lamplight about this verse/i })).toBeNull();
  });

  it('never calls generate for a signed-out reader', async () => {
    renderPanel({ userId: null });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy());
    expect(generate).not.toHaveBeenCalled();
  });

  it('still offers the action to a SIGNED-IN reader on the same promo', async () => {
    // The promo is what makes them entitled — the fix must not cost them that.
    renderPanel({ userId: 'u1' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ask lamplight about this verse/i })).toBeTruthy(),
    );
  });

  it('shows the paywall, not the sign-in path, to a signed-in reader with no promo and no tier', async () => {
    adapter.promo = { promoActive: false, promoEndsAt: null };
    renderPanel({ userId: 'u1' });

    await waitFor(() => expect(screen.queryByRole('button', { name: /ask lamplight/i })).toBeNull());
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
