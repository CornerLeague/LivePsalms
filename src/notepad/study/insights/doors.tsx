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
import { DEEPER_DOOR_VIEW, PASSAGE_DOOR_VIEW } from './insight-doors';

/**
 * May this reader press "Study this passage"?
 *
 * BOTH conditions, and the `userId` half is the one that was missing.
 * `hasAccess` short-circuits on a global promo — `if (promoActive) return true`
 * — before it ever considers who is asking, so while a promo is running it
 * answers `true` for a signed-out visitor. Both workspaces passed that straight
 * through as `canGenerate`.
 *
 * The reader-visible result, reproduced in the browser on 2026-08-07: a
 * signed-out reader on an uncached door saw the generate button, pressed it,
 * and got "That didn't finish. Try again." — the request 401s with no bearer
 * token, and no amount of trying again will fix it. What they should see is the
 * sign-in path, which `PassageDoor` already renders correctly the moment
 * `canGenerate` tells it the truth.
 *
 * Pre-dates B3: Door 1 has behaved this way since B2. Registering Door 2 simply
 * doubled the surface it appears on. The component's own test asserted the right
 * behaviour and passed, because it sets `canGenerate` directly — the defect was
 * always in the caller.
 */
export function canGenerateInsights(args: {
  userId: string | null;
  hasInlineAccess: boolean;
}): boolean {
  return args.userId !== null && args.hasInlineAccess;
}

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
  /**
   * Carry a section's seeded prompt into study chat (design §2). Supplied by
   * the workspace, which is the only place that can also close the overlay and
   * — on mobile — switch to the Study tab. Omitted means no section footers.
   */
  onHandoff?: (prompt: string) => void;
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
    // Label and blurb read from the registry rather than restated here, as
    // Door 2 already does. Door names are still parent open item 1 — a Myles
    // call in the app's voice — and this makes that pass one file.
    id: PASSAGE_DOOR_VIEW.id,
    label: PASSAGE_DOOR_VIEW.label,
    blurb: PASSAGE_DOOR_VIEW.blurb,
    render: (scope) => (
      <PassageDoor
        scope={scope}
        invoke={passageInvoke}
        canGenerate={deps.canGenerate === true}
        userId={deps.userId}
        onHandoff={deps.onHandoff}
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
        onHandoff={deps.onHandoff}
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
