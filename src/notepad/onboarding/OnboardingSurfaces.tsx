import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLoadingOverlayVisible } from '@/hooks/loading-overlay-context';
import { useOnboarding } from './useOnboarding';
import { ChecklistPanel } from './checklist/ChecklistPanel';
import { GET_STARTED_ITEMS } from './checklist/get-started-items';
import { JOURNEY_ITEMS } from './checklist/journey-items';
import { SpotlightOverlay } from './tour/SpotlightOverlay';
import { TOUR_STEPS } from './tour/tour-steps';
import { getWorkspaceControls } from './tour/workspace-controller';
import { isJourneyComplete } from './onboarding-state';
import type { AccountProgress, AnonProgress } from './onboarding-types';

/**
 * completedMap projects the timestamp-keyed `items` record (id -> ISO string)
 * onto the boolean shape ChecklistPanel expects (present = completed). A null
 * progress object yields an empty map.
 */
function completedMap(
  progress: { items: Partial<Record<string, string>> } | null,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!progress) return out;
  for (const [id, ts] of Object.entries(progress.items)) {
    if (ts != null) out[id] = true;
  }
  return out;
}

/**
 * The "Get started" anonymous checklist. Owns its own collapsed state so it is
 * never coupled to the journey panel's expansion.
 */
function GetStartedPanel({
  anon,
  onReplayTour,
  onDismiss,
}: {
  anon: AnonProgress | null;
  onReplayTour: () => void;
  onDismiss: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ChecklistPanel
      title="Get started"
      items={GET_STARTED_ITEMS}
      completed={completedMap(anon)}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((c) => !c)}
      onReplayTour={onReplayTour}
      onDismiss={onDismiss}
    />
  );
}

/**
 * The "Your journey" account checklist plus its completion finale. Owns its own
 * collapsed state, independent of the get-started panel.
 */
function JourneyPanel({
  account,
  onDismiss,
}: {
  account: AccountProgress | null;
  onDismiss: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ChecklistPanel
        title="Your journey"
        items={JOURNEY_ITEMS}
        completed={completedMap(account)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onDismiss={onDismiss}
      />
      {account && isJourneyComplete(account) && (
        <div
          className="flex flex-col items-center text-center gap-2 p-6 rounded-lg max-w-xs"
          style={{
            background: 'var(--alabaster)',
            border: '1px solid var(--pale-stone)',
            fontFamily: 'Outfit, sans-serif',
          }}
          role="status"
        >
          <span className="text-3xl" aria-hidden="true">
            🔥
          </span>
          <p className="text-sm font-semibold" style={{ color: 'var(--deep-umber)' }}>
            Your journey is complete
          </p>
          <button
            onClick={onDismiss}
            className="mt-1 px-5 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--deep-umber)', color: 'var(--plaster)' }}
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}

export interface OnboardingSurfacesProps {
  /** Creates + opens the seeded guided study note. Wired by the workspace mount. */
  onStartGuidedNote?: () => void | Promise<void>;
}

/**
 * Thin dispatcher that consumes useOnboarding() and renders the tour /
 * checklist / guided-note offer surfaces based on the decided `actions`.
 * Renders nothing when there are no actions.
 *
 * The full-screen SpotlightOverlay is portaled to document.body so it is never
 * trapped inside whatever positioned/stacking-context wrapper hosts this
 * component (e.g. the workspace's `fixed bottom-4 right-4 z-[90]` shell). The
 * remaining checklist/offer surfaces render inline within that wrapper.
 */
export function OnboardingSurfaces({ onStartGuidedNote }: OnboardingSurfacesProps) {
  const overlayVisible = useLoadingOverlayVisible();
  const {
    actions,
    anon,
    account,
    completeGuidedNote,
    dismissChecklist,
    replayTour,
    markTourDone,
  } = useOnboarding();

  // Hold the tour + checklist until the global loading screen has fully
  // dissolved, so they never paint on top of the loading overlay.
  if (overlayVisible) return null;
  if (actions.length === 0) return null;

  return (
    <>
      {actions.map((action) => {
        switch (action.kind) {
          case 'start-tour':
            return createPortal(
              <SpotlightOverlay
                steps={TOUR_STEPS}
                onComplete={markTourDone}
                onSkip={markTourDone}
                onSignUp={() => {
                  // Fixes the old onSignUp no-op TODO (spec §3 step 8): finish the tour,
                  // then open the viewport's auth surface via the registry (desktop →
                  // /login route, mobile → MobileAuthModal).
                  markTourDone();
                  getWorkspaceControls().openAuth?.();
                }}
              />,
              document.body,
              'start-tour',
            );

          case 'show-get-started':
            return (
              <GetStartedPanel
                key="show-get-started"
                anon={anon}
                onReplayTour={replayTour}
                onDismiss={dismissChecklist}
              />
            );

          case 'offer-guided-note':
            return (
              <div
                key="offer-guided-note"
                className="flex flex-col gap-2 p-4 rounded-lg max-w-xs"
                style={{
                  background: 'var(--alabaster)',
                  border: '1px solid var(--pale-stone)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                <p className="text-sm font-semibold" style={{ color: 'var(--deep-umber)' }}>
                  Start a guided study note
                </p>
                <p className="text-xs" style={{ color: 'var(--silica)' }}>
                  A short walkthrough that shows you how to study here.
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={async () => {
                      await onStartGuidedNote?.();
                      completeGuidedNote('done');
                    }}
                    className="px-4 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ background: 'var(--deep-umber)', color: 'var(--plaster)' }}
                  >
                    Start guided note
                  </button>
                  <button
                    onClick={() => completeGuidedNote('skipped')}
                    className="text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: 'var(--silica)' }}
                  >
                    Skip
                  </button>
                </div>
              </div>
            );

          case 'show-journey':
            return (
              <JourneyPanel key="show-journey" account={account} onDismiss={dismissChecklist} />
            );

          default:
            return null;
        }
      })}
    </>
  );
}
