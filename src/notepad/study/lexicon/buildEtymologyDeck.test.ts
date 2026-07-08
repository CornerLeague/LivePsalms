import { describe, it, expect } from 'vitest';
import { isFunctionWord, buildEtymologyDeck, type EtymologyEntry } from './buildEtymologyDeck';
import type { InterlinearWord } from './useVerseLexicon';

// Real psa.23.1 tokens (subset), position asc = Hebrew reading order.
const YAHWEH:   InterlinearWord = { position: 3, original: 'יְהוָה', transliteration: 'Yahweh', strongs: 'H3068', morph: 'HNpt', gloss: 'the LORD' };
const SHEPHERD: InterlinearWord = { position: 4, original: 'רֹעִי', transliteration: 'roi', strongs: 'H7462', morph: 'HVqrmsc/Sp1bs', gloss: 'my shepherd' };
const NOT:      InterlinearWord = { position: 5, original: 'לֹא', transliteration: 'lo', strongs: 'H3808', morph: 'HTn', gloss: 'not' };
const LACK:     InterlinearWord = { position: 6, original: 'אֶחְסָר', transliteration: 'echsar', strongs: 'H2637', morph: 'HVqi1cs', gloss: 'I shall lack' };

function entry(strongs: string, studyValue: number): EtymologyEntry {
  return { strongs, lemma: 'x', root: 'r', rootGloss: 'rg', development: 'd', related: [], studyValue, source: "Strong's + BDB" };
}

describe('isFunctionWord', () => {
  it('classifies N/V/A as lexical and particles/unknown as function', () => {
    expect(isFunctionWord('HNpt')).toBe(false);          // noun → lexical
    expect(isFunctionWord('HVqrmsc/Sp1bs')).toBe(false); // verb (first segment) → lexical
    expect(isFunctionWord('HVqi1cs')).toBe(false);       // verb → lexical
    expect(isFunctionWord('HTn')).toBe(true);            // particle → function
    expect(isFunctionWord('')).toBe(true);               // empty → function
    expect(isFunctionWord('H')).toBe(true);              // too short → function
  });
});

describe('buildEtymologyDeck', () => {
  it('builds RTL order, function card for particles, omits lexical tokens with no reviewed entry', () => {
    const entries = new Map<string, EtymologyEntry>([
      ['H3068', entry('H3068', 10)],
      ['H7462', entry('H7462', 9)],
      // H2637 (LACK) intentionally absent → omitted
    ]);
    const { cards } = buildEtymologyDeck([YAHWEH, SHEPHERD, NOT, LACK], entries);
    expect(cards.map((c) => c.kind)).toEqual(['lexical', 'lexical', 'function']); // LACK omitted
    expect(cards.map((c) => c.position)).toEqual([3, 4, 5]);                       // position asc
    const notCard = cards[2];
    expect(notCard.kind).toBe('function'); // particle even though it has a strongs
  });

  it('stars top min(4, lexicalCount) by studyValue desc (tiebreak position asc) and reports firstStarredIndex', () => {
    const entries = new Map<string, EtymologyEntry>([
      ['H3068', entry('H3068', 5)],
      ['H7462', entry('H7462', 9)],
      ['H2637', entry('H2637', 7)],
    ]);
    const { cards, firstStarredIndex } = buildEtymologyDeck([YAHWEH, SHEPHERD, NOT, LACK], entries);
    const starred = cards.filter((c) => c.kind === 'lexical' && c.starred);
    expect(starred).toHaveLength(3);      // min(4,3)
    expect(firstStarredIndex).toBe(0);    // YAHWEH is lexical+starred at deck index 0
  });

  it('caps stars at 4 when more than four lexical cards qualify', () => {
    const words: InterlinearWord[] = [1, 2, 3, 4, 5].map((i) => ({
      position: i, original: 'w', transliteration: 't', strongs: `H${100 + i}`, morph: 'HNc', gloss: 'g',
    }));
    const entries = new Map<string, EtymologyEntry>(words.map((w, i) => [w.strongs as string, entry(w.strongs as string, i)]));
    const { cards } = buildEtymologyDeck(words, entries);
    expect(cards.filter((c) => c.kind === 'lexical' && c.starred)).toHaveLength(4);
  });

  it('a verse of only function words yields no lexical card (panel-activation gate is false)', () => {
    const { cards } = buildEtymologyDeck([NOT], new Map());
    expect(cards.some((c) => c.kind === 'lexical')).toBe(false);
  });
});
