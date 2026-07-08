// src/notepad/onboarding/onboarding-types.ts
export type OnboardingEvent =
  | 'note-created' | 'verse-linked' | 'highlight-created' | 'scan-completed'
  | 'folder-created' | 'graph-visited' | 'lamplight-connection' | 'search-used'
  | 'tour-step-skipped';

export type AnonItemId = 'write-first-note' | 'link-verse' | 'highlight' | 'create-account';
export type JourneyItemId =
  | 'first-study-note' | 'create-folder' | 'scan-note'
  | 'lamplight-connections' | 'visit-graph' | 'streak-3' | 'search-notes';

export type GuidedNoteStatus = 'pending' | 'done' | 'skipped';

export interface AnonProgress {
  items: Partial<Record<AnonItemId, string>>;
  dismissed: boolean;
}

export interface AccountProgress {
  guidedNote: GuidedNoteStatus;
  items: Partial<Record<JourneyItemId, string>>;
  dismissed: boolean;
  studyDates: string[];
  merged: boolean;
}

export type OnboardingAction =
  | { kind: 'start-tour' }
  | { kind: 'show-get-started' }
  | { kind: 'offer-guided-note' }
  | { kind: 'show-journey' };

/** Anonymous "Get started" checklist completes only on these three events;
 *  'create-account' completes when the user signs in (handled in the provider). */
export const ANON_EVENT_TO_ITEM: Partial<Record<OnboardingEvent, AnonItemId>> = {
  'note-created': 'write-first-note',
  'verse-linked': 'link-verse',
  'highlight-created': 'highlight',
};

/** "Your journey" checklist mapping. streak-3 is computed from studyDates, not an event. */
export const JOURNEY_EVENT_TO_ITEM: Partial<Record<OnboardingEvent, JourneyItemId>> = {
  'note-created': 'first-study-note',
  'folder-created': 'create-folder',
  'scan-completed': 'scan-note',
  'lamplight-connection': 'lamplight-connections',
  'graph-visited': 'visit-graph',
  'search-used': 'search-notes',
};

/** Accounts created at/after this instant are eligible for the journey lane.
 *  Set to the feature launch date so existing users see nothing new. */
export const ONBOARDING_LAUNCH_MS = Date.parse('2026-06-11T00:00:00.000Z');

export const ALL_JOURNEY_ITEM_IDS: JourneyItemId[] = [
  'first-study-note', 'create-folder', 'scan-note',
  'lamplight-connections', 'visit-graph', 'streak-3', 'search-notes',
];

export const ALL_ANON_ITEM_IDS: AnonItemId[] = [
  'write-first-note', 'link-verse', 'highlight', 'create-account',
];

export function defaultAnonProgress(): AnonProgress {
  return { items: {}, dismissed: false };
}

export function defaultAccountProgress(): AccountProgress {
  return { guidedNote: 'pending', items: {}, dismissed: false, studyDates: [], merged: false };
}
