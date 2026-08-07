// Insights Door 1 — the cache read/write.
//
// The door is a PUBLIC asset: the historical setting of Psalm 27 is the same
// for every reader, so it is generated once and served to everyone from
// `bible_passage_insight` (migration 060). Reads are free and unauthenticated —
// same contract as `bible_etymology_verse_insight`; the entitlement gate lives
// in the edge function, on the generate path only.
//
// Takes a SupabaseClient rather than injected callbacks, so the whole module is
// exercised by a chainable fake without the SSE shell around it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InsightDoorSpec } from './prompts/insight-door.ts';
import type { PassageInsightSections } from './passage-insight-pipeline.ts';
import type { LibraryExcerpt } from '../_shared/library-retrieval.ts';

const TABLE = 'bible_passage_insight';

// The door is REQUIRED on both paths, with no default — unlike the pipeline,
// which defaults to Door 1.
//
// The asymmetry is deliberate. A pipeline called with the wrong door returns
// prose nobody keeps; a cache called with the wrong door WRITES it, under
// another door's key, into a table every reader is served from. Defaults are
// fine where the output is transient and not where it is persisted.

export type PassageScope = 'verse' | 'chapter';

/**
 * Which library excerpts informed a door, SNAPSHOTTED rather than referenced:
 * a re-ingest rotates chunk ids, and the door must still be able to say which
 * voice it leaned on. Same shape and same reasoning as
 * `lamplight_artifacts.source_library_chunks`.
 */
export interface PassageInsightSource {
  chunk_id: string;
  source_id: string;
  heading: string;
}

export interface PassageDoorCache {
  /** Every declared section, in reading order. A section with no warrant is ''. */
  sections: PassageInsightSections;
  sources: PassageInsightSource[];
  modelUsed: string | null;
  promptVersion: string | null;
  createdAt: string | null;
}

interface PassageInsightRow {
  section: string;
  body: string;
  sources: PassageInsightSource[] | null;
  model_used: string | null;
  prompt_version: string | null;
  created_at: string | null;
}

export function sourcesFromExcerpts(excerpts?: LibraryExcerpt[]): PassageInsightSource[] {
  return (excerpts ?? []).map((e) => ({ chunk_id: e.chunkId, source_id: e.sourceId, heading: e.heading }));
}

/**
 * The whole door in one query.
 *
 * D2 — serve stale, refresh deliberately: rows come back regardless of
 * `prompt_version`. A reader is never blocked by a prompt bump, and a bump
 * never silently re-bills the warmed corpus. `scripts/refresh-passage-insights.ts`
 * is what acts on staleness, on purpose.
 *
 * `null` means the door has never been generated — deliberately distinguishable
 * from a door that WAS generated and whose sections are all legitimately empty,
 * which comes back as a real cache entry with four empty strings.
 */
export async function readPassageDoor(
  supabase: SupabaseClient,
  args: { scope: PassageScope; refId: string; door: InsightDoorSpec },
): Promise<PassageDoorCache | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('section, body, sources, model_used, prompt_version, created_at')
    .eq('scope', args.scope)
    .eq('ref_id', args.refId)
    .eq('door', args.door.id);

  // Throw rather than report an uncached door: returning null on a transport
  // failure would send the reader down the generate path and re-bill a door
  // that is already warm.
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PassageInsightRow[];
  if (rows.length === 0) return null;

  const bySection = new Map(rows.map((r) => [r.section, r]));
  const sections: PassageInsightSections = {};
  for (const s of args.door.sections) {
    sections[s.key] = bySection.get(s.key)?.body ?? '';
  }

  // Door-level columns are written identically across the door's rows, so the
  // first row is authoritative for all of them.
  const first = rows[0];
  return {
    sections,
    sources: first.sources ?? [],
    modelUsed: first.model_used,
    promptVersion: first.prompt_version,
    createdAt: first.created_at,
  };
}

export type PassageDoorWriteResult =
  | { written: true }
  | { written: false; reason: 'empty_door' };

/**
 * Write the whole door, or none of it.
 *
 * ONE multi-row upsert, not four single-row ones: a single statement cannot
 * half-land, so an interrupted write leaves the door uncached rather than
 * two-quarters cached forever.
 *
 * Refuses a door whose every section is empty. Per-section omission is
 * first-class and writes fine — but a door with nothing in it would cache
 * nothing, permanently, for every reader after the one who generated it. The
 * pipeline has no business deciding what is worth caching; this does.
 */
export async function writePassageDoor(
  supabase: SupabaseClient,
  args: {
    scope: PassageScope;
    refId: string;
    door: InsightDoorSpec;
    sections: PassageInsightSections;
    sources?: PassageInsightSource[];
    modelUsed: string;
    promptVersion: string;
    createdBy: string | null;
  },
): Promise<PassageDoorWriteResult> {
  const bodyOf = (key: string) => args.sections[key] ?? '';
  const hasContent = args.door.sections.some((s) => bodyOf(s.key).trim().length > 0);
  if (!hasContent) return { written: false, reason: 'empty_door' };

  const sources = args.sources ?? [];
  const rows = args.door.sections.map((s) => ({
    scope: args.scope,
    ref_id: args.refId,
    door: args.door.id,
    section: s.key,
    body: bodyOf(s.key),
    sources,
    model_used: args.modelUsed,
    prompt_version: args.promptVersion,
    created_by: args.createdBy,
  }));

  // Matches the primary key as widened by migration 061 — `door` is IN the key
  // now, so two doors on the same passage no longer share a row. Postgres
  // requires the conflict target to match a real unique constraint, so if this
  // and the migration ever disagree the write fails loudly rather than landing
  // somewhere unintended.
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'scope,ref_id,door,section' });
  // Throw rather than return a failure the caller might report as written: the
  // terminal `done` beat tells the client the door is cached, and it must not
  // say so about rows that never landed.
  if (error) throw new Error(error.message);

  return { written: true };
}
