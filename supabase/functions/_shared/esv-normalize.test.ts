import { describe, it, expect } from 'vitest';
import { normalizeEsvPassage, normalizeEsvPassages } from './esv-normalize';

// The exact shape api.esv.org returns for Psalm 23 with the bible-text
// function's parameters (verse numbers on, every other decoration off):
// superscription first with no marker, then "[n]" markers, poetry lines split
// by newlines, blank lines between stanzas, trailing whitespace. The verse
// bodies here are stand-ins, not the ESV text — the licence lets us quote it,
// but the parser only cares about the markers and whitespace, and a live check
// against the real blob is part of the ESV done-criterion once ESV_API_KEY is
// set (see the handoff spec, "Proving it is done").
const PSALM_23_SHAPE = `A Psalm of David.

  [1] The LORD is my shepherd; I shall not want.
  [2] He makes me lie down in green pastures.
    He leads me beside still waters.
  [3] He restores my soul.
    He leads me in paths of righteousness
    for his name's sake.

  [4] Even though I walk through the valley of the shadow of death,
    I will fear no evil,
  for you are with me;
    your rod and your staff,
    they comfort me.

  [5] You prepare a table before me
    in the presence of my enemies;
  you anoint my head with oil;
    my cup overflows.
  [6] Surely goodness and mercy shall follow me
    all the days of my life,
  and I shall dwell in the house of the LORD
    forever.

`;

describe('normalizeEsvPassage', () => {
  it('splits Psalm 23 into six numbered verses', () => {
    const verses = normalizeEsvPassage(PSALM_23_SHAPE);
    expect(verses.map((v) => v.verse)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('leaves no [n] markers or newlines in the text', () => {
    for (const v of normalizeEsvPassage(PSALM_23_SHAPE)) {
      expect(v.text).not.toMatch(/\[\d+\]/);
      expect(v.text).not.toMatch(/[\n\r]/);
      expect(v.text).not.toMatch(/ {2}/);
      expect(v.text).toBe(v.text.trim());
    }
  });

  it('fuses the superscription into verse 1, as the local translations do', () => {
    const [first] = normalizeEsvPassage(PSALM_23_SHAPE);
    expect(first.text).toBe('A Psalm of David. The LORD is my shepherd; I shall not want.');
  });

  it('joins a multi-line poetry verse with single spaces', () => {
    const v4 = normalizeEsvPassage(PSALM_23_SHAPE).find((v) => v.verse === 4);
    expect(v4?.text).toBe(
      'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me; your rod and your staff, they comfort me.',
    );
  });

  it('handles a blob with no superscription', () => {
    const verses = normalizeEsvPassage('[1] In the beginning, God created the heavens and the earth. [2] The earth was without form');
    expect(verses).toEqual([
      { verse: 1, text: 'In the beginning, God created the heavens and the earth.' },
      { verse: 2, text: 'The earth was without form' },
    ]);
  });

  it('returns [] for an empty or whitespace blob', () => {
    expect(normalizeEsvPassage('')).toEqual([]);
    expect(normalizeEsvPassage('   \n  ')).toEqual([]);
  });

  it('returns [] for text with no verse markers at all', () => {
    expect(normalizeEsvPassage('Nothing here is numbered.')).toEqual([]);
  });

  it('drops a marker with no text behind it', () => {
    expect(normalizeEsvPassage('[1] Alpha [2] [3] Gamma')).toEqual([
      { verse: 1, text: 'Alpha' },
      { verse: 3, text: 'Gamma' },
    ]);
  });
});

describe('normalizeEsvPassages', () => {
  it('concatenates every passage blob in order', () => {
    expect(normalizeEsvPassages(['[1] a [2] b', '[3] c'])).toEqual([
      { verse: 1, text: 'a' },
      { verse: 2, text: 'b' },
      { verse: 3, text: 'c' },
    ]);
  });

  it('is empty for an empty passages array', () => {
    expect(normalizeEsvPassages([])).toEqual([]);
  });
});
