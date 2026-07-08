/** A first-study note seeded with inline "try it" prompts. content is TipTap
 *  doc JSON stringified — the shape StorageAdapter.createNote stores. */
export function buildGuidedNote(): { title: string; content: string } {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Your first study note' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Welcome! This note walks you through three things that make studying here powerful. Edit freely — it is yours.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '1. Link a verse — type a reference like John 3:16 and it becomes a living link.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '2. Highlight a line — select any text and pick a highlight color from the toolbar.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '3. Ask Lamplight — open the Lamplight panel to discover connections to your other notes.' }] },
    ],
  };
  return { title: 'Your first study note', content: JSON.stringify(doc) };
}

export const TOUR_SAMPLE_NOTE_TITLE = 'A guided study (sample)';

/**
 * The sample study note the tour creates and drives (locked decision 6: kept
 * after the tour, explicit sample marker in the title — idempotent reuse
 * detects it by this exact title). The scriptureRef node makes step 3's
 * verse-chip anchor guaranteed-present. `content` is a stringified TipTap doc,
 * same contract as buildGuidedNote().
 */
export function buildTourSampleNote(): { title: string; content: string } {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Grace shows up before we ask.',
            marks: [{ type: 'styleHighlight', attrs: { swatchId: 'highlight-01' } }],
          },
          {
            type: 'text',
            text: ' This page keeps coming back to one verse:',
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'scriptureRef',
            attrs: {
              osis: 'jhn.3.16',
              book: 'John',
              chapter: 3,
              verseStart: 16,
              verseEnd: null,
              translation: 'BSB',
              text: 'For God so loved the world…',
            },
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Love that gives first. What would it look like to trust that this week?',
          },
        ],
      },
    ],
  };
  return { title: TOUR_SAMPLE_NOTE_TITLE, content: JSON.stringify(doc) };
}
