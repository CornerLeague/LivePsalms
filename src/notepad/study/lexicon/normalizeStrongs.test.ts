// src/notepad/study/lexicon/normalizeStrongs.test.ts
// Real-data fixtures: raw STEPBible dStrong values observed in bible_interlinear,
// mapped to the bare OpenScriptures keys stored in bible_strongs.
import { describe, it, expect } from 'vitest';
import { normalizeStrongs } from './normalizeStrongs';

describe('normalizeStrongs', () => {
  it('un-pads leading zeros (Greek)', () => {
    expect(normalizeStrongs('G0025')).toBe('G25'); // John 3:16 "loved"
  });

  it('un-pads leading zeros (Hebrew)', () => {
    expect(normalizeStrongs('H0430')).toBe('H430'); // Elohim
  });

  it('drops a trailing uppercase disambiguation letter (Greek)', () => {
    expect(normalizeStrongs('G2424G')).toBe('G2424');
  });

  it('drops a trailing uppercase disambiguation letter (Hebrew)', () => {
    expect(normalizeStrongs('H1254A')).toBe('H1254');
  });

  it('drops a trailing letter without padding', () => {
    expect(normalizeStrongs('H7225G')).toBe('H7225');
  });

  it('unwraps a braced Hebrew root', () => {
    expect(normalizeStrongs('{H7225G}')).toBe('H7225'); // Gen 1:1 "beginning"
  });

  it('picks the braced root from a slash-prefixed Hebrew chain', () => {
    expect(normalizeStrongs('H9003/{H7225G}')).toBe('H7225');
  });

  it('picks the primary (first) token from a Greek compound', () => {
    expect(normalizeStrongs('G1473 + G2532')).toBe('G1473');
  });

  it('leaves an already-canonical Hebrew key unchanged', () => {
    expect(normalizeStrongs('H7225')).toBe('H7225');
  });

  it('leaves an already-canonical Greek key unchanged', () => {
    expect(normalizeStrongs('G2316')).toBe('G2316');
  });

  it('lowercases nothing but normalizes the prefix to uppercase', () => {
    expect(normalizeStrongs('g0025')).toBe('G25');
  });

  it('keeps a STEP prefix code (H9xxx) intact so the lookup misses gracefully', () => {
    expect(normalizeStrongs('H9003')).toBe('H9003');
  });

  it('returns empty for blank or malformed input', () => {
    expect(normalizeStrongs('')).toBe('');
    expect(normalizeStrongs('   ')).toBe('');
    expect(normalizeStrongs('not-a-strongs')).toBe('');
  });
});
