// src/notepad/study/memorize/mastery.test.ts
import { describe, it, expect } from 'vitest';
import { nextMastery, applyAttempt } from './mastery';

describe('nextMastery', () => {
  it('is the rounded EMA 0.6*prev + 0.4*score', () => {
    expect(nextMastery(0, 100)).toBe(40);
    expect(nextMastery(50, 100)).toBe(70);
    expect(nextMastery(80, 0)).toBe(48);
  });
});

describe('applyAttempt', () => {
  it('bumps attempts, sets lastPracticedAt, and updates mastery', () => {
    const u = applyAttempt({ mastery: 50, attempts: 2 }, 100, '2026-07-12T00:00:00.000Z');
    expect(u).toEqual({ mastery: 70, attempts: 3, lastPracticedAt: '2026-07-12T00:00:00.000Z' });
  });
});
