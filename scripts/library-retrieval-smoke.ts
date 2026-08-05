// scripts/library-retrieval-smoke.ts
//
// Acceptance check for the library ingest: proves the corpus is actually
// REACHABLE, not merely present. Counts confirm rows exist; only a real query
// through match_library_chunks confirms the embeddings landed in a usable space
// and the RPC works — which is what slice 1c will depend on.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_AI_KEY=... \
//     npx tsx scripts/library-retrieval-smoke.ts
//     npx tsx scripts/library-retrieval-smoke.ts --query="waiting on God in fear" --k=5
//
// Costs one Voyage query embedding (fractions of a cent). Read-only.

import { createIngestClient } from './ingest-library';
import { embedQuery } from '../supabase/functions/_shared/voyage';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const DEFAULT_QUERY = 'waiting on the Lord in a season of fear';

interface MatchRow {
  id: string; source_id: string; heading: string; content: string;
  similarity: number; book: string | null; chapter: number | null;
}

async function main() {
  const query = arg('query') ?? DEFAULT_QUERY;
  const k = Number(arg('k') ?? 5);
  const registers = arg('registers')?.split(',');

  const supabase = createIngestClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );

  console.log(`\nquery: "${query}"${registers ? ` · registers: ${registers.join(',')}` : ''}\n`);

  const vector = await embedQuery(query, { apiKey: requiredEnv('VOYAGE_AI_KEY'), fetch });

  const { data, error } = await supabase.rpc('match_library_chunks', {
    p_query_vector: `[${vector.join(',')}]`,
    p_limit: k,
    p_registers: registers ?? null,
  });
  if (error) throw new Error(`match_library_chunks: ${error.message}`);

  const rows = (data ?? []) as MatchRow[];
  if (rows.length === 0) {
    console.error('NO RESULTS — the corpus is present but not reachable. Check that');
    console.error('embeddings are non-null and the RPC exists (migration 058).');
    process.exit(1);
  }

  rows.forEach((r, i) => {
    const anchor = r.book ? `${r.book} ${r.chapter}` : '(unanchored)';
    console.log(`${i + 1}. [${r.similarity.toFixed(3)}] ${r.source_id} · ${r.heading} · ${anchor}`);
    console.log(`   ${r.content.replace(/\s+/g, ' ').slice(0, 160)}…\n`);
  });

  const sources = new Set(rows.map((r) => r.source_id));
  console.log(`${rows.length} results from ${sources.size} source(s): ${[...sources].join(', ')}`);
}

main().catch((err) => {
  console.error('smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
