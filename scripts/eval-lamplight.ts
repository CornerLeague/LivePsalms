// scripts/eval-lamplight.ts
//
// The Lamplight eval harness (depth-overhaul slice 1d, design decision 11).
//
// The repo has no live-model evaluation, and no public verse-accuracy benchmark
// exists — so a small internal one is worth more than its size suggests. It is
// deliberately NOT in CI: real models cost real money. Run it by hand before any
// prompt_version bump, model id change, or effort change, and attach the report
// to the PR.
//
//   npx tsx scripts/eval-lamplight.ts --dry
//   npx tsx scripts/eval-lamplight.ts --live --artifact=devotion
//   npx tsx scripts/eval-lamplight.ts --live --fixture=grief-month
//
// What a green run proves: the deterministic validators pass, Scripture
// verification finds zero violations, and no banned/contested/growth phrasing
// appears. What it does NOT prove: that the prose sounds like Lamplight. That
// question is not machine-checkable, which is why every run also writes output
// snapshots for a human to read.

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIngestClient } from './ingest-library';
import { BANNED_PHRASES, CONTESTED_PASSAGES, GROWTH_BANNED_PHRASES } from '../supabase/functions/_shared/voice';
import { applyContentRules } from '../supabase/functions/_shared/validators';
import { estCostCentsPrecise } from '../src/admin/lamplight-cost';
import { createOpenAIAdapter } from '../supabase/functions/_shared/openai';
import {
  runDailyDevotionPipeline,
  type DailyDevotionContext,
} from '../supabase/functions/lamplight-generate/daily-devotion-pipeline';
import { verifyVerseRefs } from '../supabase/functions/_shared/verse-verify';
import { formatDisplayVerseRef } from '../supabase/functions/_shared/bible-passage';
import { OSIS_TO_ABBREV } from '../supabase/functions/_shared/bible-books';

// ── Fixtures ─────────────────────────────────────────────────────────────────

export interface FixtureNote {
  id: string;
  title: string;
  text: string;
  /** Days before the fixture's localDate, so a fixture never goes stale. */
  daysAgo: number;
}

export interface FixtureHighlight {
  verseId: string;
  daysAgo: number;
}

export interface FixtureExpectations {
  /** Phrases that must not appear, beyond the shared voice families. */
  mustNotContain?: string[];
  /** Cap on first-name usage; the devotion contract allows at most two. */
  maxFirstNameMentions?: number;
  /** True when the artifact should refuse to generate (a vault with nothing in it). */
  expectNoArtifact?: boolean;
}

export interface EvalFixture {
  name: string;
  description: string;
  firstName: string | null;
  localDate: string;
  periodKey: string;
  notes: FixtureNote[];
  highlights: FixtureHighlight[];
  /**
   * The Scripture the devotion may anchor on. Production retrieves these
   * SEMANTICALLY from the theme query, so every user gets candidates whether or
   * not they have highlighted anything — using highlights as the proxy left two
   * fixtures with an empty candidate list and an impossible task.
   */
  candidateVerses: string[];
  expect: FixtureExpectations;
}

function req(obj: Record<string, unknown>, key: string, what: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`fixture ${what}: missing or empty "${key}"`);
  }
  return v;
}

export function parseFixture(raw: unknown): EvalFixture {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = req(o, 'name', '(unnamed)');
  const notes = (Array.isArray(o.notes) ? o.notes : []).map((n, i) => {
    const note = (n ?? {}) as Record<string, unknown>;
    const where = `${name} note[${i}]`;
    if (typeof note.daysAgo !== 'number') throw new Error(`fixture ${where}: "daysAgo" must be a number`);
    return {
      id: req(note, 'id', where),
      title: typeof note.title === 'string' ? note.title : '',
      text: req(note, 'text', where),
      daysAgo: note.daysAgo,
    };
  });
  const highlights = (Array.isArray(o.highlights) ? o.highlights : []).map((h, i) => {
    const hl = (h ?? {}) as Record<string, unknown>;
    const where = `${name} highlight[${i}]`;
    if (typeof hl.daysAgo !== 'number') throw new Error(`fixture ${where}: "daysAgo" must be a number`);
    return { verseId: req(hl, 'verseId', where), daysAgo: hl.daysAgo };
  });

  return {
    name,
    description: req(o, 'description', name),
    firstName: typeof o.firstName === 'string' && o.firstName.length > 0 ? o.firstName : null,
    localDate: req(o, 'localDate', name),
    periodKey: req(o, 'periodKey', name),
    notes,
    highlights,
    candidateVerses: Array.isArray(o.candidateVerses)
      ? o.candidateVerses.map((v, i) => {
          if (typeof v !== 'string' || v.trim().length === 0) {
            throw new Error(`fixture ${name} candidateVerses[${i}]: must be a non-empty OSIS id`);
          }
          return v;
        })
      : [],
    expect: (o.expect ?? {}) as FixtureExpectations,
  };
}

/** What the devotion may anchor on: explicit candidates, else the highlights. */
export function candidateVerseIds(fixture: EvalFixture): string[] {
  return fixture.candidateVerses.length > 0
    ? fixture.candidateVerses
    : fixture.highlights.map((h) => h.verseId);
}

export function loadFixtures(dir: string): EvalFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseFixture(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/**
 * Fixture verse ids must be real OSIS ids, checked OFFLINE so --dry catches a
 * typo before a live run pays for it.
 *
 * This exists because of a bug it would have caught: a fixture wrote 'phl.4.6'
 * for Philippians, whose code here is 'php'. Nothing errored — the verse simply
 * did not resolve, the devotion's allowlist quietly shrank, and the eval would
 * have scored an artifact built on less grounding than the fixture claimed. A
 * silent shortfall is the worst failure mode a harness can have.
 */
export function validateFixtureRefs(fixture: EvalFixture): string[] {
  const problems: string[] = [];
  const ids = [...fixture.highlights.map((h) => h.verseId), ...fixture.candidateVerses];
  for (const id of ids) {
    const m = id.match(/^([1-3]?[a-z]{2,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) { problems.push(`${id} (malformed OSIS id)`); continue; }
    if (!(m[1] in OSIS_TO_ABBREV)) problems.push(`${id} (unknown book code "${m[1]}")`);
  }
  // A fixture that expects an artifact but offers nothing to anchor on sets the
  // model an impossible task and fails with a confusing empty-ref citation error.
  if (!fixture.expect.expectNoArtifact && candidateVerseIds(fixture).length === 0) {
    problems.push('no candidate verses: the devotion has nothing to anchor on (production always retrieves some)');
  }
  return problems;
}

// ── Property checks (pure) ───────────────────────────────────────────────────

export interface PropertyCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

function countWholeWord(text: string, word: string): number {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`\\b${escaped}\\b`, 'gi')) ?? []).length;
}

/**
 * Fixture-specific expectations plus the shared voice families. Synchronous and
 * regex-only: the Layer-C classifier is a model call, and the harness scores
 * what it can check for free before it scores what costs money.
 */
export function checkProperties(text: string, fixture: EvalFixture): PropertyCheck[] {
  const checks: PropertyCheck[] = [];

  const banned = [...BANNED_PHRASES, ...GROWTH_BANNED_PHRASES].filter((re) => re.test(text));
  const contested = CONTESTED_PASSAGES.filter((p) => text.toLowerCase().includes(p.toLowerCase()));
  checks.push({
    name: 'voice_families',
    pass: banned.length === 0 && contested.length === 0,
    ...(banned.length || contested.length
      ? { detail: [...banned.map(String), ...contested].join(', ') }
      : {}),
  });

  const hits = (fixture.expect.mustNotContain ?? [])
    .filter((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
  checks.push({
    name: 'must_not_contain',
    pass: hits.length === 0,
    ...(hits.length ? { detail: hits.join(', ') } : {}),
  });

  const cap = fixture.expect.maxFirstNameMentions;
  if (fixture.firstName && typeof cap === 'number') {
    const used = countWholeWord(text, fixture.firstName);
    checks.push({
      name: 'max_first_name_mentions',
      pass: used <= cap,
      ...(used > cap ? { detail: `used ${used}×, allowed ${cap}` } : {}),
    });
  }

  return checks;
}

/** The Layer-C classifier pass, for --live runs that can afford a model call. */
export async function checkDoctrine(
  text: string,
  classifier: (t: string) => Promise<Array<{ family: string; rule: string; snippet: string }>>,
): Promise<PropertyCheck> {
  const result = await applyContentRules(text, {
    banned: BANNED_PHRASES,
    contested: CONTESTED_PASSAGES,
    growth: GROWTH_BANNED_PHRASES,
    classifier: classifier as never,
  });
  return {
    name: 'doctrine_classifier',
    pass: result.ok,
    ...(result.ok ? {} : { detail: result.violations.map((v) => `${v.family}:${v.rule}`).join(', ') }),
  };
}

// ── Report aggregation (pure) ────────────────────────────────────────────────

export type ArtifactKind = 'reflection' | 'devotion' | 'study-chat';

export interface FixtureRun {
  fixture: string;
  artifact: ArtifactKind;
  model: string;
  tokensIn: number;
  tokensOut: number;
  scriptureViolations: Array<{ rule: string; snippet: string }>;
  checks: PropertyCheck[];
  /** The generated text, written to the report directory for human read-through. */
  snapshot?: string;
}

export interface ArtifactTally {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
}

export interface EvalReport {
  ok: boolean;
  passed: number;
  failed: number;
  scriptureViolations: number;
  byArtifact: Record<string, ArtifactTally>;
  totalCostCents: number;
  failures: Array<{ fixture: string; artifact: string; reasons: string[] }>;
  notes: string;
}

const HUMAN_NOTE =
  'A green run means the deterministic checks passed. It does NOT mean the prose is good: ' +
  'register — "does this sound like Lamplight?" — is not machine-checkable. Read the snapshots.';

export function aggregateReport(runs: FixtureRun[]): EvalReport {
  const byArtifact: Record<string, ArtifactTally> = {};
  const failures: EvalReport['failures'] = [];
  let passed = 0;
  let failed = 0;
  let scriptureViolations = 0;
  let totalCostCents = 0;

  for (const run of runs) {
    const tally = byArtifact[run.artifact] ?? { runs: 0, tokensIn: 0, tokensOut: 0, costCents: 0 };
    tally.runs++;
    tally.tokensIn += run.tokensIn;
    tally.tokensOut += run.tokensOut;
    const cost = estCostCentsPrecise(run.model, run.tokensIn, run.tokensOut);
    tally.costCents += cost;
    totalCostCents += cost;
    byArtifact[run.artifact] = tally;

    scriptureViolations += run.scriptureViolations.length;

    // A scripture violation fails its fixture outright — it is the one class of
    // error the product promises cannot happen.
    const reasons = [
      ...run.scriptureViolations.map((v) => `scripture:${v.rule} "${v.snippet}"`),
      ...run.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`),
    ];
    if (reasons.length === 0) passed++;
    else {
      failed++;
      failures.push({ fixture: run.fixture, artifact: run.artifact, reasons });
    }
  }

  return {
    ok: failed === 0 && scriptureViolations === 0,
    passed,
    failed,
    scriptureViolations,
    byArtifact,
    totalCostCents,
    failures,
    notes: HUMAN_NOTE,
  };
}

export function formatReport(report: EvalReport, label: string): string {
  const lines: string[] = [
    `# Lamplight eval — ${label}`,
    '',
    `**${report.ok ? 'PASS' : 'FAIL'}** · ${report.passed} passed, ${report.failed} failed · ` +
      `${report.scriptureViolations} scripture violation(s) · $${(report.totalCostCents / 100).toFixed(4)}`,
    '',
    '| Artifact | Runs | Tokens in | Tokens out | Cost |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const [kind, t] of Object.entries(report.byArtifact)) {
    lines.push(`| ${kind} | ${t.runs} | ${t.tokensIn} | ${t.tokensOut} | $${(t.costCents / 100).toFixed(4)} |`);
  }
  if (report.failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const f of report.failures) {
      lines.push(`- **${f.fixture}** (${f.artifact})`);
      for (const r of f.reasons) lines.push(`  - ${r}`);
    }
  }
  if (report.failed > 0) {
    lines.push(
      '',
      '> **Cost above excludes failed generations.** The pipeline reports zero tokens on a ' +
      '`validators_failed` outcome, so a failing run costs real money that this table shows as $0. ' +
      'Read the failure count, not the total, when a run is red.',
    );
  }
  lines.push('', '## What this run does not prove', '', report.notes, '');
  return lines.join('\n');
}

export function writeReport(dir: string, report: EvalReport, label: string, runs: FixtureRun[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), formatReport(report, label), 'utf8');
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ report, runs }, null, 2), 'utf8');
  // Snapshots are the point of a human read-through: one file per fixture.
  for (const run of runs) {
    if (!run.snapshot) continue;
    writeFileSync(join(dir, `${run.fixture}.${run.artifact}.md`), run.snapshot, 'utf8');
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const FIXTURE_DIR = join(import.meta.dirname, 'eval-fixtures');

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const only = arg('fixture');
  const artifact = (arg('artifact') ?? 'devotion') as ArtifactKind;
  const label = arg('label') ?? (live ? 'live' : 'dry');

  let fixtures = loadFixtures(FIXTURE_DIR);
  if (only) fixtures = fixtures.filter((f) => f.name === only);
  if (fixtures.length === 0) throw new Error(`no fixtures matched${only ? ` --fixture=${only}` : ''}`);

  console.log(`${live ? 'LIVE' : 'DRY'} · ${artifact} · ${fixtures.length} fixture(s)\n`);

  if (!live) {
    // Dry mode spends nothing: it proves the fixtures parse, the context each
    // one implies is well formed, and the scoring layer runs — the things worth
    // knowing before paying for a live sweep.
    let refProblems = 0;
    for (const f of fixtures) {
      const corpus = f.notes.map((n) => `${n.title}\n${n.text}`).join('\n\n');
      const bad = checkProperties(corpus, f).filter((c) => !c.pass);
      const refs = validateFixtureRefs(f);
      refProblems += refs.length;
      console.log(
        `  ${bad.length === 0 && refs.length === 0 ? '✓' : '✗'} ${f.name.padEnd(24)} ` +
        `${f.notes.length} note(s), ${f.highlights.length} highlight(s)` +
        (bad.length ? `  ← ${bad.map((c) => c.name).join(', ')}` : '') +
        (refs.length ? `  ← bad refs: ${refs.join('; ')}` : ''),
      );
    }
    if (refProblems > 0) process.exitCode = 1;
    console.log('\nDry run only. Fixture corpora were scored, no model was called.');
    console.log('Run with --live (and OPENAI_API_KEY set) to generate and score real artifacts.');
    return;
  }

  if (artifact !== 'devotion') {
    throw new Error(
      `--artifact=${artifact} is not wired for live runs in v1; only 'devotion' is. ` +
      'See docs/lamplight/evals/README.md §Coverage.',
    );
  }

  // Live mode is deliberately SELF-CONTAINED: it needs one secret
  // (OPENAI_API_KEY) and touches no user data. Verse text comes from
  // bible_passages through the ANON key — that table is public reference data —
  // and the fixtures supply everything else, so an eval can never be pointed at
  // a real vault by accident.
  loadDotEnvLocal();
  const openaiKey = requiredEnv('OPENAI_API_KEY');
  const supabaseUrl = requiredEnv('VITE_SUPABASE_URL');
  const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
  // createIngestClient, not createClient: supabase-js builds a RealtimeClient at
  // construction and Node 20 has no global WebSocket, so a bare createClient
  // throws before the first query. The shared helper passes an unused transport.
  // (Vitest never catches this — src/test-setup.ts stubs global WebSocket.)
  const supabase = createIngestClient(supabaseUrl, anonKey);
  const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });

  const runs: FixtureRun[] = [];
  for (const fixture of fixtures) {
    process.stdout.write(`  ${fixture.name.padEnd(24)} `);
    const run = await runDevotionFixture({ fixture, llm, supabase: supabase as unknown as AnonClient });
    runs.push(run);
    const bad = run.checks.filter((c) => !c.pass).length + run.scriptureViolations.length;
    console.log(bad === 0 ? '✓' : `✗ ${bad} issue(s)`);
  }

  const report = aggregateReport(runs);
  const dir = join(import.meta.dirname, '..', 'docs', 'lamplight', 'evals', `${arg('date') ?? todayStamp()}-${label}`);
  writeReport(dir, report, label, runs);
  console.log(`\n${formatReport(report, label)}`);
  console.log(`Report + snapshots written to ${dir}`);
  if (!report.ok) process.exitCode = 1;
}

/**
 * Fill missing env vars from .env.local. The Supabase URL and ANON key already
 * live there — the anon key is public by design — so a live run should not make
 * the operator hand-extract values the repo already has. Never overwrites a var
 * that is already set, so an explicit export always wins.
 */
function loadDotEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8');
  } catch {
    return;   // absent is fine; the requiredEnv checks below give the real message
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is required for a live run. ` +
      (name.startsWith('VITE_')
        ? 'It is normally read from .env.local — check that file exists at the repo root.'
        : 'Export it in your shell; it is a secret and is never read from a file in the repo.'),
    );
  }
  return v;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// A minimal structural view of the anon client. createClient's generics vary
// with the schema type parameters and are not worth threading through a script.
type AnonClient = {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        in(col: string, vals: string[]): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
};

/** Canonical verse text for the fixture's highlighted refs (public reference data). */
async function loadPassages(
  supabase: AnonClient,
  verseIds: string[],
): Promise<Array<{ source_id: string; ref: string; text: string; metadata: Record<string, unknown> }>> {
  if (verseIds.length === 0) return [];
  const { data, error } = await supabase
    .from('bible_passages')
    .select('id, book, chapter, verse_start, verse_end, text')
    .eq('translation', 'BSB')
    .in('id', verseIds);
  if (error) throw new Error(`bible_passages: ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as { id: string; book: string; chapter: number; verse_start: number; verse_end: number; text: string };
    // formatDisplayVerseRef, matching buildPassages in the real devotion path.
    return { source_id: row.id, ref: formatDisplayVerseRef(row), text: row.text, metadata: {} };
  });
}

async function runDevotionFixture(args: {
  fixture: EvalFixture;
  llm: ReturnType<typeof createOpenAIAdapter>;
  supabase: AnonClient;
}): Promise<FixtureRun> {
  const { fixture, llm, supabase } = args;
  const wanted = candidateVerseIds(fixture);
  const passages = await loadPassages(supabase, wanted);

  // A fixture that claims grounding it does not have would score a devotion
  // built on less than it advertised. Fail loudly instead.
  const unresolved = wanted.length - passages.length;

  const ctx: DailyDevotionContext | null = fixture.notes.length === 0 ? null : {
    notes: fixture.notes.map((n) => ({ id: n.id, title: n.title || '(untitled)', plaintext: n.text })),
    passages,
    localDate: fixture.localDate,
    firstName: fixture.firstName,
    allowedNoteIds: new Set(fixture.notes.map((n) => n.id)),
    allowedVerseRefs: new Set(passages.map((p) => p.ref)),
    rerankUsed: false,
  };

  // A stub persistence layer: the eval scores generations, it does not write
  // artifacts. `maybeSingle` reports no cached row so every fixture generates.
  const captured: Array<Record<string, unknown>> = [];
  const stubSupabase = {
    from() {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: { message: 'none' } }),
        }) }) }) }),
        insert: (row: Record<string, unknown>) => {
          captured.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'eval' }, error: null }) }) };
        },
      };
    },
  };

  const result = await runDailyDevotionPipeline({
    llm,
    supabase: stubSupabase as never,
    ctx,
    userId: `eval-${fixture.name}`,
    localDate: fixture.localDate,
    verifyScripture: {
      translation: 'BSB',
      verifyRefs: (refs, t) => verifyVerseRefs(supabase as never, refs, t),
    },
  });

  const refCheck: PropertyCheck = {
    name: 'fixture_verses_resolve',
    pass: unresolved === 0,
    ...(unresolved === 0 ? {} : { detail: `${unresolved} of ${wanted.length} verse id(s) did not resolve` }),
  };

  const base: Omit<FixtureRun, 'checks' | 'scriptureViolations'> = {
    fixture: fixture.name,
    artifact: 'devotion',
    model: result.usage?.model ?? 'unknown',
    tokensIn: result.usage?.tokens_in ?? 0,
    tokensOut: result.usage?.tokens_out ?? 0,
  };

  // The empty-vault fixture asserts a REFUSAL: generating anything there would
  // mean inventing a reader.
  if (fixture.expect.expectNoArtifact) {
    const refused = result.ok === false && result.reason === 'no_notes';
    return {
      ...base,
      scriptureViolations: [],
      checks: [{ name: 'expect_no_artifact', pass: refused, ...(refused ? {} : { detail: 'an artifact was generated for an empty vault' }) }],
    };
  }

  if (result.ok === false) {
    // Surface WHY. "validators_failed" alone sends the reader back to the model
    // when the answer is usually in the violations the pipeline already computed.
    const v = result.violations;
    const detail = [
      `pipeline returned ${result.reason}`,
      ...(v?.citation ?? []).map((c) => `citation:${c.reason} ${c.detail}`),
      ...(v?.content ?? []).map((c) => `content:${c.family}/${c.rule} "${c.snippet}"`),
    ].join(' · ');
    return {
      ...base,
      scriptureViolations: [],
      checks: [{ name: 'generation', pass: false, detail }],
    };
  }

  const a = result.artifact;
  const text = [a.opening, a.scripture.ref, a.scripture.text, a.reflection, a.prompt].join('\n\n');
  return {
    ...base,
    // The pipeline already ran verification and either repaired or failed the
    // artifact, so anything reaching here is clean by construction — a violation
    // recorded at this point would mean the gate itself regressed.
    scriptureViolations: [],
    checks: [refCheck, ...checkProperties(text, fixture)],
    snapshot: `# ${fixture.name} · devotion\n\n_${fixture.description}_\n\n${text}\n`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
