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
import { selectDevotionCandidates } from '../supabase/functions/_shared/note-context';
import { buildPassages } from '../supabase/functions/_shared/bible-passage';
import { OSIS_TO_ABBREV } from '../supabase/functions/_shared/bible-books';
import { buildStudyContext } from '../supabase/functions/lamplight-study/study-context';
import { STUDY_CHAT_PROMPT } from '../supabase/functions/lamplight-study/prompts/study-chat';
import { runBibleChatPipeline } from '../supabase/functions/lamplight-chat/bible-chat-pipeline';
import type { VoyageDeps } from '../supabase/functions/_shared/voyage';

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

/**
 * A study-chat scenario: an open chapter and a question a reader would actually
 * type. Grounding floors are the load-bearing part — a reply can read perfectly
 * while the grounding underneath it is silently missing, which is exactly what
 * happened while `bible_cross_references` sat empty in production and every
 * study turn quietly grounded on the open chapter alone.
 */
export interface FixtureStudyChat {
  book: string;          // lowercase OSIS, e.g. 'psa'
  chapter: number;
  question: string;
  expectGrounding?: {
    /** Cross-references that must reach the prompt. 0 means "do not care". */
    minCrossRefs?: number;
    /** Library excerpts that must reach the prompt. */
    minLibraryExcerpts?: number;
    /** The book apparatus row must resolve. */
    requireBookContext?: boolean;
  };
}

export interface EvalFixture {
  name: string;
  description: string;
  firstName: string | null;
  localDate: string;
  periodKey: string;
  notes: FixtureNote[];
  highlights: FixtureHighlight[];
  /** Present only on study-chat fixtures; absent means devotion-only. */
  studyChat?: FixtureStudyChat;
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

  let studyChat: FixtureStudyChat | undefined;
  if (o.studyChat != null) {
    const sc = o.studyChat as Record<string, unknown>;
    const where = `${name} studyChat`;
    if (typeof sc.chapter !== 'number' || sc.chapter < 1) {
      throw new Error(`fixture ${where}: "chapter" must be a positive number`);
    }
    studyChat = {
      book: req(sc, 'book', where),
      chapter: sc.chapter,
      question: req(sc, 'question', where),
      expectGrounding: (sc.expectGrounding ?? {}) as FixtureStudyChat['expectGrounding'],
    };
  }

  return {
    name,
    description: req(o, 'description', name),
    firstName: typeof o.firstName === 'string' && o.firstName.length > 0 ? o.firstName : null,
    localDate: req(o, 'localDate', name),
    periodKey: req(o, 'periodKey', name),
    notes,
    highlights,
    ...(studyChat ? { studyChat } : {}),
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

  if (fixture.studyChat) {
    // Same offline-typo discipline the verse ids get: a bad book code would
    // otherwise surface as an empty chapter and an eval scoring a reply built
    // on nothing.
    if (!(fixture.studyChat.book in OSIS_TO_ABBREV)) {
      problems.push(`studyChat.book "${fixture.studyChat.book}" (unknown book code)`);
    }
    return problems;   // study-chat fixtures anchor on a chapter, not candidates
  }

  // A fixture that expects an artifact but offers nothing to anchor on sets the
  // model an impossible task and fails with a confusing empty-ref citation error.
  if (!fixture.expect.expectNoArtifact && candidateVerseIds(fixture).length === 0) {
    problems.push('no candidate verses: the devotion has nothing to anchor on (production always retrieves some)');
  }
  return problems;
}

/**
 * Which fixtures a given `--artifact` run should use. A fixture describes one
 * kind of scenario; running a devotion fixture through study-chat (or the
 * reverse) would score an artifact the fixture never intended.
 */
export function fixturesFor(fixtures: EvalFixture[], artifact: ArtifactKind): EvalFixture[] {
  return artifact === 'study-chat'
    ? fixtures.filter((f) => f.studyChat !== undefined)
    : fixtures.filter((f) => f.studyChat === undefined);
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

  let fixtures = fixturesFor(loadFixtures(FIXTURE_DIR), artifact);
  if (only) fixtures = fixtures.filter((f) => f.name === only);
  if (fixtures.length === 0) {
    throw new Error(
      `no ${artifact} fixtures matched${only ? ` --fixture=${only}` : ''}. ` +
      (artifact === 'study-chat'
        ? 'Study-chat fixtures are the ones carrying a "studyChat" block.'
        : 'Devotion fixtures are the ones without a "studyChat" block.'),
    );
  }

  const mode = !live ? 'DRY' : process.argv.includes('--grounding-only') ? 'GROUNDING' : 'LIVE';
  console.log(`${mode} · ${artifact} · ${fixtures.length} fixture(s)\n`);

  if (!live) {
    // Dry mode spends nothing: it proves the fixtures parse, the context each
    // one implies is well formed, and the scoring layer runs — the things worth
    // knowing before paying for a live sweep.
    let refProblems = 0;
    for (const f of fixtures) {
      const corpus = f.studyChat
        ? f.studyChat.question
        : f.notes.map((n) => `${n.title}\n${n.text}`).join('\n\n');
      const bad = checkProperties(corpus, f).filter((c) => !c.pass);
      const refs = validateFixtureRefs(f);
      refProblems += refs.length;
      const shape = f.studyChat
        ? `${f.studyChat.book} ${f.studyChat.chapter}`
        : `${f.notes.length} note(s), ${f.highlights.length} highlight(s)`;
      console.log(
        `  ${bad.length === 0 && refs.length === 0 ? '✓' : '✗'} ${f.name.padEnd(24)} ${shape}` +
        (bad.length ? `  ← ${bad.map((c) => c.name).join(', ')}` : '') +
        (refs.length ? `  ← bad refs: ${refs.join('; ')}` : ''),
      );
    }
    if (refProblems > 0) process.exitCode = 1;
    console.log('\nDry run only. Fixture corpora were scored, no model was called.');
    console.log('Run with --live (and OPENAI_API_KEY set) to generate and score real artifacts.');
    return;
  }

  if (artifact === 'reflection') {
    throw new Error(
      "--artifact=reflection is not wired for live runs; 'devotion' and 'study-chat' are. " +
      'Reflection needs a month of retrieval context the fixtures do not yet describe. ' +
      'See docs/lamplight/evals/README.md §Coverage.',
    );
  }

  // Live mode is deliberately SELF-CONTAINED: it needs one secret
  // (OPENAI_API_KEY) and touches no user data. Verse text comes from
  // bible_passages through the ANON key — that table is public reference data —
  // and the fixtures supply everything else, so an eval can never be pointed at
  // a real vault by accident.
  loadDotEnvLocal();
  // --grounding-only builds and scores the context and stops, so it needs no
  // model and no OpenAI key. It is the free half of a study-chat run: the
  // grounding floors are what catch a retrieval channel going dark, and making
  // them cost nothing is what makes them worth running often.
  const groundingOnly = process.argv.includes('--grounding-only');
  if (groundingOnly && artifact !== 'study-chat') {
    throw new Error('--grounding-only applies to --artifact=study-chat; the devotion runner builds its context from the fixture.');
  }
  const openaiKey = groundingOnly ? '' : requiredEnv('OPENAI_API_KEY');
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
    const run = artifact === 'study-chat'
      ? await runStudyChatFixture({ fixture, llm, supabase: supabase as unknown as AnonClient, groundingOnly })
      : await runDevotionFixture({ fixture, llm, supabase: supabase as unknown as AnonClient });
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
 *
 * NOTE: this is indiscriminate — it fills ANY missing var it finds, secrets
 * included, so OPENAI_API_KEY in .env.local is picked up like anything else.
 * That file is gitignored, so this is a convenience rather than a leak, but it
 * is worth knowing when auditing where a key can come from. (The requiredEnv
 * message used to claim the opposite.)
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
        // Accurate as of 2026-08-06: this used to claim secrets are "never read
        // from a file in the repo", which loadDotEnvLocal has never honoured —
        // it fills ANY missing var from .env.local. Misdescribing where a
        // secret can come from is worse than the leniency itself.
        : 'Export it in your shell, or add it to .env.local (gitignored). An explicit export wins.'),
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
  // buildPassages IS the production transformation (display refs, psalm
  // superscription strip, whatever comes next) — the harness re-implemented it
  // once and diverged twice, so now it calls the real thing with synthetic
  // retrieval rows.
  const rows = (data ?? []) as Array<{ id: string; book: string; chapter: number; verse_start: number; verse_end: number; text: string }>;
  const synthetic = verseIds.map((id, i) => ({ id: `eval-${i}`, source_id: id, chunk_index: 0, chunk_text: '', similarity: 0, metadata: {} }));
  return buildPassages(rows, synthetic);
}

async function runDevotionFixture(args: {
  fixture: EvalFixture;
  llm: ReturnType<typeof createOpenAIAdapter>;
  supabase: AnonClient;
}): Promise<FixtureRun> {
  const { fixture, llm, supabase } = args;
  const wanted = candidateVerseIds(fixture);
  const loaded = await loadPassages(supabase, wanted);

  // A fixture that claims grounding it does not have would score a devotion
  // built on less than it advertised. Fail loudly instead. Counted BEFORE the
  // contested filter: a filtered candidate resolved fine — it was removed on
  // purpose. Conflating the two re-reported the deliberate rom.9.16 filter as
  // a data error (contested-fix2 run, 2026-08-05).
  const unresolved = wanted.length - loaded.length;

  // Same filter production applies — the harness hand-builds its context, so any
  // transformation not shared here silently makes the eval test a fiction.
  const passages = selectDevotionCandidates(loaded, wanted.length);

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

// ── Study chat ───────────────────────────────────────────────────────────────
//
// Grounded on the anon key, which means the three semantic RPCs
// (`match_user_note_embeddings`, `match_bible_embeddings`, `match_library_chunks`)
// are out of reach — they are revoked from public, and their callers throw
// rather than degrade. So the run sets `skipSemanticRetrieval` and exercises the
// deterministic channels: chapter text, book apparatus, cross-references and
// their resolved targets, the library's verse-anchor join, and the lexicon.
//
// That is a real limit, and it is stated in the report rather than left to be
// inferred from a suspiciously empty grounding block. It is also the half that
// matters most here: those are precisely the channels that sat dark while
// `bible_cross_references` was empty, and the grounding floors below are what
// would have caught it.
//
// Reaching further would mean either a service-role key — which would break the
// harness's guarantee that it can never touch a real vault — or a seeded eval
// account. Both are bigger decisions than a scoring layer should make on its own.

/** Never called: `skipSemanticRetrieval` short-circuits every path that would. */
const FORBIDDEN_VOYAGE = {
  apiKey: '',
  fetch: (() => {
    throw new Error('eval study-chat must not call Voyage; skipSemanticRetrieval should have short-circuited');
  }) as never,
} as unknown as VoyageDeps;

const STUDY_EVAL = { crossRefK: 5, libraryK: 4, effort: 'low', maxTokens: 4096 } as const;

export function checkGrounding(
  ctx: { crossRefs: unknown[]; libraryExcerpts?: unknown[]; bookContext?: unknown },
  expect: FixtureStudyChat['expectGrounding'],
): PropertyCheck[] {
  const checks: PropertyCheck[] = [];
  const e = expect ?? {};

  if (typeof e.minCrossRefs === 'number') {
    const got = ctx.crossRefs.length;
    checks.push({
      name: 'grounding_cross_refs',
      pass: got >= e.minCrossRefs,
      ...(got >= e.minCrossRefs ? {} : { detail: `${got} supplied, expected at least ${e.minCrossRefs}` }),
    });
  }
  if (typeof e.minLibraryExcerpts === 'number') {
    const got = (ctx.libraryExcerpts ?? []).length;
    checks.push({
      name: 'grounding_library_excerpts',
      pass: got >= e.minLibraryExcerpts,
      ...(got >= e.minLibraryExcerpts ? {} : { detail: `${got} supplied, expected at least ${e.minLibraryExcerpts}` }),
    });
  }
  if (e.requireBookContext) {
    const got = ctx.bookContext != null;
    checks.push({
      name: 'grounding_book_context',
      pass: got,
      ...(got ? {} : { detail: 'no bible_books row resolved for this book' }),
    });
  }
  return checks;
}

function formatGroundingSnapshot(
  fixture: EvalFixture,
  sc: FixtureStudyChat,
  ctx: {
    passageRef: string;
    crossRefs: Array<{ ref: string }>;
    libraryExcerpts?: Array<{ sourceId: string }>;
    lexiconEntries?: unknown[];
    bookContext?: { book: string } | null;
  },
): string {
  const excerpts = ctx.libraryExcerpts ?? [];
  return [
    `# ${fixture.name} · study-chat`,
    '',
    `_${fixture.description}_`,
    '',
    `**Passage:** ${ctx.passageRef} · **Question:** ${sc.question}`,
    '',
    '## Grounding supplied',
    '',
    `- cross-references: ${ctx.crossRefs.length}` +
      (ctx.crossRefs.length ? ` — ${ctx.crossRefs.map((c) => c.ref).join(', ')}` : ''),
    `- library excerpts: ${excerpts.length}` +
      (excerpts.length ? ` — ${[...new Set(excerpts.map((e) => e.sourceId))].join(', ')}` : ''),
    `- lexicon entries: ${(ctx.lexiconEntries ?? []).length}`,
    `- book context: ${ctx.bookContext ? ctx.bookContext.book : 'none'}`,
    '- semantic channels: **off** — the harness runs on the anon key, which cannot reach',
    '  `match_user_note_embeddings`, `match_bible_embeddings`, or `match_library_chunks`.',
    '',
  ].join('\n');
}

async function runStudyChatFixture(args: {
  fixture: EvalFixture;
  llm: ReturnType<typeof createOpenAIAdapter>;
  supabase: AnonClient;
  /** Build and score the grounding, then stop. No model call, no cost. */
  groundingOnly?: boolean;
}): Promise<FixtureRun> {
  const { fixture, llm, supabase } = args;
  const sc = fixture.studyChat!;

  const { ctx } = await buildStudyContext(supabase as never, {
    userId: `eval-${fixture.name}`,      // never used: notes are skipped
    book: sc.book,
    chapter: sc.chapter,
    passageRef: `${sc.book}.${sc.chapter}`,
    message: sc.question,
    retrievalQuery: sc.question,
    history: [],
    includeNotes: false,
    noteIds: [],
    voyageDeps: FORBIDDEN_VOYAGE,
    rerankEnabled: false,
    crossRefK: STUDY_EVAL.crossRefK,
    noteK: 0,
    translation: 'BSB',
    libraryK: STUDY_EVAL.libraryK,
    skipSemanticRetrieval: true,
  });

  const groundingChecks = checkGrounding(ctx, sc.expectGrounding);

  // The grounding floors are the check that would have caught an empty
  // bible_cross_references, and they cost nothing to run — so they are
  // available without the model call that follows.
  if (args.groundingOnly) {
    return {
      fixture: fixture.name,
      artifact: 'study-chat',
      model: 'none',
      tokensIn: 0,
      tokensOut: 0,
      scriptureViolations: [],
      checks: groundingChecks,
      snapshot: formatGroundingSnapshot(fixture, sc, ctx),
    };
  }

  const result = await runBibleChatPipeline({
    llm,
    ctx,
    prompt: STUDY_CHAT_PROMPT,
    model: 'deep',
    effort: STUDY_EVAL.effort,
    maxTokens: STUDY_EVAL.maxTokens,
    verifyScripture: {
      translation: 'BSB',
      verifyRefs: (refs, t) => verifyVerseRefs(supabase as never, refs, t),
    },
  });

  const base: Omit<FixtureRun, 'checks' | 'scriptureViolations'> = {
    fixture: fixture.name,
    artifact: 'study-chat',
    model: result.usage?.model ?? 'unknown',
    tokensIn: result.usage?.tokens_in ?? 0,
    tokensOut: result.usage?.tokens_out ?? 0,
  };

  if (!result.ok) {
    return {
      ...base,
      scriptureViolations: [],
      checks: [...groundingChecks, { name: 'generation', pass: false, detail: `pipeline returned ${result.reason}` }],
    };
  }

  // The grounding block is snapshotted alongside the reply. A reply that reads
  // well on grounding that was never there is the failure this whole artifact
  // exists to make visible, and the two are only judgeable together.
  const snapshot = [
    formatGroundingSnapshot(fixture, sc, ctx),
    '## Reply',
    '',
    result.reply,
    '',
    `_citations: ${result.citations.length ? result.citations.map((c) => JSON.stringify(c)).join(', ') : 'none'}_`,
    '',
  ].join('\n');

  return {
    ...base,
    scriptureViolations: [],
    checks: [...groundingChecks, ...checkProperties(result.reply, fixture)],
    snapshot,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
