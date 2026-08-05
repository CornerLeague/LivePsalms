import { describe, it, expect } from 'vitest';
import { normalizeRef, HEBREW_TO_ENGLISH_DELTAS } from './versification';

describe('normalizeRef — english-tradition sources (KJV-versified commentaries)', () => {
  it('passes an ordinary ref through unchanged', () => {
    expect(normalizeRef({ book: 'psa', chapter: 27, verse: 4 }, 'english'))
      .toEqual({ book: 'psa', chapter: 27, verse: 4 });
  });

  it('leaves Psalm refs alone — KJV and BSB both exclude superscriptions from the count', () => {
    expect(normalizeRef({ book: 'psa', chapter: 51, verse: 1 }, 'english'))
      .toEqual({ book: 'psa', chapter: 51, verse: 1 });
  });

  it('leaves Joel alone — both traditions use the 3-chapter English division', () => {
    expect(normalizeRef({ book: 'jol', chapter: 2, verse: 28 }, 'english'))
      .toEqual({ book: 'jol', chapter: 2, verse: 28 });
  });
});

describe('normalizeRef — hebrew-tradition sources', () => {
  it('shifts a Psalm verse down by its superscription offset', () => {
    // Hebrew Ps 51:3 (superscription is vv.1-2) == English Ps 51:1
    expect(normalizeRef({ book: 'psa', chapter: 51, verse: 3 }, 'hebrew'))
      .toEqual({ book: 'psa', chapter: 51, verse: 1 });
  });

  it('shifts a single-line superscription psalm by one', () => {
    // Hebrew Ps 3:2 == English Ps 3:1
    expect(normalizeRef({ book: 'psa', chapter: 3, verse: 2 }, 'hebrew'))
      .toEqual({ book: 'psa', chapter: 3, verse: 1 });
  });

  it('leaves a psalm with no superscription untouched', () => {
    expect(normalizeRef({ book: 'psa', chapter: 1, verse: 1 }, 'hebrew'))
      .toEqual({ book: 'psa', chapter: 1, verse: 1 });
  });

  it('maps Hebrew Joel 3 into English Joel 2', () => {
    // Hebrew Joel 3:1 == English Joel 2:28
    expect(normalizeRef({ book: 'jol', chapter: 3, verse: 1 }, 'hebrew'))
      .toEqual({ book: 'jol', chapter: 2, verse: 28 });
  });

  it('maps Hebrew Malachi 3:19 into English Malachi 4:1', () => {
    expect(normalizeRef({ book: 'mal', chapter: 3, verse: 19 }, 'hebrew'))
      .toEqual({ book: 'mal', chapter: 4, verse: 1 });
  });
});

describe('normalizeRef — guards', () => {
  it('throws loudly on an unknown book code rather than silently dropping', () => {
    expect(() => normalizeRef({ book: 'nope', chapter: 1, verse: 1 }, 'english'))
      .toThrow(/unknown book/i);
  });

  it('throws on a non-positive chapter or verse', () => {
    expect(() => normalizeRef({ book: 'psa', chapter: 0, verse: 1 }, 'english')).toThrow();
    expect(() => normalizeRef({ book: 'psa', chapter: 1, verse: 0 }, 'english')).toThrow();
  });

  it('handles a chapter-level ref (no verse) without inventing one', () => {
    expect(normalizeRef({ book: 'psa', chapter: 27 }, 'english'))
      .toEqual({ book: 'psa', chapter: 27 });
    // A hebrew chapter-level psalm ref cannot be verse-shifted; it passes through.
    expect(normalizeRef({ book: 'psa', chapter: 51 }, 'hebrew'))
      .toEqual({ book: 'psa', chapter: 51 });
  });
});

describe('HEBREW_TO_ENGLISH_DELTAS', () => {
  it('is documented data, not scattered conditionals', () => {
    expect(Array.isArray(HEBREW_TO_ENGLISH_DELTAS)).toBe(true);
    for (const d of HEBREW_TO_ENGLISH_DELTAS) {
      expect(typeof d.book).toBe('string');
      expect(typeof d.note).toBe('string');   // every delta carries its rationale
      expect(d.note.length).toBeGreaterThan(0);
    }
  });
});
