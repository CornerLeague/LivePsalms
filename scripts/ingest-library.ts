// scripts/ingest-library.ts
//
// Idempotent loader for the Lamplight grounding corpus (migration 058).
// One driver, one adapter per source; adapters are pure (see
// scripts/library-adapters/types.ts) so all the parsing logic is unit-tested and
// this file owns only I/O and batching.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_AI_KEY=... \
//     npx tsx scripts/ingest-library.ts --source=treasury-of-david --file=path/to/dump.jsonl
//
//   --dry-run     parse + report counts, touch nothing (no DB, no Voyage)
//   --embed-only  skip parsing; embed rows already present with embedding is null
//
// Re-running is safe: chunks upsert on library_chunks_ident
// (source_id, heading, book, chapter, verse_start) and sources upsert on id.
// See docs/runbooks/library-ingest.md for per-source acquisition + license trail.

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { embedDocuments } from '../supabase/functions/_shared/voyage';
import type { LibraryAdapter, LibraryChunkRow } from './library-adapters/types';
import {
  TREASURY_OF_DAVID, MATTHEW_HENRY_CONCISE, JAMIESON_FAUSSET_BROWN,
  WESLEY_NOTES, ADAM_CLARKE, CALVIN_COMMENTARIES, CATENA_AUREA, GENEVA_NOTES,
} from './library-adapters/commentary';

// ── Source registry ───────────────────────────────────────────────────────
export const ADAPTERS: Record<string, LibraryAdapter> = {
  [TREASURY_OF_DAVID.sourceId]: TREASURY_OF_DAVID,
  [MATTHEW_HENRY_CONCISE.sourceId]: MATTHEW_HENRY_CONCISE,
  [JAMIESON_FAUSSET_BROWN.sourceId]: JAMIESON_FAUSSET_BROWN,
  // Phase A1 — tradition-broadening public-domain sources.
  [WESLEY_NOTES.sourceId]: WESLEY_NOTES,
  [ADAM_CLARKE.sourceId]: ADAM_CLARKE,
  [CALVIN_COMMENTARIES.sourceId]: CALVIN_COMMENTARIES,
  [CATENA_AUREA.sourceId]: CATENA_AUREA,
  [GENEVA_NOTES.sourceId]: GENEVA_NOTES,
};

export function resolveAdapter(sourceId: string): LibraryAdapter {
  const adapter = ADAPTERS[sourceId];
  if (!adapter) {
    throw new Error(
      `unknown source "${sourceId}". Known: ${Object.keys(ADAPTERS).sort().join(', ')}`,
    );
  }
  return adapter;
}

// ── Arg parsing (pure) ────────────────────────────────────────────────────
export interface IngestArgs {
  sourceId?: string;
  file?: string;
  dryRun: boolean;
  embedOnly: boolean;
}

export function parseArgs(argv: string[]): IngestArgs {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  return {
    sourceId: get('source'),
    file: get('file'),
    dryRun: argv.includes('--dry-run'),
    embedOnly: argv.includes('--embed-only'),
  };
}

// ── Deps seam (so the orchestration is testable without Supabase/Voyage) ──
export interface IngestDeps {
  readFile(path: string): string;
  upsertSource(row: LibraryAdapter['source']): Promise<void>;
  upsertChunks(rows: LibraryChunkRow[]): Promise<void>;
  /**
   * The next `limit` chunks still missing an embedding. MUST be limited:
   * PostgREST caps a single response at ~1000 rows, so an unlimited select
   * silently returns only the first 1000 and the pass looks complete when it is
   * not (see backfill-note-embeddings.ts, which pages for the same reason).
   */
  fetchUnembedded(sourceId: string | undefined, limit: number): Promise<Array<{ id: string; content: string }>>;
  writeEmbeddings(rows: Array<{ id: string; embedding: number[] }>): Promise<void>;
  /** One vector per input text. Injected so the pass is testable without Voyage. */
  embed(texts: string[]): Promise<number[][]>;
  log(msg: string): void;
}

const CHUNK_UPSERT_SLICE = 200;
const EMBED_BATCH = 64;
const EMBED_UPSERT_SLICE = 16;
// Well under PostgREST's ~1000-row response cap, matching the paging size
// backfill-note-embeddings.ts settled on.
const EMBED_PAGE = 500;

export interface IngestReport {
  sourceId?: string;
  parsed: number;
  upserted: number;
  embedded: number;
  dryRun: boolean;
}

/**
 * The orchestration, deps-injected. Ordering matters: the source row must exist
 * before its chunks (FK), and embedding runs last so a re-run after a failed
 * embed pass does not re-parse.
 */
export async function runIngest(deps: IngestDeps, args: IngestArgs): Promise<IngestReport> {
  const report: IngestReport = {
    sourceId: args.sourceId, parsed: 0, upserted: 0, embedded: 0, dryRun: args.dryRun,
  };

  if (!args.embedOnly) {
    if (!args.sourceId) throw new Error('--source is required (or pass --embed-only)');
    if (!args.file) throw new Error('--file is required (or pass --embed-only)');
    const adapter = resolveAdapter(args.sourceId);

    const raw = deps.readFile(args.file);
    const rows = adapter.parse(raw);
    report.parsed = rows.length;
    deps.log(`parsed ${rows.length} chunks from ${args.file}`);

    if (args.dryRun) {
      deps.log('dry run — nothing written');
      return report;
    }

    await deps.upsertSource(adapter.source);
    for (let i = 0; i < rows.length; i += CHUNK_UPSERT_SLICE) {
      const slice = rows.slice(i, i + CHUNK_UPSERT_SLICE);
      await deps.upsertChunks(slice);
      report.upserted += slice.length;
    }
    deps.log(`upserted ${report.upserted} chunks`);
  }

  if (args.dryRun) return report;

  // Embedding pass. Paged: each fetch asks for the next EMBED_PAGE chunks that
  // still have a null embedding, and writing embeddings removes them from that
  // set — so re-fetching the "first page" walks the whole backlog and
  // terminates naturally, without offsets that would shift under us.
  //
  // Voyage batches at EMBED_BATCH; writes go in smaller slices because HNSW
  // index maintenance is O(M·log N) per row and a large upsert can exceed the
  // statement timeout (same reasoning as ingest-bsb.ts).
  for (;;) {
    const pending = await deps.fetchUnembedded(args.sourceId, EMBED_PAGE);
    if (pending.length === 0) break;

    const before = report.embedded;
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await deps.embed(batch.map((r) => r.content));
      const embedded = batch.map((r, idx) => ({ id: r.id, embedding: vectors[idx] }));
      for (let j = 0; j < embedded.length; j += EMBED_UPSERT_SLICE) {
        await deps.writeEmbeddings(embedded.slice(j, j + EMBED_UPSERT_SLICE));
      }
      report.embedded += batch.length;
      deps.log(`embedded ${report.embedded}`);
    }

    // Guard against an infinite loop if writes silently stop taking effect.
    if (report.embedded === before) {
      throw new Error('embedding pass made no progress; aborting to avoid a loop');
    }
  }

  return report;
}

// ── Real wiring ───────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

/**
 * supabase-js builds a Realtime client during createClient, and on Node < 22
 * (no native WebSocket) that construction throws. This script only ever issues
 * REST calls, so we hand Realtime a transport that would throw IF it were used —
 * it never is, because nothing here opens a channel. Avoids both a `ws`
 * dependency and making the operator remember `--experimental-websocket`.
 */
class UnusedRealtimeTransport {
  constructor() {
    throw new Error('ingest-library does not use Supabase Realtime');
  }
}

export function createIngestClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: UnusedRealtimeTransport as never },
  });
}

function makeDeps(supabase: SupabaseClient): IngestDeps {
  return {
    readFile: (path) => readFileSync(path, 'utf8'),
    log: (msg) => console.log(msg),
    // voyage-context-3 takes each document as an ARRAY of chunks; ours are
    // single-chunk documents, so wrap on the way in and unwrap on the way out.
    embed: async (texts) => {
      const { vectors } = await embedDocuments(
        texts.map((t) => [t]),
        { apiKey: requiredEnv('VOYAGE_AI_KEY'), fetch },
      );
      return vectors.map((v) => v[0]);
    },
    upsertSource: async (row) => {
      const { error } = await supabase.from('library_sources').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(`upsertSource: ${error.message}`);
    },
    upsertChunks: async (rows) => {
      const { error } = await supabase.from('library_chunks').upsert(rows, {
        onConflict: 'source_id,heading,book,chapter,verse_start',
      });
      if (error) throw new Error(`upsertChunks: ${error.message}`);
    },
    fetchUnembedded: async (sourceId, limit) => {
      let q = supabase.from('library_chunks').select('id, content').is('embedding', null);
      if (sourceId) q = q.eq('source_id', sourceId);
      const { data, error } = await q.limit(limit);
      if (error) throw new Error(`fetchUnembedded: ${error.message}`);
      return (data ?? []) as Array<{ id: string; content: string }>;
    },
    writeEmbeddings: async (rows) => {
      for (const r of rows) {
        const { error } = await supabase
          .from('library_chunks')
          .update({ embedding: `[${r.embedding.join(',')}]` })
          .eq('id', r.id);
        if (error) throw new Error(`writeEmbeddings: ${error.message}`);
      }
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabase = args.dryRun
    ? (null as unknown as SupabaseClient)
    : createIngestClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

  const deps = args.dryRun
    ? { ...makeDeps({} as SupabaseClient), readFile: (p: string) => readFileSync(p, 'utf8') }
    : makeDeps(supabase);

  const report = await runIngest(deps, args);
  console.log('\n' + JSON.stringify(report, null, 2));
}

// Only run main() when invoked directly, so the module stays importable by tests.
if (process.argv[1] && process.argv[1].endsWith('ingest-library.ts')) {
  main().catch((err) => {
    console.error('ingest failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
