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
} from './library-adapters/commentary';

// ── Source registry ───────────────────────────────────────────────────────
export const ADAPTERS: Record<string, LibraryAdapter> = {
  [TREASURY_OF_DAVID.sourceId]: TREASURY_OF_DAVID,
  [MATTHEW_HENRY_CONCISE.sourceId]: MATTHEW_HENRY_CONCISE,
  [JAMIESON_FAUSSET_BROWN.sourceId]: JAMIESON_FAUSSET_BROWN,
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
  fetchUnembedded(sourceId: string | undefined): Promise<Array<{ id: string; content: string }>>;
  writeEmbeddings(rows: Array<{ id: string; embedding: number[] }>): Promise<void>;
  log(msg: string): void;
}

const CHUNK_UPSERT_SLICE = 200;
const EMBED_BATCH = 64;
const EMBED_UPSERT_SLICE = 16;

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

  // Embedding pass. Voyage batches at EMBED_BATCH; writes go in smaller slices
  // because HNSW index maintenance is O(M·log N) per row and a large upsert can
  // exceed the statement timeout (same reasoning as ingest-bsb.ts).
  const pending = await deps.fetchUnembedded(args.embedOnly ? args.sourceId : args.sourceId);
  deps.log(`${pending.length} chunks need embedding`);

  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    // voyage-context-3 takes each document as an array of chunks; ours are
    // single-chunk documents, so unwrap vectors[idx][0] on the way back.
    const { vectors } = await embedDocuments(
      batch.map((r) => [r.content]),
      { apiKey: requiredEnv('VOYAGE_AI_KEY'), fetch },
    );
    const embedded = batch.map((r, idx) => ({ id: r.id, embedding: vectors[idx][0] }));
    for (let j = 0; j < embedded.length; j += EMBED_UPSERT_SLICE) {
      await deps.writeEmbeddings(embedded.slice(j, j + EMBED_UPSERT_SLICE));
    }
    report.embedded += batch.length;
    deps.log(`embedded ${report.embedded}/${pending.length}`);
  }

  return report;
}

// ── Real wiring ───────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function makeDeps(supabase: SupabaseClient): IngestDeps {
  return {
    readFile: (path) => readFileSync(path, 'utf8'),
    log: (msg) => console.log(msg),
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
    fetchUnembedded: async (sourceId) => {
      let q = supabase.from('library_chunks').select('id, content').is('embedding', null);
      if (sourceId) q = q.eq('source_id', sourceId);
      const { data, error } = await q;
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
    : createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

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
