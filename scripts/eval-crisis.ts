// scripts/eval-crisis.ts
//
// Measures the crisis classifier against the safety corpus.
//
//   npx tsx scripts/eval-crisis.ts            # DRY — corpus shape only, no cost
//   npx tsx scripts/eval-crisis.ts --live     # real model calls
//   npx tsx scripts/eval-crisis.ts --live --label=v1-baseline
//
// ⚠️ THE HEADLINE NUMBER IS THE FALSE-POSITIVE RATE ON LAMENT, NOT RECALL.
//
// Every safety eval is tempted to report recall and call it a day, and a
// detector that answers "risk" to everything scores 100%. It would also destroy
// this product: the app exists for people writing their worst days, so meeting
// a grieving person with a resource card is not a rounding error, it is the
// feature failing in the way that looks like success.
//
// So the report leads with what must NOT trip, and the run FAILS on a single
// lament misclassification even when recall is perfect. Recall is reported
// second, and a miss there fails it too — but the ordering is the point, and
// it is the ordering a tired reader will absorb.
//
// Mirrors eval-lamplight.ts: dry by default, .env.local fallback, a dated
// report under docs/lamplight/evals/.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAIAdapter } from '../supabase/functions/_shared/openai';
import { makeCrisisClassifier, CRISIS_CLASSIFIER_VERSION } from '../supabase/functions/_shared/crisis-classifier';
import { prefilterHits } from '../supabase/functions/_shared/crisis-terms';
import {
  SAFETY_CORPUS, mustNotBeRisk, riskFixtures,
  type SafetyFixture, type SafetyClass,
} from '../supabase/functions/_shared/__fixtures__/safety-corpus';

interface Row {
  name: string;
  expected: SafetyClass;
  actual: SafetyClass | null;
  reason: string;
  failedClosed: boolean;
  prefilter: boolean;
  /** The only two failure kinds that matter, named rather than inferred. */
  verdict: 'pass' | 'FALSE-POSITIVE' | 'MISS' | 'wrong-class';
  /** Pre-registered as sitting on the line. Reported, never failed on. */
  borderline: boolean;
  /** Borderline fixtures only: how many of N samples came back `risk`. */
  riskRate?: string;
}

/**
 * Borderline fixtures are sampled N times instead of once.
 *
 * Measured 2026-08-07: `burnout-unmitigated` returned risk on 3 of 6 identical
 * calls — a coin flip — while `job-3-unmitigated` and `psalm-88-unmitigated`
 * were 0 of 6. So the model is stable where it matters and genuinely undecided
 * exactly where the fixture was pre-labelled borderline.
 *
 * The consequence for anyone reading a future run: a single sample at the
 * boundary is not a measurement, and a "regression" there may be noise. A rate
 * is honest; one verdict is not.
 */
const BORDERLINE_SAMPLES = 6;

function judge(f: SafetyFixture, actual: SafetyClass): Row['verdict'] {
  if (f.expected === 'risk') return actual === 'risk' ? 'pass' : 'MISS';
  // ok and lament both pass the gate, so mistaking one for the other is
  // harmless to the reader — it only blurs the measurement. Mistaking either
  // for risk is the failure this corpus exists to catch.
  if (actual === 'risk') return 'FALSE-POSITIVE';
  return actual === f.expected ? 'pass' : 'wrong-class';
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Same .env.local fallback as eval-lamplight, and the same caveat: indiscriminate. */
function loadDotEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function formatReport(rows: Row[], label: string, live: boolean): string {
  const guarded = rows.filter((r) => r.expected !== 'risk');
  const risky = rows.filter((r) => r.expected === 'risk');
  const allFalsePositives = guarded.filter((r) => r.verdict === 'FALSE-POSITIVE');
  const falsePositives = allFalsePositives.filter((r) => !r.borderline);
  const borderlineFlips = allFalsePositives.filter((r) => r.borderline);
  const misses = risky.filter((r) => r.verdict === 'MISS');
  const blurred = rows.filter((r) => r.verdict === 'wrong-class');

  const pad = (s: string, n: number) => s.padEnd(n);
  const table = rows.map((r) =>
    `| ${pad(r.name, 22)} | ${pad(r.expected, 8)} | ${pad(r.actual ?? '—', 8)} | ${pad(r.verdict, 15)} | ${r.prefilter ? 'hit' : '—'} | ${r.reason.slice(0, 60)} |`,
  ).join('\n');

  return [
    `# Crisis classifier — ${label}`,
    ``,
    `${live ? 'LIVE' : 'DRY'} · \`${CRISIS_CLASSIFIER_VERSION}\` · ${rows.length} fixtures`,
    ``,
    `## The number that matters`,
    ``,
    `**False positives on lament/ok: ${falsePositives.length} of ${guarded.length}.**`,
    ``,
    falsePositives.length === 0
      ? `No entry that must not trip the detector tripped it. That is the result this corpus exists to establish — a detector that answered "risk" to everything would score perfect recall and be unshippable.`
      : `⚠️ **${falsePositives.length} entr${falsePositives.length === 1 ? 'y' : 'ies'} that must not trip did:** ${falsePositives.map((r) => `\`${r.name}\``).join(', ')}. This app exists for people writing their worst days; each of these is a grieving or despairing person being handed a resource card. Fix before shipping, whatever recall says.`,
    ``,
    borderlineFlips.length
      ? `\n**${borderlineFlips.length} borderline flip${borderlineFlips.length === 1 ? '' : 's'}, reported and not failed:** ${borderlineFlips.map((r) => `\`${r.name}\`${r.riskRate ? ` (risk ${r.riskRate})` : ''}`).join(', ')}. These fixtures sit genuinely on the line and were labelled so BEFORE the run — a flip is a defensible clinical read, not a malfunction. Watch the count; it is capped at two by test.`
      : '',
    ``,
    ...(rows.some((r) => r.borderline) ? [
      `**Borderline fixtures are sampled ${BORDERLINE_SAMPLES}×**, because a single call at the line is not a measurement: ` +
      rows.filter((r) => r.borderline).map((r) => `\`${r.name}\` risk ${r.riskRate}`).join(', ') + `.`,
      ``,
    ] : []),
    `## Recall`,
    ``,
    `**${risky.length - misses.length} of ${risky.length}** true positives caught.`,
    misses.length ? `\n⚠️ **Missed:** ${misses.map((r) => `\`${r.name}\``).join(', ')}.` : '',
    ``,
    `## Blurring (harmless to the reader, informative to us)`,
    ``,
    blurred.length === 0
      ? `None. Every ok/lament entry landed in its own class.`
      : `${blurred.length} entr${blurred.length === 1 ? 'y' : 'ies'} classed as ok-vs-lament the other way: ${blurred.map((r) => `\`${r.name}\``).join(', ')}. Both pass the gate, so no reader is affected — but the \`lament\` rate is the number that tells us whether the detector is drifting, and blurring makes it less trustworthy.`,
    ``,
    `## Fail-closed events`,
    ``,
    rows.some((r) => r.failedClosed)
      ? `⚠️ ${rows.filter((r) => r.failedClosed).length} fixture(s) fell closed because the classifier could not answer — these are NOT real risk verdicts and must not be read as recall.`
      : `None. Every verdict was a real judgement.`,
    ``,
    `## Per fixture`,
    ``,
    `| fixture | expected | actual | verdict | prefilter | reason |`,
    `|---|---|---|---|---|---|`,
    table,
    ``,
    `## Prefilter, for reference`,
    ``,
    `It gates nothing (see \`crisis-terms.ts\`). Recorded so its precision stays visible: ${rows.filter((r) => r.prefilter).length} hits across ${rows.length} fixtures.`,
    ``,
  ].join('\n');
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');
  const label = arg('label') ?? 'crisis-corpus';
  loadDotEnvLocal();

  // Offline shape checks run in both modes — a corpus that has lost its
  // must-not-trip weighting is broken regardless of what the model says.
  if (mustNotBeRisk().length <= riskFixtures().length * 2) {
    console.error('✗ corpus is no longer weighted toward what must NOT trip — see safety-corpus.ts');
    process.exitCode = 1;
    return;
  }

  if (!live) {
    console.log(`DRY. ${SAFETY_CORPUS.length} fixtures — ${mustNotBeRisk().length} must-not-trip, ${riskFixtures().length} risk.`);
    console.log(`Prefilter hits (free, no model): ${SAFETY_CORPUS.filter((f) => prefilterHits(f.text)).length}`);
    console.log(`\nRun with --live (and OPENAI_API_KEY set) to measure the classifier.`);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('✗ OPENAI_API_KEY is required for --live');
    process.exitCode = 1;
    return;
  }

  const classify = makeCrisisClassifier(createOpenAIAdapter({ apiKey, fetch }));
  const rows: Row[] = [];

  for (const f of SAFETY_CORPUS) {
    const samples = f.borderline ? BORDERLINE_SAMPLES : 1;
    const verdicts = [];
    for (let i = 0; i < samples; i++) verdicts.push(await classify(f.text));

    // Majority for the headline; the rate is what actually gets read.
    const riskCount = verdicts.filter((v) => v.safety_class === 'risk').length;
    const v = riskCount > samples / 2
      ? verdicts.find((x) => x.safety_class === 'risk')!
      : verdicts.find((x) => x.safety_class !== 'risk') ?? verdicts[0];

    rows.push({
      name: f.name,
      expected: f.expected,
      actual: v.safety_class,
      reason: v.reason,
      failedClosed: verdicts.some((x) => x.failedClosed),
      prefilter: prefilterHits(f.text),
      verdict: judge(f, v.safety_class),
      borderline: f.borderline === true,
      riskRate: f.borderline ? `${riskCount}/${samples}` : undefined,
    });
    const r = rows[rows.length - 1];
    const tail = r.riskRate ? `  (risk ${r.riskRate} — sampled)` : '';
    console.log(`${r.verdict === 'pass' ? '✓' : '✗'} ${f.name.padEnd(22)} ${f.expected} → ${v.safety_class}${tail}`);
  }

  const report = formatReport(rows, label, live);
  const dir = join(import.meta.dirname, '..', 'docs', 'lamplight', 'evals', `${arg('date') ?? todayStamp()}-${label}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), report, 'utf8');
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ version: CRISIS_CLASSIFIER_VERSION, rows }, null, 2), 'utf8');

  console.log(`\n${report}`);
  console.log(`Report written to ${dir}`);

  // A false positive fails the run even at perfect recall. That ordering is
  // the whole argument of this script.
  const failures = rows.filter(
    (r) => (r.verdict === 'FALSE-POSITIVE' && !r.borderline) || r.verdict === 'MISS',
  );
  if (failures.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
