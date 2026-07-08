import { describe, it, expect } from 'vitest';
import { decideOnboardingActions } from './onboarding-state';
import type { AccountProgress, AnonProgress } from './onboarding-types';
import { ALL_JOURNEY_ITEM_IDS, defaultAccountProgress } from './onboarding-types';

const anon = (over: Partial<AnonProgress> = {}): AnonProgress => ({ items: {}, dismissed: false, ...over });
const acct = (over: Partial<AccountProgress> = {}): AccountProgress => ({ ...defaultAccountProgress(), ...over });

describe('decideOnboardingActions', () => {
  it('returns nothing while auth is loading', () => {
    expect(decideOnboardingActions({
      authLoading: true, signedIn: false, eligibleForJourney: false,
      anonTourDone: false, anon: null, account: null,
    })).toEqual([]);
  });

  describe('signed out (anonymous lane)', () => {
    it('first visit: starts the tour only (get-started stays hidden until the tour ends)', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: false, eligibleForJourney: false,
        anonTourDone: false, anon: null, account: null,
      })).toEqual([{ kind: 'start-tour' }]);
    });
    it('tour done, checklist active: shows get-started only', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: false, eligibleForJourney: false,
        anonTourDone: true, anon: anon(), account: null,
      })).toEqual([{ kind: 'show-get-started' }]);
    });
    it('tour done, checklist dismissed: nothing', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: false, eligibleForJourney: false,
        anonTourDone: true, anon: anon({ dismissed: true }), account: null,
      })).toEqual([]);
    });
  });

  describe('signed in', () => {
    it('ineligible account (pre-launch): nothing', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: false,
        anonTourDone: true, anon: null, account: acct(),
      })).toEqual([]);
    });
    it('eligible, guided note pending: offers guided note + journey', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: acct({ guidedNote: 'pending' }),
      })).toEqual([{ kind: 'offer-guided-note' }, { kind: 'show-journey' }]);
    });
    it('eligible, null account treated as fresh -> offer + journey', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: null,
      })).toEqual([{ kind: 'offer-guided-note' }, { kind: 'show-journey' }]);
    });
    it('eligible, guided note skipped: journey only', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: acct({ guidedNote: 'skipped' }),
      })).toEqual([{ kind: 'show-journey' }]);
    });
    it('eligible, journey dismissed: nothing', () => {
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null, account: acct({ guidedNote: 'done', dismissed: true }),
      })).toEqual([]);
    });
    it('eligible, all journey items complete: nothing (retires itself)', () => {
      const items = Object.fromEntries(ALL_JOURNEY_ITEM_IDS.map((id) => [id, '2026-06-11T00:00:00Z']));
      expect(decideOnboardingActions({
        authLoading: false, signedIn: true, eligibleForJourney: true,
        anonTourDone: true, anon: null,
        account: acct({ guidedNote: 'done', items: items as AccountProgress['items'] }),
      })).toEqual([]);
    });
  });
});
