// scripts/library-fusion-smoke.ts
//
// Slice-1c acceptance check. Where library-retrieval-smoke.ts proves the RPC
// answers, this drives the ACTUAL retrieval path the edge functions use —
// makeLibraryDeps + searchLibrary (two channels, RRF fusion, register filter)
// and fetchLexiconEntries — against the live corpus. If this passes, study
// chat and Today's Lamp will see the same excerpts.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_AI_KEY=... \
//     npx tsx scripts/library-fusion-smoke.ts
//     npx tsx scripts/library-fusion-smoke.ts --book=psa --chapter=27 --query="..."
//     npx tsx scripts/library-fusion-smoke.ts --book=hab --chapter=3   # thin-coverage case
//
// Costs one Voyage query embedding per query (fractions of a cent). Read-only.

import { createIngestClient } from './ingest-library';
import { embedQuery } from '../supabase/functions/_shared/voyage';
import {
  makeLibraryDeps,
  searchLibrary,
  fetchLexiconEntries,
} from '../supabase/functions/_shared/library-retrieval';
import { normalizeStrongs } from '../supabase/functions/_shared/strongs-key';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// A spread of questions, so the run says something about coverage rather than
// about one lucky query. The last two probe Matthew Henry Concise, which did
// not place in the 1b baseline (runbook §6b watch item): MHCC summarises
// passage blocks, so block-level questions are where it should appear.
const QUERIES = [
  'what does it mean to dwell in the house of the LORD',
  'waiting on the Lord in a season of fear',
  'why is the psalmist confident when enemies encamp',
  'what is the overall argument of this psalm',
];

async function main() {
  const book = arg('book') ?? 'psa';
  const chapter = Number(arg('chapter') ?? 27);
  const queries = arg('query') ? [arg('query')!] : QUERIES;

  const supabase = createIngestClient(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
  const voyage = { apiKey: requiredEnv('VOYAGE_AI_KEY'), fetch };
  const deps = makeLibraryDeps(supabase, voyage);

  console.log(`\nanchor: ${book} ${chapter} (whole chapter)\n${'─'.repeat(72)}`);

  const sourcesSeen = new Set<string>();

  for (const query of queries) {
    const queryEmbedding = await embedQuery(query, voyage);

    // Study chat: k=4, no register filter.
    const study = await searchLibrary(deps, {
      refs: [{ book, chapter }],
      queryEmbedding, query, k: 4, rerankEnabled: false,
    });
    console.log(`\nSTUDY  "${query}"`);
    if (study.length === 0) console.log('  (nothing — the turn proceeds on chapter grounding)');
    study.forEach((e, i) => {
      sourcesSeen.add(e.sourceId);
      console.log(`  ${i + 1}. [${e.score.toFixed(4)}] ${e.sourceLabel} · ${e.heading}`);
      console.log(`     ${e.content.replace(/\s+/g, ' ').slice(0, 150)}…`);
    });

    // Today's Lamp: k=2, devotional register only.
    const devotion = await searchLibrary(deps, {
      refs: [{ book, chapter }],
      queryEmbedding, query, k: 2, registers: ['devotional'], rerankEnabled: false,
    });
    const offRegister = devotion.filter((e) => e.sourceId === 'jfb');
    console.log(`  devotional-only (k=2): ${devotion.map((e) => e.sourceId).join(', ') || '(none)'}` +
      (offRegister.length ? '  ← LEAK: exegetical source in a devotional-only query' : ''));

    // Registers with no adapter yet must return nothing, not throw.
    const empty = await searchLibrary(deps, {
      refs: [{ book, chapter }],
      queryEmbedding, query, k: 2, registers: ['confessional', 'topical'], rerankEnabled: false,
    });
    if (empty.length !== 0) console.log(`  UNEXPECTED: confessional/topical returned ${empty.length}`);
  }

  // Lexicon block.
  const lexicon = await fetchLexiconEntries(deps, { book, chapter });
  console.log(`\n${'─'.repeat(72)}\nLEXICON (${lexicon.length} entries)`);
  for (const l of lexicon) {
    console.log(`  ${l.strongs} ${l.lemma} (${l.transliteration}), ${l.language} — ${l.gloss}  [${l.occurrences}×]`);
  }
  if (lexicon.length === 0) {
    console.log('  (none — the prompt keeps the "no lexicon supplied" hedge for this chapter)');
    // Say WHICH link is broken rather than leaving it to another round trip:
    // no interlinear coverage, or coverage that fails to resolve in bible_strongs.
    const raw = await deps.fetchInterlinear({ book, chapter });
    console.log(`  diagnose: bible_interlinear rows for ${book}.${chapter}.% = ${raw.length}`);
    if (raw.length > 0) {
      const sample = raw.slice(0, 8).map((r) => `${r.strongs ?? 'null'} → ${r.strongs ? normalizeStrongs(r.strongs) || '(none)' : '(null)'}`);
      console.log(`  diagnose: raw → normalized  ${sample.join(', ')}`);
      const codes = [...new Set(raw.map((r) => (r.strongs ? normalizeStrongs(r.strongs) : '')).filter(Boolean))];
      const defs = await deps.fetchStrongs(codes.slice(0, 50));
      console.log(`  diagnose: ${codes.length} distinct codes; ${defs.length}/${Math.min(codes.length, 50)} resolved in bible_strongs`);
    }
  }

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`sources that surfaced across ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}: ${[...sourcesSeen].sort().join(', ') || '(none)'}`);
  if (!sourcesSeen.has('matthew-henry-concise')) {
    console.log('WATCH: matthew-henry-concise still absent (runbook §6b). Try a block-level');
    console.log('       question or another chapter before concluding it is not earning its place.');
  }
}

main().catch((err) => {
  console.error('fusion smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
