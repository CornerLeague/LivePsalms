// src/notepad/study/memorize/blank-page-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffRecall } from './blank-page-diff';

describe('diffRecall', () => {
  it('marks all matched on a perfect (modulo case/punct) recall', () => {
    const d = diffRecall('For God so loved', 'for god SO loved!');
    expect(d.tokens.every((t) => t.status === 'matched')).toBe(true);
    expect(d.matched).toBe(4);
    expect(d.totalExpected).toBe(4);
    expect(d.scorePercent).toBe(100);
  });

  it('flags a missed word', () => {
    const d = diffRecall('For God so loved', 'For God loved');
    expect(d.matched).toBe(3);
    expect(d.totalExpected).toBe(4);
    expect(d.scorePercent).toBe(75);
    expect(d.tokens.find((t) => t.status === 'missed')?.text).toBe('so');
  });

  it('flags an extra word', () => {
    const d = diffRecall('God loves', 'God really loves');
    expect(d.matched).toBe(2);
    expect(d.totalExpected).toBe(2);
    expect(d.tokens.some((t) => t.status === 'extra' && t.text === 'really')).toBe(true);
  });

  it('handles empty recall as 0% with all missed', () => {
    const d = diffRecall('God is love', '');
    expect(d.matched).toBe(0);
    expect(d.scorePercent).toBe(0);
    expect(d.tokens.every((t) => t.status === 'missed')).toBe(true);
  });
});
