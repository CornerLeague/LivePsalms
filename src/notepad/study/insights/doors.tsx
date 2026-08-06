// src/notepad/study/insights/doors.tsx
// The Insights door registry.
//
// Doors are data so the overlay never grows a switch statement: B2 adds "The
// Passage" and B3 adds "Deeper In" by appending here, and the overlay's chooser
// wakes up on its own once the array holds more than one.
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';
import type { BibleTranslation } from '@/notepad/bible/translations';
import type { InsightsDoor } from './InsightsOverlay';
import { ReferenceDoor } from './ReferenceDoor';

export interface DoorDeps {
  translation: BibleTranslation;
  userId: string | null;
  adapter: LamplightAdapter | null;
}

/**
 * Sources & Reference — the free, instant door. Class A + B only: our own
 * apparatus tables plus quoted library excerpts, so it needs no AI call and no
 * entitlement, and a signed-out reader sees exactly what a subscriber sees.
 */
export function referenceDoor(deps: DoorDeps): InsightsDoor {
  return {
    id: 'reference',
    label: 'Sources & Reference',
    blurb: 'Book context, the church’s voices on this passage, original languages, and cross-references.',
    render: (scope) => (
      <ReferenceDoor
        scope={scope}
        translation={deps.translation}
        userId={deps.userId}
        adapter={deps.adapter}
      />
    ),
  };
}
