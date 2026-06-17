import { describe, it, expect } from 'vitest';
import { matchBooks } from './book-matcher';

describe('matchBooks', () => {
  it('returns all 66 books in canonical order for an empty query', () => {
    const all = matchBooks('');
    expect(all).toHaveLength(66);
    expect(all[0]).toBe('Genesis');
    expect(all[65]).toBe('Revelation');
  });

  it('treats a whitespace-only query as empty', () => {
    expect(matchBooks('   ')).toHaveLength(66);
  });

  it('"r" → Ruth, Romans, Revelation (canonical tie-break)', () => {
    expect(matchBooks('r')).toEqual(['Ruth', 'Romans', 'Revelation']);
  });

  it('"rom" → Romans only', () => {
    expect(matchBooks('rom')).toEqual(['Romans']);
  });

  it('"rev" → Revelation only', () => {
    expect(matchBooks('rev')).toEqual(['Revelation']);
  });

  it('"1" → the eight numbered "1 X" books in canonical order', () => {
    expect(matchBooks('1')).toEqual([
      '1 Samuel', '1 Kings', '1 Chronicles', '1 Corinthians',
      '1 Thessalonians', '1 Timothy', '1 Peter', '1 John',
    ]);
  });

  it('"1c" → 1 Chronicles, 1 Corinthians (canonical order)', () => {
    expect(matchBooks('1c')).toEqual(['1 Chronicles', '1 Corinthians']);
  });

  it('"1 c" normalizes to the same result as "1c"', () => {
    expect(matchBooks('1 c')).toEqual(['1 Chronicles', '1 Corinthians']);
  });

  it('matches an abbreviation-only hit ("jn" → John)', () => {
    expect(matchBooks('jn')).toEqual(['John']);
  });

  it('"john" → John via canonical name', () => {
    expect(matchBooks('john')).toEqual(['John']);
  });

  it('ignores trailing periods (abbrev style "ps.")', () => {
    expect(matchBooks('ps.')).toEqual(['Psalms']);
  });

  it('ranks a canonical-name prefix hit above an abbrev-only hit', () => {
    // "mat" — Matthew canonical starts with "mat" (score 0). No abbrev-only
    // book outranks it, so Matthew leads.
    expect(matchBooks('mat')[0]).toBe('Matthew');
  });

  it('returns [] when nothing matches', () => {
    expect(matchBooks('zzz')).toEqual([]);
  });
});
