import { describe, it, expect } from 'vitest';
import { normalizeStrongs } from './strongs-key.ts';
// Test-only cross-runtime import: the src twin never ships to Deno, but drift
// between the two copies is the whole risk this module carries, so the parity
// test below compares them directly on real-data fixtures.
import { normalizeStrongs as srcNormalizeStrongs } from '../../../src/notepad/study/lexicon/normalizeStrongs';

// Raw dStrong values as observed in bible_interlinear.
const FIXTURES: Array<[string, string]> = [
  ['G0025', 'G25'],                 // un-pad (Greek) — John 3:16 "loved"
  ['H0430', 'H430'],                // un-pad (Hebrew) — Elohim
  ['G2424G', 'G2424'],              // trailing disambiguation letter (Greek)
  ['H1254A', 'H1254'],              // trailing disambiguation letter (Hebrew)
  ['H7225G', 'H7225'],              // trailing letter, no padding
  ['{H7225G}', 'H7225'],            // braced Hebrew root — Gen 1:1 "beginning"
  ['H9003/{H7225G}', 'H7225'],      // prefix chain → lexical root
  ['G1473 + G2532', 'G1473'],       // Greek compound → primary sense
  ['H7225', 'H7225'],               // already canonical
  ['G2316', 'G2316'],               // already canonical
  ['', ''],                         // empty
  ['x', ''],                        // non-Strongs token
];

describe('normalizeStrongs (edge duplicate)', () => {
  it.each(FIXTURES)('maps %s → %s', (raw, expected) => {
    expect(normalizeStrongs(raw)).toBe(expected);
  });

  it('is byte-for-byte in parity with the src twin', () => {
    for (const [raw] of FIXTURES) {
      expect(normalizeStrongs(raw)).toBe(srcNormalizeStrongs(raw));
    }
  });
});
