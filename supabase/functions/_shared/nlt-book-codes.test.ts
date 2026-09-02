import { describe, it, expect } from 'vitest';
import { NLT_BOOKS, nltRefForBook, osisForNltCode } from './nlt-book-codes';
import { OSIS_TO_ABBREV } from './bible-books';
import { BIBLE_BOOKS } from '../../../src/notepad/bible/bible-books';

describe('NLT book codes', () => {
  it('covers exactly the 66 OSIS codes the app uses, no more', () => {
    const app = BIBLE_BOOKS.map((b) => b.abbrev).sort();
    expect(Object.keys(NLT_BOOKS).sort()).toEqual(app);
    expect(app).toHaveLength(66);
  });

  it('agrees with the Deno-side OSIS list', () => {
    expect(Object.keys(NLT_BOOKS).sort()).toEqual(Object.keys(OSIS_TO_ABBREV).sort());
  });

  it('has no duplicate request refs or response codes', () => {
    const refs = Object.values(NLT_BOOKS).map((b) => b.ref);
    const codes = Object.values(NLT_BOOKS).map((b) => b.code);
    expect(new Set(refs).size).toBe(66);
    expect(new Set(codes).size).toBe(66);
  });

  it('round-trips through the response code across both testaments', () => {
    for (const osis of ['gen', 'psa', 'sng', '1sa', '2ki', 'mal', 'mat', 'jhn', '1co', '1th', 'phm', '3jn', 'rev']) {
      expect(osisForNltCode(NLT_BOOKS[osis].code)).toBe(osis);
    }
  });

  it('maps the spellings the live API was seen to require', () => {
    expect(nltRefForBook('psa')).toBe('Ps');
    expect(nltRefForBook('1th')).toBe('1Thes');
    expect(nltRefForBook('1jn')).toBe('1Jn');
    expect(nltRefForBook('exo')).toBe('Exod');
    expect(nltRefForBook('phm')).toBe('Phlm');
  });

  it('is case- and whitespace-tolerant on lookup and null on unknown', () => {
    expect(nltRefForBook(' PSA ')).toBe('Ps');
    expect(osisForNltCode('PSAL')).toBe('psa');
    expect(nltRefForBook('sir')).toBeNull();
    expect(osisForNltCode('tobi')).toBeNull();
  });
});
