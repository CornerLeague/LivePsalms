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
//
// B4 adds `seededPrompt`, which is CLIENT-ONLY. The parity test compares
// section keys and their order and nothing else, so a field the server has no
// opinion about is safe here by construction. Renaming or reordering a key is
// still the thing that must not happen.
import { bookByAbbrev } from '@/notepad/bible/bible-books';

/**
 * The open passage, in the form a seeded prompt is allowed to print.
 *
 * READER FORM ONLY. `bible_passages.book` holds the OSIS code, and the one time
 * an internal ref reached prose a reader saw "psa 27:2" — which is what
 * `displayRefs` exists to prevent on the generated side. These strings are
 * written by us rather than by a model, which makes them easier to get right
 * and exactly as easy to get wrong, so the reference is composed in one place.
 */
export interface InsightPromptRef {
  /** "Psalm 27" or "Psalm 27:4". */
  passage: string;
  /** "Psalm". Wanted on its own by the prompt that asks about the whole book. */
  book: string;
  chapter: number;
  /** null = the whole chapter. */
  verse: number | null;
}

/** Compose the reader-form reference a seeded prompt is handed. */
export function insightPromptRef(scope: { book: string; chapter: number; verse: number | null }): InsightPromptRef {
  // Falls back to the raw code rather than to `undefined` — an unknown book is
  // a bug somewhere else and must not become "What is undefined 3 not saying?".
  const book = bookByAbbrev(scope.book)?.name ?? scope.book;
  const passage = scope.verse === null
    ? `${book} ${scope.chapter}`
    : `${book} ${scope.chapter}:${scope.verse}`;
  return { passage, book, chapter: scope.chapter, verse: scope.verse };
}

export interface InsightSectionView {
  /** Must equal the server section key exactly — this is the cache contract. */
  key: string;
  /** Presentation only. The server never sees this. */
  label: string;
  /**
   * The question this section's footer offers to carry into study chat.
   *
   * A FUNCTION rather than a template string with `{passage}` tokens: one of
   * the eight wants the book name alone, and a function gets that without
   * inventing a mini-language and a parser to test it.
   *
   * Each one is a question the section PROVOKES, not the one it answered — a
   * footer prompt that restates its own section is a dead end dressed as a
   * door. And each is section-scoped in its own words on purpose: study chat
   * uses the message as its retrieval query, so those words ARE the retrieval
   * steering that parent §8's third seam would otherwise buy with a hard
   * `registers` filter (design §1).
   */
  seededPrompt: (ref: InsightPromptRef) => string;
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
    {
      key: 'overview',
      label: 'Overview',
      // The Overview says what the passage is doing; what it cannot say is
      // which part of it resists a first reading.
      seededPrompt: (r) => `What is the hardest thing to understand in ${r.passage}?`,
    },
    {
      key: 'in_chapter',
      label: 'In the Chapter',
      // The section names what sits either side. The question left over is why
      // the order is the order.
      seededPrompt: (r) => `Why does ${r.passage} come where it does?`,
    },
    {
      key: 'chapter_shape',
      label: "The Chapter's Shape",
      // One level out from the section, which stops at the chapter. The only
      // prompt that wants the book name on its own.
      seededPrompt: (r) => `How does this chapter fit into the rest of ${r.book}?`,
    },
    {
      key: 'reflection',
      label: 'Reflection & Application',
      // Deliberately historical rather than personal: it leans on the library
      // the reader can see in Sources & Reference, and it keeps the
      // non-prophetic voice that the whole surface is built around.
      seededPrompt: (r) => `How have Christians through history applied ${r.passage}?`,
    },
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
    {
      key: 'hermeneutics',
      label: 'How to Read This Passage',
      // The section gives the genre's rules for THIS passage; the question it
      // provokes is where else those rules apply — which is a cross-reference
      // question, and cross-references are grounding study chat already holds.
      seededPrompt: () => 'Where else in Scripture does this kind of writing appear?',
    },
    {
      key: 'historical_setting',
      label: 'Historical & Cultural Setting',
      seededPrompt: (r) => `What would the first hearers of ${r.passage} have already known?`,
    },
    {
      key: 'theology',
      label: 'Theological Significance',
      // ⚠️ Read this one twice. On a contested chapter it lands the reader in
      // the one surface holding `allowContestedRefs` — deliberately, and it is
      // why the two surfaces differ. The door describes and declines to
      // adjudicate; chat may name the question as disputed and say who
      // disputes it. `TRADITION_TERMS` is scoped to `read_with_care` on the
      // Deeper door and does not reach chat, so nothing here contradicts §9.
      seededPrompt: (r) => `Do Christians read ${r.passage} the same way?`,
    },
    {
      key: 'read_with_care',
      label: 'Read With Care',
      seededPrompt: (r) => `What is ${r.passage} not saying?`,
    },
  ],
};

export const INSIGHT_DOOR_VIEWS: readonly InsightDoorView[] = [PASSAGE_DOOR_VIEW, DEEPER_DOOR_VIEW];

/**
 * B2's `PASSAGE_SECTIONS`, kept as an alias.
 *
 * @deprecated prefer a door view's `sections`.
 */
export const PASSAGE_SECTIONS = PASSAGE_DOOR_VIEW.sections;
