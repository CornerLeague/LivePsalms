import { describe, it, expect } from 'vitest';
import {
  parseFixture,
  checkProperties,
  aggregateReport,
  validateFixtureRefs,
  candidateVerseIds,
  type EvalFixture,
  type FixtureRun,
} from './eval-lamplight';

const RAW_FIXTURE = {
  name: 'grief-month',
  description: 'A month shaped by loss.',
  firstName: 'Ruth',
  localDate: '2026-08-07',
  periodKey: '2026-08',
  notes: [
    { id: 'n1', title: 'The service', text: 'We buried her on Tuesday.', daysAgo: 3 },
    { id: 'n2', title: 'Quiet house', text: 'The house is very quiet now.', daysAgo: 1 },
  ],
  highlights: [{ verseId: 'psa.23.4', daysAgo: 2 }],
  expect: { maxFirstNameMentions: 2, mustNotContain: ['closure', 'everything happens for a reason'] },
};

describe('parseFixture', () => {
  it('parses a well-formed fixture', () => {
    const f = parseFixture(RAW_FIXTURE);
    expect(f.name).toBe('grief-month');
    expect(f.notes).toHaveLength(2);
    expect(f.highlights).toHaveLength(1);
    expect(f.firstName).toBe('Ruth');
  });

  it('defaults the optional collections so a runner never guards them', () => {
    const f = parseFixture({ name: 'bare', description: 'd', localDate: '2026-08-07', periodKey: '2026-08' });
    expect(f.notes).toEqual([]);
    expect(f.highlights).toEqual([]);
    expect(f.firstName).toBeNull();
    expect(f.expect).toEqual({});
  });

  it('rejects a fixture with no name so a bad file cannot silently score as a pass', () => {
    expect(() => parseFixture({ description: 'd', localDate: '2026-08-07', periodKey: '2026-08' }))
      .toThrow(/name/i);
  });

  it('rejects a malformed note rather than dropping it', () => {
    expect(() => parseFixture({ ...RAW_FIXTURE, notes: [{ id: 'n1' }] })).toThrow(/note/i);
  });
});

describe('checkProperties', () => {
  const fixture: EvalFixture = parseFixture(RAW_FIXTURE);

  it('passes clean text', () => {
    const checks = checkProperties('A quiet word for Ruth about the shape of grief.', fixture);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it('fails when a fixture-specific banned phrase appears', () => {
    const checks = checkProperties('This is about finding closure.', fixture);
    const failed = checks.filter((c) => !c.pass);
    expect(failed).toHaveLength(1);
    expect(failed[0].name).toBe('must_not_contain');
    expect(failed[0].detail).toContain('closure');
  });

  it('is case-insensitive on banned phrases', () => {
    const checks = checkProperties('Everything Happens For A Reason.', fixture);
    expect(checks.some((c) => !c.pass)).toBe(true);
  });

  it('fails when the first name is used more often than allowed', () => {
    const checks = checkProperties('Ruth, Ruth, and again Ruth.', fixture);
    const failed = checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.name)).toContain('max_first_name_mentions');
  });

  it('does not count a first name inside a longer word', () => {
    const checks = checkProperties('Ruthless winters and Ruth herself.', fixture);
    expect(checks.filter((c) => c.name === 'max_first_name_mentions').every((c) => c.pass)).toBe(true);
  });

  it('always runs the shared voice families, not just fixture-specific ones', () => {
    const checks = checkProperties('God is telling you to move on.', fixture);
    expect(checks.some((c) => c.name === 'voice_families' && !c.pass)).toBe(true);
  });

  it('skips the name check entirely for a no-name fixture', () => {
    const noName = parseFixture({ ...RAW_FIXTURE, firstName: null });
    const checks = checkProperties('Anything at all.', noName);
    expect(checks.some((c) => c.name === 'max_first_name_mentions')).toBe(false);
  });
});

describe('aggregateReport', () => {
  const run = (over: Partial<FixtureRun> = {}): FixtureRun => ({
    fixture: 'f1',
    artifact: 'devotion',
    model: 'gpt-5.6-terra',
    tokensIn: 1000,
    tokensOut: 500,
    scriptureViolations: [],
    checks: [{ name: 'voice_families', pass: true }],
    ...over,
  });

  it('counts passes and failures per fixture', () => {
    const report = aggregateReport([
      run(),
      run({ fixture: 'f2', checks: [{ name: 'voice_families', pass: false, detail: 'banned' }] }),
    ]);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.ok).toBe(false);
  });

  it('marks the WHOLE run failed when any scripture violation appears anywhere', () => {
    const report = aggregateReport([
      run(),
      run({ fixture: 'f2', scriptureViolations: [{ rule: 'quote_mismatch', snippet: 'x' }] }),
    ]);
    expect(report.ok).toBe(false);
    expect(report.scriptureViolations).toBe(1);
    // The fixture is failed too, not merely noted.
    expect(report.failed).toBe(1);
  });

  it('is ok only when every check passes and no scripture violation occurred', () => {
    const report = aggregateReport([run(), run({ fixture: 'f2' })]);
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(2);
    expect(report.scriptureViolations).toBe(0);
  });

  it('tallies tokens and cost per artifact kind', () => {
    const report = aggregateReport([
      run({ artifact: 'devotion', tokensIn: 1000, tokensOut: 500 }),
      run({ fixture: 'f2', artifact: 'devotion', tokensIn: 2000, tokensOut: 1000 }),
      run({ fixture: 'f3', artifact: 'reflection', tokensIn: 4000, tokensOut: 8000, model: 'gpt-5.6-sol' }),
    ]);
    expect(report.byArtifact.devotion.runs).toBe(2);
    expect(report.byArtifact.devotion.tokensIn).toBe(3000);
    expect(report.byArtifact.devotion.tokensOut).toBe(1500);
    // gpt-5.6-terra: 200c/M in, 1200c/M out → (3000*200 + 1500*1200)/1e6 = 2.4c
    expect(report.byArtifact.devotion.costCents).toBeCloseTo(2.4, 6);
    // gpt-5.6-sol: 500c/M in, 3000c/M out → (4000*500 + 8000*3000)/1e6 = 26c
    expect(report.byArtifact.reflection.costCents).toBeCloseTo(26, 6);
    expect(report.totalCostCents).toBeCloseTo(28.4, 6);
  });

  it('reports an empty run without dividing by zero', () => {
    const report = aggregateReport([]);
    expect(report).toMatchObject({ passed: 0, failed: 0, ok: true, totalCostCents: 0 });
    expect(report.byArtifact).toEqual({});
  });

  it('records that register quality was NOT machine-checked', () => {
    // A green run must not be mistaken for "the prose is good".
    expect(aggregateReport([run()]).notes).toMatch(/not machine-checkable|human/i);
  });
});

describe('validateFixtureRefs', () => {
  // Caught for real: a fixture used 'phl.4.6' for Philippians, whose OSIS code
  // in this repo is 'php'. Nothing failed — the verse simply did not resolve,
  // the allowlist quietly shrank, and the eval would have scored a devotion
  // built on less grounding than the fixture claimed. Offline, so --dry catches
  // it before a live run spends anything.
  it('accepts real OSIS verse ids', () => {
    const f = parseFixture({
      ...RAW_FIXTURE,
      highlights: [{ verseId: 'php.4.6', daysAgo: 1 }, { verseId: 'psa.23.4', daysAgo: 2 }],
    });
    expect(validateFixtureRefs(f)).toEqual([]);
  });

  it('rejects an unknown book code', () => {
    const f = parseFixture({ ...RAW_FIXTURE, highlights: [{ verseId: 'phl.4.6', daysAgo: 1 }] });
    expect(validateFixtureRefs(f)).toEqual(['phl.4.6 (unknown book code "phl")']);
  });

  it('rejects a malformed id', () => {
    const f = parseFixture({ ...RAW_FIXTURE, highlights: [{ verseId: 'psalm 23:4', daysAgo: 1 }] });
    expect(validateFixtureRefs(f)[0]).toMatch(/malformed/);
  });

  it('accepts a fixture whose grounding comes from candidateVerses instead of highlights', () => {
    const f = parseFixture({ ...RAW_FIXTURE, highlights: [], candidateVerses: ['psa.34.18'] });
    expect(validateFixtureRefs(f)).toEqual([]);
  });
});

describe('candidate passages', () => {
  // The first green-ish baseline exposed this: two fixtures had no highlights,
  // so the harness handed the model an EMPTY candidate list and it failed with
  // `anchor verse "" is not in the retrieved passages`. Production never reaches
  // that state — its candidates come from semantic retrieval over the theme
  // query, so a user with no highlights still gets three. Highlights were the
  // wrong proxy; candidates are their own thing.
  it('falls back to highlights when candidateVerses is absent', () => {
    const f = parseFixture({ ...RAW_FIXTURE, highlights: [{ verseId: 'psa.23.4', daysAgo: 1 }] });
    expect(candidateVerseIds(f)).toEqual(['psa.23.4']);
  });

  it('prefers an explicit candidateVerses list', () => {
    const f = parseFixture({
      ...RAW_FIXTURE,
      highlights: [{ verseId: 'psa.23.4', daysAgo: 1 }],
      candidateVerses: ['psa.34.18', 'isa.43.2'],
    });
    expect(candidateVerseIds(f)).toEqual(['psa.34.18', 'isa.43.2']);
  });

  it('validates candidateVerses ids the same way as highlights', () => {
    const f = parseFixture({ ...RAW_FIXTURE, candidateVerses: ['phl.4.6'] });
    expect(validateFixtureRefs(f)).toEqual(['phl.4.6 (unknown book code "phl")']);
  });

  it('flags a fixture that expects an artifact but supplies no candidates at all', () => {
    const f = parseFixture({ ...RAW_FIXTURE, highlights: [] });
    expect(validateFixtureRefs(f)).toContain(
      'no candidate verses: the devotion has nothing to anchor on (production always retrieves some)',
    );
  });

  it('does not flag the empty-vault fixture, which is meant to generate nothing', () => {
    const f = parseFixture({ ...RAW_FIXTURE, highlights: [], notes: [], expect: { expectNoArtifact: true } });
    expect(validateFixtureRefs(f)).toEqual([]);
  });
});
