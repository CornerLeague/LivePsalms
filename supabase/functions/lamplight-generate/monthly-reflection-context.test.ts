import { describe, it, expect } from 'vitest';
import { isValidPeriodKey, localMonthBoundsUtc, buildMonthlyReflectionContext } from './monthly-reflection-context';
import type { EdgeSupabase } from './reflection-candidates';

describe('isValidPeriodKey', () => {
  it('accepts YYYY-MM only', () => {
    expect(isValidPeriodKey('2026-05')).toBe(true);
    expect(isValidPeriodKey('2026-5')).toBe(false);
    expect(isValidPeriodKey('2026-05-01')).toBe(false);
    expect(isValidPeriodKey('26-05')).toBe(false);
    expect(isValidPeriodKey('')).toBe(false);
  });
});

describe('localMonthBoundsUtc', () => {
  it('computes UTC bounds and local date strings for a UTC month', () => {
    const b = localMonthBoundsUtc('2026-05', 'UTC');
    expect(b.monthStart).toBe('2026-05-01');
    expect(b.monthEnd).toBe('2026-05-31');
    expect(b.startUtc).toBe('2026-05-01T00:00:00.000Z');
    expect(b.endUtc).toBe('2026-06-01T00:00:00.000Z');
  });
  it('shifts the UTC window for a negative-offset timezone (EDT in May)', () => {
    const b = localMonthBoundsUtc('2026-05', 'America/New_York');
    expect(b.startUtc).toBe('2026-05-01T04:00:00.000Z');
    expect(b.endUtc).toBe('2026-06-01T04:00:00.000Z');
    expect(b.monthEnd).toBe('2026-05-31');
  });
});

describe('buildMonthlyReflectionContext', () => {
  const supabase = {} as unknown as EdgeSupabase;

  it('returns null for an empty month (graceful floor / no_notes upstream)', async () => {
    const ctx = await buildMonthlyReflectionContext(
      supabase,
      { userId: 'u1', periodKey: '2026-05', timezone: 'UTC' },
      { loadMonthNotes: async () => [] },
    );
    expect(ctx).toBeNull();
  });

  it('assembles the context from notes + candidates', async () => {
    const ctx = await buildMonthlyReflectionContext(
      supabase,
      { userId: 'u1', periodKey: '2026-05', timezone: 'UTC' },
      {
        loadMonthNotes: async () => [{ id: 'n1', day: '2026-05-12', text: 'I keep circling this decision.' }],
        // ref is Task 4's ReflectionCandidate field; only that is read here.
        buildCandidates: async () => ({ candidates: [{ ref: 'Ps 27:14', provenance: 'flagged' }] }) as never,
      },
    );
    expect(ctx).not.toBeNull();
    expect(ctx!.periodLabel).toBe('May 2026');
    expect(ctx!.monthStart).toBe('2026-05-01');
    expect(ctx!.monthEnd).toBe('2026-05-31');
    expect([...ctx!.allowedNoteDays]).toEqual(['2026-05-12']);
    expect([...ctx!.allowedVerseRefs]).toEqual(['Ps 27:14']);
    expect(ctx!.notes).toHaveLength(1);
  });
});
