import { describe, it, expect } from 'vitest';
import {
  parseRefreshArgs,
  parseDoorRefId,
  groupDoors,
  selectDoorsToRefresh,
  estimateRefreshCents,
  formatRefreshPlan,
  MEASURED_TOKENS_PER_DOOR,
  type DoorRow,
} from './refresh-passage-insights';

const CURRENT = 'passage-insight-2026-08-06-v1';
const OLD = 'passage-insight-2026-07-01-v0';

function rows(over: Array<Partial<DoorRow>> = []): DoorRow[] {
  const base: DoorRow[] = [
    ...['overview', 'in_chapter', 'chapter_shape', 'reflection'].map((section) => ({
      scope: 'chapter', ref_id: 'psa.27', section, prompt_version: CURRENT,
    })),
    ...['overview', 'in_chapter', 'chapter_shape', 'reflection'].map((section) => ({
      scope: 'chapter', ref_id: 'nam.1', section, prompt_version: OLD,
    })),
    ...['overview', 'in_chapter', 'chapter_shape', 'reflection'].map((section) => ({
      scope: 'verse', ref_id: 'psa.27.4', section, prompt_version: OLD,
    })),
  ];
  return [...base, ...over.map((o) => ({ scope: 'chapter', ref_id: 'x.1', section: 'overview', prompt_version: CURRENT, ...o }))];
}

describe('parseRefreshArgs', () => {
  it('defaults to a dry run of nothing — a refresh script must never spend by accident', () => {
    // The whole point of the flag discipline: running the script bare reports,
    // it does not regenerate a corpus.
    expect(parseRefreshArgs([])).toMatchObject({ dryRun: true, staleOnly: false });
  });

  it('takes --apply to actually regenerate', () => {
    expect(parseRefreshArgs(['--apply']).dryRun).toBe(false);
  });

  it('takes --dry-run explicitly too, and it wins over --apply', () => {
    // Belt and braces: a script that spends money should resolve an ambiguous
    // invocation toward the safe reading.
    expect(parseRefreshArgs(['--apply', '--dry-run']).dryRun).toBe(true);
  });

  it('filters by scope and ref', () => {
    expect(parseRefreshArgs(['--scope=verse', '--ref=psa.27.4']))
      .toMatchObject({ scope: 'verse', refId: 'psa.27.4' });
  });

  it('takes --stale for the prompt-version sweep', () => {
    expect(parseRefreshArgs(['--stale']).staleOnly).toBe(true);
  });

  it('takes a --limit so a first apply can be small', () => {
    expect(parseRefreshArgs(['--limit=5']).limit).toBe(5);
  });

  it('rejects a scope that is not one of the two grains', () => {
    expect(() => parseRefreshArgs(['--scope=book'])).toThrow(/scope/);
  });

  it('rejects a non-numeric limit rather than silently refreshing everything', () => {
    expect(() => parseRefreshArgs(['--limit=lots'])).toThrow(/limit/);
  });
});

describe('parseDoorRefId', () => {
  it('reads a chapter door', () => {
    expect(parseDoorRefId('chapter', 'psa.27')).toEqual({ book: 'psa', chapter: 27 });
  });

  it('reads a verse door', () => {
    expect(parseDoorRefId('verse', 'psa.27.4')).toEqual({ book: 'psa', chapter: 27, verse: 4 });
  });

  it('handles a numbered book, whose code contains a digit', () => {
    expect(parseDoorRefId('verse', '2ti.2.19')).toEqual({ book: '2ti', chapter: 2, verse: 19 });
    expect(parseDoorRefId('chapter', '1jn.4')).toEqual({ book: '1jn', chapter: 4 });
  });

  it('returns null for a ref_id that does not match its scope', () => {
    // A row whose key is malformed must be reported, not regenerated against a
    // passage nobody asked for.
    expect(parseDoorRefId('verse', 'psa.27')).toBeNull();
    expect(parseDoorRefId('chapter', 'psa.27.4')).toBeNull();
    expect(parseDoorRefId('chapter', 'psa')).toBeNull();
  });
});

describe('groupDoors', () => {
  it('groups per-section rows into doors', () => {
    const doors = groupDoors(rows());
    expect(doors.map((d) => d.refId)).toEqual(['psa.27', 'nam.1', 'psa.27.4']);
    expect(doors[0].sections).toBe(4);
  });

  it('counts a door with missing sections as the partial it is', () => {
    const partial = rows().filter((r) => !(r.ref_id === 'nam.1' && r.section === 'reflection'));
    expect(groupDoors(partial).find((d) => d.refId === 'nam.1')!.sections).toBe(3);
  });

  it('reports every distinct prompt_version a door carries', () => {
    const mixed = rows().map((r) =>
      r.ref_id === 'psa.27' && r.section === 'overview' ? { ...r, prompt_version: OLD } : r,
    );
    expect(groupDoors(mixed).find((d) => d.refId === 'psa.27')!.promptVersions.sort())
      .toEqual([OLD, CURRENT].sort());
  });
});

describe('selectDoorsToRefresh', () => {
  it('takes everything when no filter is given', () => {
    expect(selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: false })).toHaveLength(3);
  });

  it('--stale selects only doors behind the current prompt version', () => {
    const out = selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: true });
    expect(out.map((d) => d.refId)).toEqual(['nam.1', 'psa.27.4']);
  });

  it('--stale catches a door where only ONE section is behind', () => {
    // A door is refreshed as a unit, so a single stale row makes the door stale.
    const mixed = rows().map((r) =>
      r.ref_id === 'psa.27' && r.section === 'overview' ? { ...r, prompt_version: OLD } : r,
    );
    expect(selectDoorsToRefresh(mixed, { currentVersion: CURRENT, staleOnly: true }).map((d) => d.refId))
      .toContain('psa.27');
  });

  it('treats a null prompt_version as stale — it predates the stamping', () => {
    const unstamped = rows().map((r) => (r.ref_id === 'psa.27' ? { ...r, prompt_version: null } : r));
    expect(selectDoorsToRefresh(unstamped, { currentVersion: CURRENT, staleOnly: true }).map((d) => d.refId))
      .toContain('psa.27');
  });

  it('filters by scope', () => {
    const out = selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: false, scope: 'verse' });
    expect(out.map((d) => d.refId)).toEqual(['psa.27.4']);
  });

  it('filters by ref', () => {
    const out = selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: false, refId: 'nam.1' });
    expect(out.map((d) => d.refId)).toEqual(['nam.1']);
  });

  it('combines --stale with a ref filter', () => {
    const out = selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: true, refId: 'psa.27' });
    expect(out).toEqual([]);
  });

  it('honours a limit, taking them in a stable order', () => {
    const out = selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: false, limit: 2 });
    expect(out.map((d) => d.refId)).toEqual(['psa.27', 'nam.1']);
  });
});

describe('estimateRefreshCents', () => {
  it('is measured from the checked-in baseline, not guessed', () => {
    // 2026-08-06-b2-passage-door: 11,870 in / 3,708 out across three doors.
    expect(MEASURED_TOKENS_PER_DOOR.in).toBeGreaterThan(1000);
    expect(MEASURED_TOKENS_PER_DOOR.out).toBeGreaterThan(500);
  });

  it('scales with the number of doors', () => {
    expect(estimateRefreshCents(10)).toBeCloseTo(estimateRefreshCents(1) * 10, 6);
  });

  it('lands near the real cost of the baseline sweep', () => {
    // Three doors cost $0.1706 live. An estimate that is not in that
    // neighbourhood is not worth printing.
    expect(estimateRefreshCents(3)).toBeGreaterThan(10);
    expect(estimateRefreshCents(3)).toBeLessThan(25);
  });

  it('is zero for nothing', () => {
    expect(estimateRefreshCents(0)).toBe(0);
  });
});

describe('formatRefreshPlan', () => {
  const doors = selectDoorsToRefresh(rows(), { currentVersion: CURRENT, staleOnly: true });

  it('reports how many doors and roughly what it will cost', () => {
    const out = formatRefreshPlan(doors, { dryRun: true, currentVersion: CURRENT });
    expect(out).toMatch(/2 door/);
    expect(out).toMatch(/\$\d/);
  });

  it('says plainly that a dry run wrote nothing', () => {
    expect(formatRefreshPlan(doors, { dryRun: true, currentVersion: CURRENT })).toMatch(/nothing was written|no rows were written/i);
  });

  it('names the doors, so an operator can see what is about to change', () => {
    const out = formatRefreshPlan(doors, { dryRun: true, currentVersion: CURRENT });
    expect(out).toContain('nam.1');
    expect(out).toContain('psa.27.4');
  });

  it('reads differently on an apply run', () => {
    const dry = formatRefreshPlan(doors, { dryRun: true, currentVersion: CURRENT });
    const apply = formatRefreshPlan(doors, { dryRun: false, currentVersion: CURRENT });
    expect(apply).not.toBe(dry);
  });

  it('says so when nothing needs refreshing, rather than printing an empty table', () => {
    expect(formatRefreshPlan([], { dryRun: true, currentVersion: CURRENT })).toMatch(/nothing/i);
  });
});
