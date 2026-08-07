// scripts/refresh-passage-insights.ts
//
// Targeted regeneration of Insights Door 1 (`bible_passage_insight`).
//
// D2 is "serve stale, refresh deliberately": a reader is never blocked by a
// prompt bump, and a bump never silently re-bills the warmed corpus. This is
// the deliberate half. Nothing here runs on a schedule.
//
// Usage:
//   npx tsx scripts/refresh-passage-insights.ts                    # dry run: everything
//   npx tsx scripts/refresh-passage-insights.ts --stale            # dry run: doors behind current
//   npx tsx scripts/refresh-passage-insights.ts --stale --apply    # actually regenerate
//   npx tsx scripts/refresh-passage-insights.ts --ref=psa.27 --apply
//   npx tsx scripts/refresh-passage-insights.ts --stale --limit=5 --apply
//   npx tsx scripts/refresh-passage-insights.ts --door=deeper --stale   # Door 2
//
//   --dry-run is the DEFAULT and wins over --apply. A script that spends money
//   resolves an ambiguous invocation toward the safe reading.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      OPENAI_API_KEY, VOYAGE_AI_KEY. Service role because the table is
//      public-read / service-write.

import { createIngestClient } from './ingest-library';
import { estCostCentsPrecise, formatCents } from '../src/admin/lamplight-cost';
import { createOpenAIAdapter } from '../supabase/functions/_shared/openai';
import { verifyVerseRefs } from '../supabase/functions/_shared/verse-verify';
import { buildStudyContext } from '../supabase/functions/lamplight-study/study-context';
import { runPassageInsightPipeline } from '../supabase/functions/lamplight-study/passage-insight-pipeline';
import { insightDoorById, INSIGHT_DOORS, DEFAULT_INSIGHT_DOOR_ID } from '../supabase/functions/lamplight-study/insight-doors';
import {
  writePassageDoor,
  sourcesFromExcerpts,
  type PassageScope,
} from '../supabase/functions/lamplight-study/passage-insight-cache';

// ── Types ─────────────────────────────────────────────────────────────────

export interface DoorRow {
  scope: string;
  ref_id: string;
  section: string;
  prompt_version: string | null;
}

export interface DoorSummary {
  scope: PassageScope;
  refId: string;
  /** Every distinct version across the door's rows. A door refreshes as a unit. */
  promptVersions: Array<string | null>;
  sections: number;
}

// ── Args (pure) ───────────────────────────────────────────────────────────

export interface RefreshArgs {
  dryRun: boolean;
  staleOnly: boolean;
  /** Which door's rows to refresh. Defaults to Door 1. */
  doorId: string;
  scope?: PassageScope;
  refId?: string;
  limit?: number;
}

export function parseRefreshArgs(argv: string[]): RefreshArgs {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const scope = get('scope');
  if (scope !== undefined && scope !== 'verse' && scope !== 'chapter') {
    throw new Error(`--scope must be "verse" or "chapter" (got "${scope}")`);
  }

  const rawLimit = get('limit');
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    // A silently-dropped limit would refresh the whole corpus at full price.
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`--limit must be a positive integer (got "${rawLimit}")`);
    }
  }

  // Which door to refresh. Validated against the registry rather than passed
  // through: an unrecognised id would select zero rows and report "nothing to
  // refresh", which reads exactly like a warm corpus.
  const doorId = get('door') ?? DEFAULT_INSIGHT_DOOR_ID;
  if (!insightDoorById(doorId)) {
    throw new Error(`--door must be one of ${INSIGHT_DOORS.map((d) => d.spec.id).join(', ')} (got "${doorId}")`);
  }

  return {
    // Dry by default, and --dry-run beats --apply.
    dryRun: argv.includes('--dry-run') || !argv.includes('--apply'),
    staleOnly: argv.includes('--stale'),
    doorId,
    ...(scope ? { scope } : {}),
    ...(get('ref') ? { refId: get('ref') } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/**
 * A `ref_id` back into the passage it names, validated against its scope.
 *
 * The inverse of `parsePassageInsightBody`'s composer. Split on '.' rather than
 * a book-code pattern, because a code can carry a digit ('1jn', '2ti').
 *
 * Returns null when the key does not match its scope, so a malformed row is
 * REPORTED rather than regenerated against a passage nobody asked for.
 */
export function parseDoorRefId(
  scope: PassageScope,
  refId: string,
): { book: string; chapter: number; verse?: number } | null {
  const parts = refId.split('.');
  const want = scope === 'verse' ? 3 : 2;
  if (parts.length !== want) return null;

  const [book, rawChapter, rawVerse] = parts;
  const chapter = Number(rawChapter);
  if (!book || !Number.isInteger(chapter) || chapter < 1) return null;
  if (scope === 'chapter') return { book, chapter };

  const verse = Number(rawVerse);
  if (!Number.isInteger(verse) || verse < 1) return null;
  return { book, chapter, verse };
}

// ── Selection (pure) ──────────────────────────────────────────────────────

export function groupDoors(rows: DoorRow[]): DoorSummary[] {
  const byKey = new Map<string, DoorSummary>();
  for (const r of rows) {
    const key = `${r.scope}|${r.ref_id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sections++;
      if (!existing.promptVersions.includes(r.prompt_version)) existing.promptVersions.push(r.prompt_version);
      continue;
    }
    byKey.set(key, {
      scope: r.scope as PassageScope,
      refId: r.ref_id,
      promptVersions: [r.prompt_version],
      sections: 1,
    });
  }
  return [...byKey.values()];
}

export function selectDoorsToRefresh(
  rows: DoorRow[],
  opts: { currentVersion: string; staleOnly: boolean; scope?: PassageScope; refId?: string; limit?: number },
): DoorSummary[] {
  let doors = groupDoors(rows);
  if (opts.scope) doors = doors.filter((d) => d.scope === opts.scope);
  if (opts.refId) doors = doors.filter((d) => d.refId === opts.refId);
  if (opts.staleOnly) {
    // A door refreshes as a UNIT, so one stale section makes the door stale.
    // A null version predates the stamping and is stale by definition.
    doors = doors.filter((d) => d.promptVersions.some((v) => v !== opts.currentVersion));
  }
  return opts.limit === undefined ? doors : doors.slice(0, opts.limit);
}

// ── Cost (pure) ───────────────────────────────────────────────────────────

/** The tier Door 1 generates on. Must match `passage-insight-pipeline.ts`. */
const REFRESH_MODEL = 'gpt-5.6-sol';

/**
 * Per-door token means, **measured** rather than assumed: 11,870 in / 3,708 out
 * across the three doors of `docs/lamplight/evals/2026-08-06-b2-passage-door`.
 * Same discipline as `CHARS_PER_WORD` in the prompt module — an estimate nobody
 * measured is an estimate nobody should act on.
 */
export const MEASURED_TOKENS_PER_DOOR = { in: Math.round(11870 / 3), out: Math.round(3708 / 3) };

export function estimateRefreshCents(doorCount: number): number {
  return estCostCentsPrecise(
    REFRESH_MODEL,
    MEASURED_TOKENS_PER_DOOR.in * doorCount,
    MEASURED_TOKENS_PER_DOOR.out * doorCount,
  );
}

// ── Reporting (pure) ──────────────────────────────────────────────────────

export function formatRefreshPlan(
  doors: DoorSummary[],
  opts: { dryRun: boolean; currentVersion: string },
): string {
  if (doors.length === 0) {
    return `Nothing to refresh (current prompt version: ${opts.currentVersion}).`;
  }

  const lines = [
    `${doors.length} door${doors.length === 1 ? '' : 's'} · est. ${formatCents(estimateRefreshCents(doors.length))} · current prompt ${opts.currentVersion}`,
    '',
    ...doors.map((d) => {
      const versions = d.promptVersions.map((v) => v ?? '(unstamped)').join(', ');
      const partial = d.sections === 4 ? '' : `  ⚠ ${d.sections}/4 sections`;
      return `  ${d.scope.padEnd(7)} ${d.refId.padEnd(14)} ${versions}${partial}`;
    }),
    '',
  ];

  lines.push(
    opts.dryRun
      ? 'Dry run — nothing was written and no model was called. Re-run with --apply to regenerate.'
      : 'Applying: each door is regenerated and upserted as a unit.',
  );
  return lines.join('\n');
}

// ── I/O ───────────────────────────────────────────────────────────────────

const CROSSREF_K = 5;
const NOTE_K = 4;
// libraryK and any register filter are PER DOOR — see insight-doors.ts.
const TRANSLATION = 'BSB';

function requiredEnv(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v) return v;
  }
  throw new Error(`${name} is required`);
}

async function main(): Promise<void> {
  const args = parseRefreshArgs(process.argv.slice(2));
  // Validated in parseRefreshArgs, so this cannot be null.
  const doorEntry = insightDoorById(args.doorId)!;
  // Per door: Door 1 and Door 2 version independently, so "stale" means stale
  // against THIS door's current prompt, never the other's.
  const currentVersion = doorEntry.spec.prompt.promptVersion;

  const supabaseUrl = requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  // createIngestClient, not createClient: supabase-js builds a RealtimeClient at
  // construction and Node 20 has no global WebSocket, so a bare createClient
  // throws before the first query. Every other ingest script needed this too.
  const supabase = createIngestClient(supabaseUrl, serviceKey);

  const { data, error } = await supabase
    .from('bible_passage_insight')
    .select('scope, ref_id, section, prompt_version')
    .eq('door', doorEntry.spec.id);
  if (error) throw new Error(`read failed: ${error.message}`);

  const doors = selectDoorsToRefresh((data ?? []) as DoorRow[], { currentVersion, ...args });
  console.log(formatRefreshPlan(doors, { dryRun: args.dryRun, currentVersion }));

  if (args.dryRun || doors.length === 0) return;

  const openaiKey = requiredEnv('OPENAI_API_KEY');
  const voyageKey = requiredEnv('VOYAGE_AI_KEY');
  const llm = createOpenAIAdapter({ apiKey: openaiKey, fetch });
  const voyageDeps = { apiKey: voyageKey, fetch };

  let refreshed = 0;
  let spentCents = 0;
  for (const door of doors) {
    const passage = parseDoorRefId(door.scope, door.refId);
    if (!passage) {
      console.log(`  ✗ ${door.refId} — malformed ref_id for scope "${door.scope}"; skipped`);
      continue;
    }
    process.stdout.write(`  ${door.refId.padEnd(14)} `);

    const { data: chRows } = await supabase
      .from('bible_passages').select('text')
      .like('id', `${passage.book}.${passage.chapter}.%`)
      .order('verse_start', { ascending: true }).limit(20);
    const retrievalQuery =
      ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500)
      || `${passage.book} ${passage.chapter}`;

    const { ctx } = await buildStudyContext(supabase as never, {
      userId: 'refresh-script',
      book: passage.book,
      chapter: passage.chapter,
      passageRef: door.refId,
      message: '',
      retrievalQuery,
      history: [],
      includeNotes: false,
      voyageDeps,
      rerankEnabled: false,
      crossRefK: CROSSREF_K,
      noteK: NOTE_K,
      translation: TRANSLATION,
      libraryK: doorEntry.retrieval.libraryK,
      ...(doorEntry.retrieval.registers ? { registers: [...doorEntry.retrieval.registers] } : {}),
      // Must match the edge function, or a refreshed door reads differently
      // from a freshly generated one.
      displayRefs: true,
      ...(passage.verse !== undefined ? { verse: passage.verse } : {}),
    });

    const result = await runPassageInsightPipeline({
      llm,
      ctx,
      door: doorEntry.spec,
      verifyScripture: {
        translation: TRANSLATION,
        verifyRefs: (refs, t) => verifyVerseRefs(supabase as never, refs, t),
      },
    });

    // NO usage row is written, deliberately. `lamplight_usage.user_id` is
    // `not null references profiles(id)` and a maintenance sweep has no user;
    // `recordLamplightUsage` swallows insert errors, so a null would vanish
    // silently, and a fabricated id would corrupt the dashboard's per-user cost
    // attribution. The spend is reported to the operator who ran it instead —
    // see the total below. (Consequence worth knowing: a refresh does not count
    // against the global daily ceiling either.)
    if (result.usage) {
      spentCents += estCostCentsPrecise(result.usage.model, result.usage.tokens_in, result.usage.tokens_out);
    }

    if (!result.ok) {
      // The stale door stays. A failed refresh must never blank a door a reader
      // could still be served.
      console.log(`✗ ${result.reason}`);
      continue;
    }

    const write = await writePassageDoor(supabase as never, {
      scope: door.scope,
      refId: door.refId,
      door: doorEntry.spec,
      sections: result.sections,
      sources: sourcesFromExcerpts(ctx.libraryExcerpts),
      modelUsed: result.modelUsed,
      promptVersion: result.promptVersion,
      createdBy: null,
    });

    if (!write.written) { console.log(`✗ ${write.reason}`); continue; }
    refreshed++;
    console.log('✓');
  }

  console.log(`\nRefreshed ${refreshed}/${doors.length} door(s) · spent ${formatCents(spentCents)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
