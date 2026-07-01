import { describe, it, expect } from 'vitest';
import { parseReferences } from './reference-parser';

describe('parseReferences — single references', () => {
  it('parses a plain "Book chapter:verse"', () => {
    const { refs, unparsed } = parseReferences('John 3:16');
    expect(unparsed).toEqual([]);
    expect(refs).toEqual([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
  });

  it('parses a verse range with a hyphen', () => {
    const { refs } = parseReferences('Ps 23:1-3');
    expect(refs).toEqual([
      { book: 'psa', chapter: 23, verseStart: 1, verseEnd: 3, label: 'Psalm 23:1-3' },
    ]);
  });

  it('parses an en-dash range', () => {
    expect(parseReferences('Eph 2:8–9').refs[0]).toMatchObject({ verseStart: 8, verseEnd: 9 });
  });

  it('is case-insensitive on the book name', () => {
    expect(parseReferences('eph 2:8').refs[0].book).toBe('eph');
    expect(parseReferences('EPHESIANS 2:8').refs[0].book).toBe('eph');
  });
});

describe('parseReferences — abbreviations & numbered books', () => {
  it('resolves common abbreviations that are not plain prefixes', () => {
    expect(parseReferences('Jn 3:16').refs[0].book).toBe('jhn');
    expect(parseReferences('Mt 5:9').refs[0].book).toBe('mat');
    expect(parseReferences('Phil 4:13').refs[0].book).toBe('php');   // Philippians, not Philemon
    expect(parseReferences('Phlm 6').refs).toEqual([]);              // chapter-only -> unparsed (see below)
  });

  it('resolves numbered books with and without a space', () => {
    expect(parseReferences('1 Cor 13:4').refs[0].book).toBe('1co');
    expect(parseReferences('1Cor 13:4').refs[0].book).toBe('1co');
    expect(parseReferences('2 Tim 1:7').refs[0].book).toBe('2ti');
    expect(parseReferences('1 Jn 4:8').refs[0].book).toBe('1jn');
  });

  it('accepts the "Psalms" plural alias', () => {
    expect(parseReferences('Psalms 23:1').refs[0].book).toBe('psa');
  });
});

describe('parseReferences — batches', () => {
  it('splits on commas and newlines and keeps order', () => {
    const { refs } = parseReferences('John 3:16, Ps 23:1-3\nEph 2:8-9');
    expect(refs.map((r) => r.label)).toEqual(['John 3:16', 'Psalm 23:1-3', 'Ephesians 2:8-9']);
  });

  it('adds the parseable refs and reports the unparseable fragments', () => {
    const { refs, unparsed } = parseReferences('John 3:16, gibberish, Eph 2:8');
    expect(refs.map((r) => r.label)).toEqual(['John 3:16', 'Ephesians 2:8']);
    expect(unparsed).toEqual(['gibberish']);
  });

  it('ignores empty fragments from trailing/double separators', () => {
    expect(parseReferences('John 3:16, ,\n').unparsed).toEqual([]);
  });
});

describe('parseReferences — rejections', () => {
  it('rejects an unknown book', () => {
    expect(parseReferences('Hesitations 2:8')).toEqual({ refs: [], unparsed: ['Hesitations 2:8'] });
  });

  it('rejects an out-of-range chapter (John has 21)', () => {
    expect(parseReferences('John 99:1').unparsed).toEqual(['John 99:1']);
  });

  it('rejects a chapter-only reference (a verse is required)', () => {
    expect(parseReferences('Genesis 1').unparsed).toEqual(['Genesis 1']);
  });

  it('rejects an inverted range (end < start)', () => {
    expect(parseReferences('John 3:16-2').unparsed).toEqual(['John 3:16-2']);
  });
});

describe('parseReferences — tolerant separators & punctuation (mobile-friendly)', () => {
  const john316 = { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' };

  it('accepts a period as the chapter:verse separator', () => {
    expect(parseReferences('John 3.16').refs).toEqual([john316]);
  });

  it('accepts a full-width colon from mobile keyboards', () => {
    expect(parseReferences('John 3：16').refs).toEqual([john316]);
  });

  it('accepts no space between the book and the chapter', () => {
    expect(parseReferences('John3:16').refs).toEqual([john316]);
  });

  it('accepts a space as the chapter:verse separator', () => {
    expect(parseReferences('John 3 16').refs).toEqual([john316]);
  });

  it('accepts a period range and normalizes a unicode dash', () => {
    expect(parseReferences('Ps 23.1—3').refs).toEqual([
      { book: 'psa', chapter: 23, verseStart: 1, verseEnd: 3, label: 'Psalm 23:1-3' },
    ]);
  });

  it('still rejects a chapter-only reference after the relaxations', () => {
    expect(parseReferences('Genesis 1').unparsed).toEqual(['Genesis 1']);
  });
});
