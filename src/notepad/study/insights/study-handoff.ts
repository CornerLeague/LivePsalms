// src/notepad/study/insights/study-handoff.ts
// The Insights → Chat seam (parent design §8).
//
// A reader presses a seeded prompt in a section footer; the overlay closes and
// they land in study chat with that question sitting in the input, EDITABLE and
// UNSENT. They stay the author — that is decision 7, and nothing here sends.
//
// The mechanical problem is that a handoff is an EVENT and React delivers props
// as STATE. State is re-read on every render and again on every remount; an
// event must fire exactly once. So a handoff carries a monotonic id and each
// consumer applies an id at most once.
//
// WHY A ONE-SHOT VALUE RATHER THAN LIFTED DRAFT STATE. Parent §8 says the
// mobile seam is "shared draft state, not a remount" — that is why it works
// (the panes are display-toggled, so a draft set here survives the tab switch),
// not a requirement that `draft` live at the workspace. Hoisting it would put
// per-keystroke state at the top of a subtree holding the reader and the
// apparatus rail, so the common case would pay for an event that fires seconds
// apart. The draft stays in LamplightStudyPanel.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface StudyHandoff {
  /**
   * Monotonic, and the identity of the event. The same seeded prompt pressed
   * twice is two handoffs — the reader may have cleared the draft in between.
   */
  id: number;
  /** The prefilled draft. Never sent on its own. */
  text: string;
}

/**
 * Held by a workspace, next to `insightsOpen`.
 *
 * The payload is `{ id, text }` and nothing else. §8 describes the seam as
 * carrying `{ text, scope, section }`; neither of the other two is here, and
 * each absence is a decision rather than an omission (design §2):
 *
 *  · `scope` — the chat panel is already grounded on it. The overlay and
 *    StudySidePanel read the SAME `passage` state in the same workspace, so
 *    book/chapter are identical by construction, and the verse rides in the
 *    prompt's own words because study chat grounds at chapter granularity.
 *  · `section` — nothing in B4 consumes it. Section → retrieval steering is
 *    deliberately not built, and PostHog autocapture identifies the pressed
 *    prompt by its button text. A field with no reader goes stale without
 *    anything turning red; it joins the payload when something reads it.
 */
export function useStudyHandoff(): {
  handoff: StudyHandoff | null;
  sendToChat: (text: string) => void;
} {
  const [handoff, setHandoff] = useState<StudyHandoff | null>(null);
  const nextId = useRef(0);

  // Stable identity: the workspaces memoize their door array on these deps, and
  // a fresh callback per render would rebuild every door on every paint.
  const sendToChat = useCallback((text: string) => {
    nextId.current += 1;
    setHandoff({ id: nextId.current, text });
  }, []);

  return { handoff, sendToChat };
}

/**
 * Apply a handoff exactly once, wherever it lands.
 *
 * Two consumers use this — StudySidePanel switches its tab to Chat,
 * LamplightStudyPanel fills the draft — and doing it right twice by hand is how
 * the two would drift.
 */
export function useApplyHandoff(
  handoff: StudyHandoff | null,
  apply: (handoff: StudyHandoff) => void,
): void {
  /**
   * ⚠️ Seeded with the CURRENT id, not with 0. That one initializer is the
   * whole correctness argument.
   *
   * On desktop the side panel unmounts when the reader collapses the pane, so
   * re-expanding remounts LamplightStudyPanel with the last handoff still
   * sitting in the workspace's state. Seeded with 0, that remount would
   * re-apply it and resurrect a draft the reader had deliberately cleared.
   * Seeded with the current id, a remount applies nothing and the next handoff
   * still lands.
   *
   * It also makes the effect idempotent under StrictMode's double-invoke, so
   * nothing has to bounce a "consumed" callback back up to the workspace.
   */
  const seen = useRef(handoff?.id ?? 0);

  // Same indirection as InsightsOverlay's onCloseRef, for the same reason: an
  // inline callback is a fresh identity every render, and depending on it would
  // re-run this effect on every paint.
  const applyRef = useRef(apply);
  useEffect(() => { applyRef.current = apply; }, [apply]);

  useEffect(() => {
    if (!handoff || handoff.id === seen.current) return;
    seen.current = handoff.id;
    applyRef.current(handoff);
  }, [handoff]);
}
