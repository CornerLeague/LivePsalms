import { describe, it, expect } from 'vitest';
import {
  parseChapterDump, collapseRanges, cleanPlainMarkup, splitTreasuryBlob,
  formatRef, buildEntries,
} from './dump-sword-commentary';

// Verbatim shape of real `diatheke -b JFB -f plain -k Psalms 27` output.
const JFB_DUMP = [
  'Psalms 27:1: * 1. light-- *is a common figure for comfort. ',
  'Psalms 27:2: * 2. eat ... my flesh-- *(Job 19:22). ',
  'Psalms 27:4: 4-5. The secret of his confidence is his delight in communion with God. ',
  'Psalms 27:5: 4-5. The secret of his confidence is his delight in communion with God. ',
  '(JFB)',
  '',
].join('\n');

describe('parseChapterDump', () => {
  it('extracts verse/body pairs and drops the module trailer', () => {
    const out = parseChapterDump(JFB_DUMP);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ verse: 1, body: '* 1. light-- *is a common figure for comfort.' });
    expect(out.some((l) => l.body.includes('(JFB)'))).toBe(false);
  });

  it('drops verses whose body is empty (diatheke reports "no comment" that way)', () => {
    const out = parseChapterDump('Psalms 27:2: \nPsalms 27:3: real comment\n(TDavid)');
    expect(out).toEqual([{ verse: 3, body: 'real comment' }]);
  });

  it('handles multi-word book names', () => {
    const out = parseChapterDump('Song of Solomon 2:1: A comment.\n(JFB)');
    expect(out).toEqual([{ verse: 1, body: 'A comment.' }]);
  });
});

describe('collapseRanges', () => {
  it('collapses consecutive identical bodies into ONE range entry', () => {
    const out = collapseRanges(parseChapterDump(JFB_DUMP));
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      verseStart: 4, verseEnd: 5,
      body: '4-5. The secret of his confidence is his delight in communion with God.',
    });
  });

  it('does NOT merge identical bodies that are not adjacent', () => {
    const out = collapseRanges([
      { verse: 1, body: 'same' }, { verse: 5, body: 'same' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps distinct bodies separate', () => {
    const out = collapseRanges([{ verse: 1, body: 'a' }, { verse: 2, body: 'b' }]);
    expect(out).toHaveLength(2);
  });
});

describe('cleanPlainMarkup', () => {
  it('strips the plain-format italic asterisks', () => {
    expect(cleanPlainMarkup('* 1. light-- *is a common figure.'))
      .toBe('1. light-- is a common figure.');
  });

  it('collapses the whitespace the stripping leaves behind', () => {
    expect(cleanPlainMarkup('a  *  b   *  c')).toBe('a b c');
  });
});

describe('splitTreasuryBlob', () => {
  const blob = [
    'TITLE AND SUBJECT. Nothing can be drawn from the title.',
    '* Verse 1. * The Lord is my light and my salvation.',
    '* Verse 2. * When the wicked came upon me.',
    '* Verses 3-4. * Though an host should encamp against me.',
  ].join(' ');

  it('returns the preamble as verse 0 (a chapter-level anchor)', () => {
    const out = splitTreasuryBlob(blob);
    expect(out[0].verseStart).toBe(0);
    expect(out[0].body).toContain('TITLE AND SUBJECT');
  });

  it('splits each verse marker into its own section', () => {
    const out = splitTreasuryBlob(blob);
    expect(out[1]).toEqual({ verseStart: 1, verseEnd: 1, body: 'The Lord is my light and my salvation.' });
    expect(out[2].verseStart).toBe(2);
  });

  it('parses a RANGE marker', () => {
    const out = splitTreasuryBlob(blob);
    const range = out.find((s) => s.verseStart === 3);
    expect(range).toEqual({ verseStart: 3, verseEnd: 4, body: 'Though an host should encamp against me.' });
  });

  it('returns the whole body as verse 0 when there are no markers', () => {
    expect(splitTreasuryBlob('Just prose.')).toEqual([{ verseStart: 0, verseEnd: 0, body: 'Just prose.' }]);
  });

  it('returns nothing for a blank body', () => {
    expect(splitTreasuryBlob('   ')).toEqual([]);
  });
});

describe('formatRef', () => {
  it('formats single verses, ranges, and chapter-level refs', () => {
    expect(formatRef('Psalm', 27, 4, 4)).toBe('Psalm 27:4');
    expect(formatRef('Psalm', 27, 4, 6)).toBe('Psalm 27:4-6');
    expect(formatRef('Psalm', 27, 0, 0)).toBe('Psalm 27');
    expect(formatRef('Psalm', 27)).toBe('Psalm 27');
  });
});

describe('buildEntries', () => {
  it('range-collapses and cleans markup for JFB', () => {
    const out = buildEntries('JFB', 'Psalm', 27, JFB_DUMP, new Map());
    expect(out).toHaveLength(3);
    expect(out[2].ref).toBe('Psalm 27:4-5');
    expect(out[0].body).toBe('1. light-- is a common figure for comfort.');
    expect(out[0].heading).toBeUndefined();     // first occurrence needs no suffix
  });

  it('splits the Treasury blob and anchors each section', () => {
    const dump = 'Psalms 27:1: TITLE AND SUBJECT. Intro. * Verse 1. * On light. * Verse 2. * On foes.\n(TDavid)';
    const out = buildEntries('TDavid', 'Psalm', 27, dump, new Map());
    expect(out.map((e) => e.ref)).toEqual(['Psalm 27', 'Psalm 27:1', 'Psalm 27:2']);
  });

  it('LOAD-BEARING: a repeated ref gets a distinct heading so the idempotency key cannot collide', () => {
    // Treasury comments on the same verse once per section.
    const dump = 'Psalms 27:1: * Verse 1. * Exposition. * Verse 1. * Quaint saying.\n(TDavid)';
    const out = buildEntries('TDavid', 'Psalm', 27, dump, new Map());
    expect(out).toHaveLength(2);
    expect(out[0].ref).toBe('Psalm 27:1');
    expect(out[0].heading).toBeUndefined();
    expect(out[1].heading).toBe('Psalm 27:1 [2]');
  });

  it('carries occurrence counts ACROSS chapters via the shared map', () => {
    const seen = new Map<string, number>();
    buildEntries('JFB', 'Psalm', 27, 'Psalms 27:1: First.\n(JFB)', seen);
    const second = buildEntries('JFB', 'Psalm', 27, 'Psalms 27:1: Second.\n(JFB)', seen);
    expect(second[0].heading).toBe('Psalm 27:1 [2]');
  });

  it('returns nothing for an empty dump', () => {
    expect(buildEntries('JFB', 'Psalm', 27, '(JFB)\n', new Map())).toEqual([]);
  });
});
