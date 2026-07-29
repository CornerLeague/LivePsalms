import { createContext, useContext } from 'react';
import type {
  AccountProgress,
  AnonProgress,
  OnboardingAction,
  OnboardingEvent,
} from './onboarding-types';

export interface OnboardingContextValue {
  actions: OnboardingAction[];
  /** Auth state, surfaced so tour UI can adapt (e.g. hide the sign-up CTA). */
  signedIn: boolean;
  anon: AnonProgress | null;
  account: AccountProgress | null;
  reportOnboardingEvent: (event: OnboardingEvent) => void;
  completeGuidedNote: (status: 'done' | 'skipped') => void;
  dismissChecklist: () => void;
  replayTour: () => void;
  markTourDone: () => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within an OnboardingProvider');
  return ctx;
}
