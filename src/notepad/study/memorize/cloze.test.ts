import { describe, it, expect } from 'vitest';
import { tokenize, selectBlankIndices, normalizeWord, gradeCloze, seedFromString } from './cloze';

describe('tokenize', () => {
  it('splits words from punctuation and preserves order + reconstruction', () => {
    const toks = tokenize('For God so loved the world.');
    expect(toks.filter((t) => t.isWord).map((t) => t.text)).toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
    expect(toks.map((t) => t.text).join('')).toBe('For God so loved the world.');
    expect(toks.every((t, i) => t.index === i)).toBe(true);
  });
  it('keeps apostrophes/hyphens inside a word', () => {
    expect(tokenize("God's well-kept word").filter((t) => t.isWord).map((t) => t.text))
      .toEqual(["God's", 'well-kept', 'word']);
  });
});

describe('normalizeWord', () => {
  it('lowercases and strips punctuation/whitespace', () => {
    expect(normalizeWord('  World! ')).toBe('world');
    expect(normalizeWord('LOVED,')).toBe('loved');
  });
});

describe('selectBlankIndices', () => {
  const toks = tokenize('For God so loved the world that he gave his Son');
  it('picks round(difficulty * wordCount) WORD indices, deterministically by seed', () => {
    const a = selectBlankIndices(toks, 0.5, 123);
    const b = selectBlankIndices(toks, 0.5, 123);
    expect(a).toEqual(b);                    // stable within a seed
    expect(a.length).toBe(Math.round(0.5 * 11)); // 11 words -> 6 (round half up)
    expect(a.every((i) => toks[i].isWord)).toBe(true); // never punctuation
    expect([...a]).toEqual([...a].sort((x, y) => x - y)); // sorted ascending
  });
  it('returns [] at difficulty 0 and every word at difficulty 1', () => {
    expect(selectBlankIndices(toks, 0, 1)).toEqual([]);
    expect(selectBlankIndices(toks, 1, 1)).toEqual(toks.filter((t) => t.isWord).map((t) => t.index));
  });
});

describe('gradeCloze', () => {
  const toks = tokenize('For God so loved');
  const blanks = [2, 6]; // 'God', 'loved' (tokenize indexes ALL tokens incl. gaps; see tokenize tests)
  it('grades per blank with normalization', () => {
    const g = gradeCloze(toks, blanks, ['god', 'Loved!']);
    expect(g.perBlank).toEqual([true, true]);
    expect(g.correct).toBe(2);
    expect(g.total).toBe(2);
    expect(g.scorePercent).toBe(100);
  });
  it('marks wrong answers and computes a percentage', () => {
    const g = gradeCloze(toks, blanks, ['god', 'hated']);
    expect(g.perBlank).toEqual([true, false]);
    expect(g.scorePercent).toBe(50);
  });
  it('honors a manual "close enough" override', () => {
    const g = gradeCloze(toks, blanks, ['god', 'luved'], [false, true]);
    expect(g.perBlank).toEqual([true, true]);
    expect(g.scorePercent).toBe(100);
  });
});

describe('seedFromString', () => {
  it('is deterministic', () => {
    expect(seedFromString('card-1')).toBe(seedFromString('card-1'));
    expect(seedFromString('card-1')).not.toBe(seedFromString('card-2'));
  });
});
