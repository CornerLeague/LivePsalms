import { describe, it, expect } from 'vitest';
import { parseBsbToRows, parseBsbText } from './ingest-bsb';

const SAMPLE = `The Holy Bible
preamble line
Verse\tText
John 1:1\tIn the beginning was the Word.
John 1:2\tHe was with God in the beginning.
`;

const FIXTURE = {
  // Tiny BSB fragment — Psalm 23:1-2 and Psalm 24:1.
  books: [
    { name: 'Psalm', abbrev: 'psa', chapters: [
      { number: 23, verses: [
        { number: 1, text: 'The LORD is my shepherd; I shall not want.' },
        { number: 2, text: 'He makes me lie down in green pastures.' },
      ]},
      { number: 24, verses: [
        { number: 1, text: 'The earth is the LORD’s, and the fullness thereof.' },
      ]},
    ]},
  ],
};

describe('parseBsbToRows', () => {
  it('emits one verse row per verse', () => {
    const { verses } = parseBsbToRows(FIXTURE as never, 'BSB');
    expect(verses).toEqual([
      { id: 'psa.23.1', book: 'psa', chapter: 23, verse_start: 1, verse_end: 1, translation: 'BSB',
        text: 'The LORD is my shepherd; I shall not want.', pericope_id: 'psa.23' },
      { id: 'psa.23.2', book: 'psa', chapter: 23, verse_start: 2, verse_end: 2, translation: 'BSB',
        text: 'He makes me lie down in green pastures.', pericope_id: 'psa.23' },
      { id: 'psa.24.1', book: 'psa', chapter: 24, verse_start: 1, verse_end: 1, translation: 'BSB',
        text: 'The earth is the LORD’s, and the fullness thereof.', pericope_id: 'psa.24' },
    ]);
  });

  it('emits one pericope row per chapter, joining verses with newlines', () => {
    const { pericopes } = parseBsbToRows(FIXTURE as never, 'BSB');
    expect(pericopes).toEqual([
      { id: 'psa.23', book: 'psa', chapter: 23, verse_start: 1, verse_end: 2, translation: 'BSB',
        text: 'The LORD is my shepherd; I shall not want.\nHe makes me lie down in green pastures.', pericope_id: 'psa.23' },
      { id: 'psa.24', book: 'psa', chapter: 24, verse_start: 1, verse_end: 1, translation: 'BSB',
        text: 'The earth is the LORD’s, and the fullness thereof.', pericope_id: 'psa.24' },
    ]);
  });
});

describe('parseBsbToRows translation param', () => {
  it('stamps the given translation on verse and pericope rows', () => {
    const corpus = parseBsbText(SAMPLE);
    const { verses, pericopes } = parseBsbToRows(corpus, 'KJV');
    expect(verses).toHaveLength(2);
    expect(verses[0]).toMatchObject({ id: 'jhn.1.1', translation: 'KJV', book: 'jhn' });
    expect(pericopes[0]).toMatchObject({ id: 'jhn.1', translation: 'KJV' });
  });
});

describe('parseBsbText', () => {
  // Real-shape sample: BOM + license preamble + header + a few verses across
  // 2 books, including a multi-word and a numbered book name.
  const SAMPLE =
    '﻿License preamble line 1.\t\n' +
    'License preamble line 2.\t\n' +
    'Verse\tBerean Standard Bible\n' +
    'Genesis 1:1\tIn the beginning God created the heavens and the earth.\n' +
    'Genesis 1:2\tNow the earth was formless and void.\n' +
    'Psalm 23:1\tThe LORD is my shepherd; I shall not want.\n' +
    '1 Samuel 5:3\tWhen the people of Ashdod rose early the next day.\n' +
    'Song of Solomon 1:1\tSolomon’s Song of Songs.\n';

  it('parses verses across books while preserving order', () => {
    const corpus = parseBsbText(SAMPLE);
    expect(corpus.books.map(b => b.abbrev)).toEqual(['gen', 'psa', '1sa', 'sng']);
    expect(corpus.books[0].chapters[0].verses).toEqual([
      { number: 1, text: 'In the beginning God created the heavens and the earth.' },
      { number: 2, text: 'Now the earth was formless and void.' },
    ]);
    expect(corpus.books[2].chapters[0].verses).toEqual([
      { number: 3, text: 'When the people of Ashdod rose early the next day.' },
    ]);
    expect(corpus.books[3].chapters[0].verses[0].text).toBe('Solomon’s Song of Songs.');
  });

  it('skips preamble + header lines and ignores blank lines', () => {
    const corpus = parseBsbText(SAMPLE);
    // Only 4 books, not 5 (no phantom "Verse" book or "License" book).
    expect(corpus.books).toHaveLength(4);
  });

  it('throws on unknown book names so we notice silent format drift', () => {
    expect(() => parseBsbText('Verse\tBerean Standard Bible\nFakebook 1:1\tHello.\n')).toThrow(
      /unknown BSB book name/
    );
  });
});
