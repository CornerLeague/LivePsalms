import { describe, it, expect } from 'vitest';
import {
  parseFixture,
  checkProperties,
  aggregateReport,
  validateFixtureRefs,
  candidateVerseIds,
  checkGrounding,
  checkSections,
  checkDisplayRefs,
  fixturesFor,
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

// ── Study chat ───────────────────────────────────────────────────────────────

const RAW_STUDY = {
  name: 'study-psalm-27',
  description: 'A psalm with dense commentary coverage.',
  localDate: '2026-08-07',
  periodKey: '2026-08',
  studyChat: {
    book: 'psa',
    chapter: 27,
    question: 'What does it mean to dwell in the house of the LORD?',
    expectGrounding: { minCrossRefs: 3, minLibraryExcerpts: 2, requireBookContext: true },
  },
};

describe('parseFixture — studyChat', () => {
  it('parses a study-chat block', () => {
    const f = parseFixture(RAW_STUDY);
    expect(f.studyChat).toEqual({
      book: 'psa',
      chapter: 27,
      question: 'What does it mean to dwell in the house of the LORD?',
      expectGrounding: { minCrossRefs: 3, minLibraryExcerpts: 2, requireBookContext: true },
    });
  });

  it('leaves studyChat undefined on a devotion fixture', () => {
    expect(parseFixture(RAW_FIXTURE).studyChat).toBeUndefined();
  });

  it('rejects a study block with no question', () => {
    expect(() => parseFixture({ ...RAW_STUDY, studyChat: { book: 'psa', chapter: 27 } }))
      .toThrow(/question/);
  });

  it('rejects a non-numeric chapter', () => {
    expect(() => parseFixture({ ...RAW_STUDY, studyChat: { ...RAW_STUDY.studyChat, chapter: 'twenty-seven' } }))
      .toThrow(/chapter/);
  });
});

describe('validateFixtureRefs — studyChat', () => {
  it('catches an unknown book code offline, before a live run pays for it', () => {
    const f = parseFixture({ ...RAW_STUDY, studyChat: { ...RAW_STUDY.studyChat, book: 'psalms' } });
    expect(validateFixtureRefs(f).join(' ')).toMatch(/unknown book code/);
  });

  it('does not demand candidate verses — a study fixture anchors on its chapter', () => {
    expect(validateFixtureRefs(parseFixture(RAW_STUDY))).toEqual([]);
  });
});

describe('fixturesFor', () => {
  const devotion = parseFixture(RAW_FIXTURE);
  const study = parseFixture(RAW_STUDY);

  it('gives study-chat only the fixtures that describe one', () => {
    expect(fixturesFor([devotion, study], 'study-chat').map((f) => f.name)).toEqual(['study-psalm-27']);
  });

  it('keeps study fixtures out of a devotion run', () => {
    expect(fixturesFor([devotion, study], 'devotion').map((f) => f.name)).toEqual(['grief-month']);
  });
});

describe('checkGrounding', () => {
  const full = {
    crossRefs: [{ ref: 'isa 40:31' }, { ref: 'heb 13:6' }, { ref: 'psa 118:6' }],
    libraryExcerpts: [{ sourceId: 'treasury-of-david' }, { sourceId: 'jfb' }],
    bookContext: { book: 'Psalms' },
  };
  const floors = { minCrossRefs: 3, minLibraryExcerpts: 2, requireBookContext: true };

  it('passes when every floor is met', () => {
    expect(checkGrounding(full, floors).every((c) => c.pass)).toBe(true);
  });

  // The regression this whole artifact exists for: bible_cross_references sat
  // empty in production for months, study chat grounded on the open chapter
  // alone, and nothing anywhere went red.
  it('fails loudly when the cross-reference table is empty', () => {
    const checks = checkGrounding({ ...full, crossRefs: [] }, floors);
    const xref = checks.find((c) => c.name === 'grounding_cross_refs')!;
    expect(xref.pass).toBe(false);
    expect(xref.detail).toBe('0 supplied, expected at least 3');
  });

  it('fails when the library returns nothing for a covered passage', () => {
    const checks = checkGrounding({ ...full, libraryExcerpts: [] }, floors);
    expect(checks.find((c) => c.name === 'grounding_library_excerpts')!.pass).toBe(false);
  });

  it('fails when the book apparatus row does not resolve', () => {
    const checks = checkGrounding({ ...full, bookContext: null }, floors);
    expect(checks.find((c) => c.name === 'grounding_book_context')!.pass).toBe(false);
  });

  it('checks only the floors a fixture actually sets', () => {
    expect(checkGrounding(full, {})).toEqual([]);
    expect(checkGrounding(full, undefined)).toEqual([]);
  });

  it('treats a floor of 0 as a real assertion, not an absent one', () => {
    expect(checkGrounding({ ...full, crossRefs: [] }, { minCrossRefs: 0 }))
      .toEqual([{ name: 'grounding_cross_refs', pass: true }]);
  });
});

// ── Insights Door 1 ──────────────────────────────────────────────────────────

const RAW_PASSAGE = {
  name: 'passage-psalm-27',
  description: 'A densely covered psalm — the door at its best-supplied.',
  firstName: null,
  localDate: '2026-08-07',
  periodKey: '2026-08',
  notes: [],
  highlights: [],
  candidateVerses: [],
  passageInsight: {
    book: 'psa',
    chapter: 27,
    expectGrounding: { minCrossRefs: 3, minLibraryExcerpts: 2, requireBookContext: true },
  },
  expect: {},
};

const RAW_PASSAGE_VERSE = {
  ...RAW_PASSAGE,
  name: 'passage-psalm-27-verse-4',
  passageInsight: { ...RAW_PASSAGE.passageInsight, verse: 4 },
};

describe('parseFixture — passageInsight', () => {
  it('parses a chapter-grain door fixture', () => {
    expect(parseFixture(RAW_PASSAGE).passageInsight).toEqual({
      book: 'psa',
      chapter: 27,
      expectGrounding: { minCrossRefs: 3, minLibraryExcerpts: 2, requireBookContext: true },
    });
  });

  it('parses a verse-grain door fixture', () => {
    expect(parseFixture(RAW_PASSAGE_VERSE).passageInsight!.verse).toBe(4);
  });

  it('needs no question — the passage IS the prompt', () => {
    // The one real shape difference from a study-chat fixture.
    expect(() => parseFixture(RAW_PASSAGE)).not.toThrow();
  });

  it('rejects a non-numeric chapter', () => {
    expect(() => parseFixture({ ...RAW_PASSAGE, passageInsight: { book: 'psa', chapter: 'x' } }))
      .toThrow(/chapter/);
  });

  it('rejects a verse that is not a positive integer', () => {
    expect(() => parseFixture({ ...RAW_PASSAGE, passageInsight: { book: 'psa', chapter: 27, verse: 0 } }))
      .toThrow(/verse/);
  });

  it('leaves passageInsight undefined on the other fixture kinds', () => {
    expect(parseFixture(RAW_FIXTURE).passageInsight).toBeUndefined();
    expect(parseFixture(RAW_STUDY).passageInsight).toBeUndefined();
  });
});

describe('validateFixtureRefs — passageInsight', () => {
  it('catches an unknown book code offline, before a live run pays for it', () => {
    const f = parseFixture({ ...RAW_PASSAGE, passageInsight: { book: 'psalms', chapter: 27 } });
    expect(validateFixtureRefs(f).join(' ')).toMatch(/unknown book code/);
  });

  it('does not demand candidate verses — a door anchors on its passage', () => {
    expect(validateFixtureRefs(parseFixture(RAW_PASSAGE))).toEqual([]);
  });
});

describe('fixturesFor — three kinds, no crossover', () => {
  const devotion = parseFixture(RAW_FIXTURE);
  const study = parseFixture(RAW_STUDY);
  const door = parseFixture(RAW_PASSAGE);

  it('gives passage-insight only the fixtures that describe a door', () => {
    expect(fixturesFor([devotion, study, door], 'passage-insight').map((f) => f.name))
      .toEqual(['passage-psalm-27']);
  });

  it('keeps door fixtures out of a study-chat run', () => {
    expect(fixturesFor([devotion, study, door], 'study-chat').map((f) => f.name))
      .toEqual(['study-psalm-27']);
  });

  it('keeps door fixtures out of a devotion run', () => {
    // Regression guard: devotion used to be "everything without a studyChat
    // block", which would now sweep up every door fixture and score it as a
    // devotion the fixture never described.
    expect(fixturesFor([devotion, study, door], 'devotion').map((f) => f.name))
      .toEqual(['grief-month']);
  });
});

describe('checkSections', () => {
  const full = {
    overview: 'David names the LORD his light and his salvation.',
    in_chapter: 'The confidence of the opening gives way to petition.',
    chapter_shape: 'The psalm turns at verse 7.',
    reflection: 'The one thing asked for is presence.',
  };

  it('passes a door whose sections are all present and all finish their sentence', () => {
    expect(checkSections(full).every((c) => c.pass)).toBe(true);
  });

  it('fails a section that came back empty', () => {
    // The four-bound design exists to make omission legitimate — but a door
    // where a section silently vanishes is what only an eval will tell us.
    const checks = checkSections({ ...full, chapter_shape: '' });
    const c = checks.find((x) => x.name === 'section_chapter_shape_present')!;
    expect(c.pass).toBe(false);
  });

  it('fails a section that stops mid-word — the 1400-char truncation, caught', () => {
    const checks = checkSections({ ...full, overview: 'David names the LORD his light and his salv' });
    const c = checks.find((x) => x.name === 'section_overview_complete')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/salv/);
  });

  it('accepts every terminal punctuation a real section ends on', () => {
    for (const ending of ['.', '?', '!', '."', '.”', '.’', '.)']) {
      const checks = checkSections({ ...full, overview: `A complete thought${ending}` });
      expect(checks.find((x) => x.name === 'section_overview_complete')!.pass).toBe(true);
    }
  });

  it('does not report an absent section as also mid-word — one failure, not two', () => {
    const checks = checkSections({ ...full, reflection: '' });
    expect(checks.filter((c) => c.name.startsWith('section_reflection') && !c.pass))
      .toHaveLength(1);
  });

  it('reports a missing key exactly as it reports an empty one', () => {
    const partial = { ...full } as Record<string, string>;
    delete partial.reflection;
    expect(checkSections(partial).find((c) => c.name === 'section_reflection_present')!.pass).toBe(false);
  });
});

describe('checkDisplayRefs', () => {
  // Caught for real by the first B2 live sweep: Door 1's prose read
  // "(psa 27:2; psa 27:3)" and "(2ti 2:19)" — the internal OSIS key echoed
  // straight at the reader. `formatDisplayVerseRef` exists precisely because
  // this happened once before, on the devotion card.
  it('passes prose that names books the way a reader reads them', () => {
    expect(checkDisplayRefs('David asks one thing (Psalm 27:4), echoed in Isaiah 40:31.')[0].pass).toBe(true);
  });

  it('fails prose carrying an OSIS code', () => {
    const check = checkDisplayRefs('David asks one thing (psa 27:4).')[0];
    expect(check.pass).toBe(false);
    expect(check.detail).toContain('psa 27:4');
  });

  it('catches a numbered book code, which is the least readable of all', () => {
    expect(checkDisplayRefs('The Lord knows those who are His (2ti 2:19).')[0].pass).toBe(false);
  });

  it('catches a verse RANGE in code form', () => {
    expect(checkDisplayRefs('The theophany unfolds (nam 1:2–3).')[0].pass).toBe(false);
  });

  it('does not fire on a real book name that merely starts with a code’s letters', () => {
    // 'Nahum 1:2' begins with 'nam'-adjacent letters; 'Job 1:1' is three letters
    // AND a real display name. Neither is a leak.
    expect(checkDisplayRefs('Nahum 1:2 and Job 1:1 and Psalms 27:4.')[0].pass).toBe(true);
  });

  it('reports every distinct leak, not just the first', () => {
    const detail = checkDisplayRefs('See psa 27:4 and also jhn 10:14.')[0].detail!;
    expect(detail).toContain('psa 27:4');
    expect(detail).toContain('jhn 10:14');
  });
});

describe('checkProperties — contested refs', () => {
  const fixture: EvalFixture = parseFixture(RAW_FIXTURE);
  const voice = (text: string, opts?: { allowContestedRefs?: boolean }) =>
    checkProperties(text, fixture, opts).find((c) => c.name === 'voice_families')!;

  it('catches a contested ref written the way the config spells it', () => {
    expect(voice('Paul argues in Romans 9:16 that it rests on mercy.').pass).toBe(false);
  });

  it('catches the SAME ref in OSIS form — reference-aware, not a substring scan', () => {
    // The bug this replaced: a substring scan matched only "Romans 9:16", so
    // every reply spelling it "rom 9:16" scored clean. The pipeline's own
    // checker was reference-aware the whole time; the harness was not.
    expect(voice('Paul argues in rom 9:16 that it rests on mercy.').pass).toBe(false);
  });

  it('honours the exemption a surface actually has', () => {
    // Study chat is asked to NAME contested readings and label them. Scoring it
    // against the blanket rejection marks a correct answer wrong — which is what
    // happened the moment its refs moved to display form.
    expect(voice('Paul argues in Romans 9:16 that it rests on mercy.', { allowContestedRefs: true }).pass)
      .toBe(true);
  });

  it('still catches banned phrasing on an exempt surface', () => {
    // The exemption covers ONE family. A surface that may discuss Romans 9 may
    // still not speak prophetically.
    expect(voice('God is telling you to move on.', { allowContestedRefs: true }).pass).toBe(false);
  });

  it('reports each contested ref once, however often it appears', () => {
    const detail = voice('Romans 9:16 and again Romans 9:16 and rom 9:16.').detail!;
    expect(detail.split(',').length).toBe(1);
  });
});
