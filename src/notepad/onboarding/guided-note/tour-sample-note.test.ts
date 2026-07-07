import { describe, expect, it } from 'vitest';
import { TOUR_SAMPLE_NOTE_TITLE, buildTourSampleNote } from './guided-note-template';

interface DocNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
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

  it('pre-seeds exactly one styleHighlight run (swatch highlight-01) for the highlights step', () => {
    const doc = JSON.parse(buildTourSampleNote().content) as DocNode;
    const marks = (doc.content ?? [])
      .flatMap((p) => p.content ?? [])
      .flatMap((node) => node.marks ?? []);
    const highlights = marks.filter((m) => m.type === 'styleHighlight');
    expect(highlights).toHaveLength(1);
    expect(highlights[0].attrs).toEqual({ swatchId: 'highlight-01' });
  });
});
