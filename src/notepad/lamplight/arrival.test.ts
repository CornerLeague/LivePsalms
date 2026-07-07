import { describe, it, expect } from 'vitest';
import { hasArrived } from './arrival';

describe('hasArrived (07:00 local on the 1st of the following month)', () => {
  it('is true exactly at 07:00 on the 1st of the next month (boundary, arrived)', () => {
    expect(hasArrived(new Date('2026-06-01T07:00:00Z'), '2026-05', 'UTC')).toBe(true);
  });
  it('is false one minute before 07:00 on the 1st (boundary, not yet)', () => {
    expect(hasArrived(new Date('2026-06-01T06:59:00Z'), '2026-05', 'UTC')).toBe(false);
  });
  it('is false on the last instant of the covered month', () => {
    expect(hasArrived(new Date('2026-05-31T23:59:00Z'), '2026-05', 'UTC')).toBe(false);
  });
  it('is true well into a later month', () => {
    expect(hasArrived(new Date('2026-07-15T00:00:00Z'), '2026-05', 'UTC')).toBe(true);
  });
  it('rolls December over into the next January (both directions)', () => {
    expect(hasArrived(new Date('2027-01-01T07:00:00Z'), '2026-12', 'UTC')).toBe(true);
    expect(hasArrived(new Date('2026-12-31T23:59:00Z'), '2026-12', 'UTC')).toBe(false);
  });
  it('respects the reader timezone, not just the UTC instant', () => {
    // 10:30Z is 06:30 in America/New_York (EDT) → not arrived there yet…
    expect(hasArrived(new Date('2026-06-01T10:30:00Z'), '2026-05', 'America/New_York')).toBe(false);
    // …11:30Z is 07:30 EDT → arrived.
    expect(hasArrived(new Date('2026-06-01T11:30:00Z'), '2026-05', 'America/New_York')).toBe(true);
  });
});
