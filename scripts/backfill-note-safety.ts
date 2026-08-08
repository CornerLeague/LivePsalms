// scripts/backfill-note-safety.ts
//
// Classifies every note that has no `note_distillates` row yet.
//
//   npx tsx scripts/backfill-note-safety.ts                 # dry run — counts + cost, writes nothing
//   npx tsx scripts/backfill-note-safety.ts --apply         # classify and write
//   npx tsx scripts/backfill-note-safety.ts --apply --limit=200
//   npx tsx scripts/backfill-note-safety.ts --verify        # is anything still unclassified?
//
// ⚠️ THIS MUST FINISH BEFORE THE GATE TURNS ON.
//
// Unclassified fails closed, and every note that exists today is unclassified.
// So the moment `fetchNoteSafety` is wired into the three gate sites, every
// existing user's note context empties at once: Today's Lamp and Waymarks
// short-circuit to `no_notes`, and study chat loses its note channel. Silently,
// and for everyone.
//
// That is not an argument for failing open. It is a sequencing constraint:
//   1. the gate ships dark (the deps are optional, and unset — done)
//   2. this runs to completion, and `--verify` reports zero remaining
//   3. only then are the deps wired
//
// It is the one step in slice 2a whose reversal is visible to every user
// simultaneously.
//
// House conventions, same as the ingest scripts: DRY BY DEFAULT, `--dry-run`
// beats `--apply`, `--limit` is validated rather than coerced (a silently
// dropped limit would classify the whole corpus at full price), and the run
// reports what it will spend before spending it.
import { createIngestClient } from './ingest-library';
import { createOpenAIAdapter } from '../supabase/functions/_shared/openai';
import { makeCrisisClassifier, CRISIS_CLASSIFIER_VERSION } from '../supabase/functions/_shared/crisis-classifier';
import { prefilterHits } from '../supabase/functions/_shared/crisis-terms';
import { extractTextFromNoteContent } from '../supabase/functions/_shared/tiptap-text';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Measured against the eval corpus: a short prompt, a 256-token ceiling. */
const EST_COST_PER_NOTE_USD = 0.0004;

/** PostgREST caps a response at ~1000 rows. Paging is not optional — the 1b
 *  embedding pass silently embedded 1000 of 34,076 chunks by forgetting it. */
const PAGE = 500;

interface NoteRow { id: string; user_id: string; content: string }

function loadDotEnvLocal(): void {
  let raw: string;
  try { raw = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

/**
 * Notes with no distillate row, paged.
 *
 * A left-join-is-null in PostgREST is awkward, so this pages the note ids and
 * the classified ids separately and differences them. At this corpus size that
 * is cheap and obviously correct; if it ever stops being either, it wants a
 * view or an RPC rather than a cleverer query here.
 */
async function findUnclassified(
  supabase: ReturnType<typeof createIngestClient>,
  limit: number | null,
): Promise<NoteRow[]> {
  const classified = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('note_distillates').select('note_id').range(from, from + PAGE - 1);
    if (error) throw new Error(`reading note_distillates: ${error.message}`);
    const rows = (data ?? []) as Array<{ note_id: string }>;
    for (const r of rows) classified.add(r.note_id);
    if (rows.length < PAGE) break;
  }

  const out: NoteRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('notes').select('id, user_id, content').order('created_at').range(from, from + PAGE - 1);
    if (error) throw new Error(`reading notes: ${error.message}`);
    const rows = (data ?? []) as NoteRow[];
    for (const r of rows) {
      if (!classified.has(r.id)) out.push(r);
      if (limit && out.length >= limit) return out;
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const argv = process.argv;
  // Dry by default, and --dry-run beats --apply. A script that spends money
  // resolves an ambiguous invocation toward the safe reading.
  const dryRun = argv.includes('--dry-run') || !argv.includes('--apply');
  const verifyOnly = argv.includes('--verify');

  const rawLimit = arg('limit');
  let limit: number | null = null;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`--limit must be a positive integer (got "${rawLimit}")`);
    }
  }

  const supabase = createIngestClient(
    requiredEnv('VITE_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );

  const pending = await findUnclassified(supabase, verifyOnly ? null : limit);

  if (verifyOnly) {
    console.log(pending.length === 0
      ? '✓ Zero unclassified notes. The gate is safe to turn on.'
      : `✗ ${pending.length} note(s) still unclassified. DO NOT turn the gate on — every one of these would be withheld from every AI surface.`);
    if (pending.length > 0) process.exitCode = 1;
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to backfill — every note already has a distillate row.');
    return;
  }

  const est = (pending.length * EST_COST_PER_NOTE_USD).toFixed(2);
  console.log(`${pending.length} unclassified note(s). Estimated cost: ~$${est}.`);

  if (dryRun) {
    console.log('\nDry run — nothing was written and no model was called.');
    console.log('Re-run with --apply to classify. Then --verify before wiring the gate.');
    return;
  }

  const classify = makeCrisisClassifier(
    createOpenAIAdapter({ apiKey: requiredEnv('OPENAI_API_KEY'), fetch }),
  );

  const tally: Record<string, number> = { ok: 0, lament: 0, risk: 0, deferred: 0 };
  let done = 0;

  for (const note of pending) {
    const plaintext = extractTextFromNoteContent(note.content);
    const verdict = plaintext.trim()
      ? await classify(plaintext)
      : { safety_class: 'ok' as const, reason: 'empty', classifier_version: 'empty', failedClosed: false };

    // Never persist a fail-closed verdict. It means the model could not answer,
    // not that the entry is risky — writing it would permanently withhold an
    // ordinary note and inflate the risk rate. Left unclassified (already the
    // safe state) for the next run to pick up; --verify will still report it.
    if (verdict.failedClosed) {
      tally.deferred += 1;
      continue;
    }

    const { error } = await supabase.from('note_distillates').upsert({
      note_id: note.id,
      user_id: note.user_id,
      safety_class: verdict.safety_class,
      classified_at: new Date().toISOString(),
      classifier_version: verdict.classifier_version,
      prefilter_hit: prefilterHits(plaintext),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'note_id' });
    if (error) throw new Error(`writing note_distillates for ${note.id}: ${error.message}`);

    tally[verdict.safety_class] += 1;
    if (++done % 50 === 0) console.log(`  …${done}/${pending.length}`);
  }

  const classifiedCount = tally.ok + tally.lament + tally.risk;
  console.log(`\nClassified ${classifiedCount} note(s).`);
  console.log(`  ok     ${tally.ok}`);
  console.log(`  lament ${tally.lament}`);
  console.log(`  risk   ${tally.risk}`);
  if (tally.deferred) {
    console.log(`  deferred ${tally.deferred} (classifier unavailable — re-run to pick them up)`);
  }

  // ⚠️ The number this whole slice exists to watch. The app is built for people
  // writing their worst days, so a lament rate near zero means the classifier
  // is not seeing what it should, and a risk rate that looks high probably
  // means it is firing on lament — the failure that looks like success.
  if (classifiedCount > 0) {
    const pct = (n: number) => `${((n / classifiedCount) * 100).toFixed(1)}%`;
    console.log(`\nRates — lament ${pct(tally.lament)}, risk ${pct(tally.risk)}.`);
    console.log(`Classifier: ${CRISIS_CLASSIFIER_VERSION}`);
    console.log('\nRun --verify before wiring the gate.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
