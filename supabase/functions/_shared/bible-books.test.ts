import { describe, it, expect } from 'vitest';
import { OSIS_TO_ABBREV, osisRefToDisplay } from './bible-books';

describe('OSIS_TO_ABBREV', () => {
  it('maps all 66 canonical book codes', () => {
    expect(Object.keys(OSIS_TO_ABBREV)).toHaveLength(66);
  });
  it('uses the short register the exemplar requires', () => {
    expect(OSIS_TO_ABBREV.psa).toBe('Ps');
    expect(OSIS_TO_ABBREV.jhn).toBe('John');
    expect(OSIS_TO_ABBREV['1co']).toBe('1 Cor');
    expect(OSIS_TO_ABBREV.php).toBe('Phil');
  });
});

describe('osisRefToDisplay', () => {
  it('renders a verse-level id', () => {
    expect(osisRefToDisplay('psa.27.14')).toBe('Ps 27:14');
    expect(osisRefToDisplay('jhn.1.1')).toBe('John 1:1');
  });
  it('renders a chapter-level id', () => {
    expect(osisRefToDisplay('jhn.10')).toBe('John 10');
  });
  it('is case-insensitive on the book code', () => {
    expect(osisRefToDisplay('PSA.27.14')).toBe('Ps 27:14');
  });
  it('returns null for an unknown book or a book-only id', () => {
    expect(osisRefToDisplay('zzz.1.1')).toBeNull();
    expect(osisRefToDisplay('psa')).toBeNull();
  });
});
