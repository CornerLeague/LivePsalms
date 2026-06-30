import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatHistoryLabel, formatPassageLabel } from './history-label';

const NOW = Date.parse('2026-06-29T12:00:00Z');

describe('formatPassageLabel', () => {
  it('resolves a known abbrev to its display name', () => {
    expect(formatPassageLabel('rom', 8)).toBe('Romans 8');
  });
  it('falls back to the raw abbrev for an unknown book', () => {
    expect(formatPassageLabel('zzz', 3)).toBe('zzz 3');
  });
});

describe('formatRelativeTime', () => {
  it('buckets seconds/minutes/hours/days with correct pluralization', () => {
    expect(formatRelativeTime('2026-06-29T11:59:30Z', NOW)).toBe('just now');
    expect(formatRelativeTime('2026-06-29T11:59:00Z', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime('2026-06-29T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime('2026-06-27T12:00:00Z', NOW)).toBe('2 days ago');
  });
});

describe('formatHistoryLabel', () => {
  it('resolves the book name and joins with the relative time', () => {
    expect(formatHistoryLabel('rom', 8, '2026-06-27T12:00:00Z', NOW)).toBe('Romans 8 · 2 days ago');
  });
  it('falls back to the raw abbrev for an unknown book', () => {
    expect(formatHistoryLabel('zzz', 3, '2026-06-29T11:59:30Z', NOW)).toBe('zzz 3 · just now');
  });
});
