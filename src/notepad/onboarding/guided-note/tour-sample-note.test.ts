import { describe, expect, it } from 'vitest';
import { TOUR_SAMPLE_NOTE_TITLE, buildTourSampleNote } from './guided-note-template';

interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

describe('buildTourSampleNote', () => {
  it('titles the note with the exact sample marker (locked decision 6)', () => {
    expect(TOUR_SAMPLE_NOTE_TITLE).toBe('A guided study (sample)');
    expect(buildTourSampleNote().title).toBe('A guided study (sample)');
  });

  it('embeds one scriptureRef node with complete, valid attrs', () => {
    const doc = JSON.parse(buildTourSampleNote().content) as DocNode;
    expect(doc.type).toBe('doc');
    const chips = (doc.content ?? [])
      .flatMap((paragraph) => paragraph.content ?? [])
      .filter((node) => node.type === 'scriptureRef');
    expect(chips).toHaveLength(1);
    expect(chips[0].attrs).toEqual({
      osis: 'jhn.3.16',
      book: 'John',
      chapter: 3,
      verseStart: 16,
      verseEnd: null,
      translation: 'BSB',
      text: 'For God so loved the world…',
    });
  });
});
