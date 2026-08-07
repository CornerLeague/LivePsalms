// src/notepad/study/insights/doors.tsx
// The Insights door registry.
//
// Doors are data so the overlay never grows a switch statement: B2 adds "The
// Passage" and B3 adds "Deeper In" by appending here, and the overlay's chooser
// wakes up on its own once the array holds more than one.
import { supabase } from '@/lib/supabase';
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';
import type { BibleTranslation } from '@/notepad/bible/translations';
import type { InsightsDoor } from './InsightsOverlay';
import { ReferenceDoor } from './ReferenceDoor';
import { PassageDoor } from './PassageDoor';
import { makePassageInsightStreamInvoke, type PassageInsightInvoke } from './passage-insight-stream-client';
import { DEEPER_DOOR_VIEW } from './insight-doors';

export interface DoorDeps {
  translation: BibleTranslation;
  userId: string | null;
  adapter: LamplightAdapter | null;
  /**
   * Plus/promo — `hasAccess('inline')`. Gates the GENERATE action only; a
   * cached door is public and free, so every door still renders what is
   * already in the shared cache.
   */
  canGenerate?: boolean;
}

// One transport per client, not one per render: the door array is memoized in
// the workspaces, but `render` runs on every overlay paint.
const passageInvoke: PassageInsightInvoke | null =
  supabase ? makePassageInsightStreamInvoke(supabase) : null;

/**
 * The Passage — Door 1. Generated once and cached globally, so the reader who
 * presses "Study this passage" warms it for everyone after them.
 *
 * Registered only after the live eval baseline went green
 * (`docs/lamplight/evals/2026-08-06-b2-passage-door`). That ordering is the
 * whole lesson of #114: a surface shipped without an eval had a retrieval
 * channel go dark for months with nothing anywhere turning red.
 */
export function passageDoor(deps: DoorDeps): InsightsDoor {
  return {
    id: 'passage',
    label: 'The Passage',
    blurb: 'What this passage is doing, what sits either side of it, the shape of the chapter, and where it lands.',
    render: (scope) => (
      <PassageDoor
        scope={scope}
        invoke={passageInvoke}
        canGenerate={deps.canGenerate === true}
        userId={deps.userId}
      />
    ),
  };
}

/**
 * Deeper In — Door 2. How this kind of writing asks to be read, the world it
 * came out of, the weight it carries, and where it is commonly misread.
 *
 * Registered only after its live baseline went green
 * (`docs/lamplight/evals/2026-08-07-b3-both-doors`, 9/9 across both doors) —
 * the same ordering B2 followed, and for the same reason.
 *
 * Same component and same hook as Door 1. The difference between the doors is a
 * registry entry, not a second implementation.
 */
export function deeperDoor(deps: DoorDeps): InsightsDoor {
  return {
    id: DEEPER_DOOR_VIEW.id,
    label: DEEPER_DOOR_VIEW.label,
    blurb: DEEPER_DOOR_VIEW.blurb,
    render: (scope) => (
      <PassageDoor
        scope={scope}
        invoke={passageInvoke}
        canGenerate={deps.canGenerate === true}
        userId={deps.userId}
        door={DEEPER_DOOR_VIEW}
      />
    ),
  };
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
