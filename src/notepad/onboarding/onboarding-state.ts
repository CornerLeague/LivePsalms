import type { AccountProgress, AnonProgress, OnboardingAction } from './onboarding-types';
import { ALL_JOURNEY_ITEM_IDS, defaultAccountProgress } from './onboarding-types';

export interface OnboardingStateInput {
  authLoading: boolean;
  signedIn: boolean;
  eligibleForJourney: boolean;
  anonTourDone: boolean;
  /** Session-only "run the tour now" latch set by the header replay button. */
  tourRequested: boolean;
  anon: AnonProgress | null;
  account: AccountProgress | null;
}

export function decideOnboardingActions(input: OnboardingStateInput): OnboardingAction[] {
  if (input.authLoading) return [];

  // Explicit replay from the header icon runs the tour in EITHER auth state —
  // and, like the first-visit tour, it owns the screen (no checklists beside it).
  if (input.tourRequested) return [{ kind: 'start-tour' }];

  if (!input.signedIn) {
    if (!input.anonTourDone) {
      // Tour owns the screen while it runs — the get-started checklist stays
      // hidden until the tour is completed or skipped (both set anonTourDone),
      // at which point the branch below surfaces it.
      return [{ kind: 'start-tour' }];
    }
    if (input.anon?.dismissed) return [];
    return [{ kind: 'show-get-started' }];
  }

  if (!input.eligibleForJourney) return [];

  const account = input.account ?? defaultAccountProgress();
  if (account.dismissed || isJourneyComplete(account)) return [];

  if (account.guidedNote === 'pending') {
    return [{ kind: 'offer-guided-note' }, { kind: 'show-journey' }];
  }
  return [{ kind: 'show-journey' }];
}

export function isJourneyComplete(account: AccountProgress): boolean {
  return ALL_JOURNEY_ITEM_IDS.every((id) => account.items[id] != null);
}
