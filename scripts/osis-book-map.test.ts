import { describe, it, expect } from 'vitest';
import { osisToBook, crossesTestament } from './osis-book-map';

describe('osisToBook', () => {
  it('maps common OSIS abbreviations to lowercase book codes', () => {
    expect(osisToBook('Gen')).toBe('gen');
    expect(osisToBook('Ps')).toBe('psa');
    expect(osisToBook('John')).toBe('jhn');
    expect(osisToBook('1Cor')).toBe('1co');
    expect(osisToBook('Rev')).toBe('rev');
    expect(osisToBook('Song')).toBe('sng');
  });
  it('returns null for an unknown token', () => {
    expect(osisToBook('Nope')).toBeNull();
  });
});

describe('crossesTestament', () => {
  it('is true only when the two books span OT and NT', () => {
    expect(crossesTestament('isa', 'mat')).toBe(true);
    expect(crossesTestament('mat', 'isa')).toBe(true);
    expect(crossesTestament('gen', 'exo')).toBe(false);
    expect(crossesTestament('rom', 'jhn')).toBe(false);
  });
});
