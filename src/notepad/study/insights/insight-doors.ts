// src/notepad/study/insights/insight-doors.ts
// The client's Insights door registry.
//
// MIRRORS the server's `lamplight-study/insight-doors.ts`. The section KEYS are
// the contract — they are the `section` column values the server writes, and the
// values this client reads back — and the labels are presentation, which the
// server has no opinion about.
//
// Copied rather than imported, for the same reason `passage-insight-stream-client.ts`
// copies the SSE event type: a `src` module must not import from
// `supabase/functions`, or the edge-function code ends up in the app bundle.
//
// ⚠️ There are now TWO mirrors instead of B2's one, and a drift breaks nothing
// loudly — the cache simply never hits, and every reader pays to generate a door
// that is already sitting in the table. `insight-doors.parity.test.ts` compares
// these keys to the server's registry directly, per door.

export interface InsightSectionView {
  /** Must equal the server section key exactly — this is the cache contract. */
  key: string;
  /** Presentation only. The server never sees this. */
  label: string;
}

export interface InsightDoorView {
  /** The `door` column value, and what the client sends in the request body. */
  id: string;
  label: string;
  blurb: string;
  sections: readonly InsightSectionView[];
}

/**
 * Door 1 — The Passage. What the passage is doing, outward from the verse.
 */
export const PASSAGE_DOOR_VIEW: InsightDoorView = {
  id: 'passage',
  label: 'The Passage',
  blurb: 'What this passage is doing, what sits either side of it, the shape of the chapter, and where it lands.',
  sections: [
    { key: 'overview', label: 'Overview' },
    { key: 'in_chapter', label: 'In the Chapter' },
    { key: 'chapter_shape', label: "The Chapter's Shape" },
    { key: 'reflection', label: 'Reflection & Application' },
  ],
};

/**
 * Door 2 — Deeper In. How to read it, where it came from, what it carries, and
 * how it gets misread.
 */
export const DEEPER_DOOR_VIEW: InsightDoorView = {
  id: 'deeper',
  label: 'Deeper In',
  blurb: 'How this kind of writing asks to be read, the world it came out of, the weight it carries, and where it is commonly misread.',
  sections: [
    { key: 'hermeneutics', label: 'How to Read This Passage' },
    { key: 'historical_setting', label: 'Historical & Cultural Setting' },
    { key: 'theology', label: 'Theological Significance' },
    { key: 'read_with_care', label: 'Read With Care' },
  ],
};

export const INSIGHT_DOOR_VIEWS: readonly InsightDoorView[] = [PASSAGE_DOOR_VIEW, DEEPER_DOOR_VIEW];

/**
 * B2's `PASSAGE_SECTIONS`, kept as an alias.
 *
 * @deprecated prefer a door view's `sections`.
 */
export const PASSAGE_SECTIONS = PASSAGE_DOOR_VIEW.sections;
