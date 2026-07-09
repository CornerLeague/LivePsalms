//
// Offline seed for bible_etymology (v1: Psalms + Hebrew). Run manually:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
//     npx tsx scripts/etymology/seed-etymology.ts --dry-run --limit=5
//   (drop --dry-run to write; drop --limit to seed all Psalms Hebrew roots)
//
// Pipeline: (1) enumerate unique Psalms Hebrew Strong's from bible_interlinear
// (verse_id like 'psa.%'), counting occurrences for the study_value heuristic;
// (2) build a verified LexiconEntry map from the OpenScriptures Strong's Hebrew
// dictionary under scripts/data/ (root pointer parsed from `derivation`, gloss
// from `strongs_def` — v1 uses Strong's as the gloss; BDB is a post-launch
// enrichment); (3) narrate `development` via Opus under a never-invent prompt;
// (4) run validateGroundedNarration — SKIP + log any row whose narration cites
// ungrounded proper nouns; (5) upsert rows with reviewed=false.
//
// Rows land reviewed=false; a human proofing pass flips reviewed=true (the
// structural launch gate). The panel is absent until proofed rows exist.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildGroundingRecord,
  validateGroundedNarration,
  type LexiconEntry,
  type GroundingRecord,
} from './etymology-grounding';

export const DEVELOPMENT_PROMPT_VERSION = 'etymology-development-2026-07-09-v1';
const MODEL = 'claude-opus-4-8';
const DICT_URL = new URL('../data/strongs-hebrew-dictionary.json', import.meta.url);
const ROW_SOURCE = "Strong's Hebrew (OpenScriptures, public domain)";

// ── OpenScriptures Strong's Hebrew dictionary entry (scripts/data/strongs-hebrew-dictionary.json) ──
export interface OsHebrewEntry {
  lemma?: string;
  derivation?: string;
  strongs_def?: string;
  kjv_def?: string;
}

// Hebrew points + cantillation marks (U+0591–U+05C7). Stripping them turns a
// pointed lemma ("רָעָה") into its consonantal root ("רעה").
const NIQQUD_RE = /[֑-ׇ]/g;
export function stripNiqqud(s: string): string {
  return s.replace(NIQQUD_RE, '');
}

// First Strong's reference in a derivation is the root pointer ("from H7462",
// "from the same as H24 (…)"). Zero-padding is normalized to the dictionary's
// unpadded key form. A primitive root / foreign-origin word with no pointer is
// its own root.
const STRONGS_REF_RE = /H0*(\d+)/;
export function extractRootStrongs(strongs: string, derivation: string): string {
  const m = STRONGS_REF_RE.exec(derivation ?? '');
  return m ? `H${m[1]}` : strongs;
}

function normalizeStrongs(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = STRONGS_REF_RE.exec(raw);
  return m ? `H${m[1]}` : null;
}

const gloss = (dict: Record<string, OsHebrewEntry>, s: string): string =>
  (dict[s]?.strongs_def ?? '').trim();

// Assemble the verified-facts lexicon: resolve each word's root (consonantal
// lemma of the root Strong's) and its same-root family (other words pointing at
// the same root) into the LexiconEntry shape buildGroundingRecord consumes.
export function buildLexicon(dict: Record<string, OsHebrewEntry>): Record<string, LexiconEntry> {
  const rootOf: Record<string, string> = {};
  for (const [s, e] of Object.entries(dict)) rootOf[s] = extractRootStrongs(s, e.derivation ?? '');

  const familyByRoot: Record<string, string[]> = {};
  for (const [s, r] of Object.entries(rootOf)) (familyByRoot[r] ??= []).push(s);

  const out: Record<string, LexiconEntry> = {};
  for (const [s, e] of Object.entries(dict)) {
    const rs = rootOf[s];
    const rootEntry = dict[rs] ?? e;
    const family = new Set(familyByRoot[rs] ?? []);
    family.add(rs); // the root itself is a related word for its derivatives
    family.delete(s); // never list the word as related to itself
    const related = [...family]
      .filter((x) => dict[x])
      .slice(0, 6)
      .map((x) => ({ strongs: x, word: dict[x].lemma ?? '', gloss: gloss(dict, x) }));
    out[s] = {
      lemma: e.lemma ?? '',
      derivation: e.derivation ?? '',
      root: stripNiqqud(rootEntry.lemma ?? ''),
      rootGloss: gloss(dict, rs) || gloss(dict, s),
      bdbGloss: gloss(dict, s),
      related,
    };
  }
  return out;
}

// ── narration (Opus, tool-use, never-invent) — a study-time analogue of ──
// ── supabase/functions/etymology-insight/prompts/verse-insight.ts ──
const DEVELOPMENT_SYSTEM = [
  'You explain how one Hebrew word grew from its root, for a Bible-study aid.',
  "You are given VERIFIED lexicon facts: the word, its root and the root's gloss,",
  'the Strong\'s definition, and related words. In ≤45 words, describe how the word',
  'developed from its root.',
  '',
  'Hard rules:',
  '- Use ONLY the supplied facts. NEVER invent roots, cognates, or source languages',
  '  (no "Akkadian", "Ugaritic", place or deity names) not present in the facts.',
  '- Describe — do not advise. No application, no devotional turn, no "you should…".',
  '- No theology beyond the plain lexical sense; no claims about contested passages.',
].join('\n');

const DEVELOPMENT_TOOL = {
  name: 'emit_development',
  description: 'Return the one-paragraph, grounded "how it grew" note for this word.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['body'],
    properties: { body: { type: 'string', minLength: 12, maxLength: 400 } },
  },
} as const;

function buildDevelopmentUser(rec: GroundingRecord): string {
  const related = rec.related.length
    ? rec.related.map((r) => `${r.word} (${r.gloss})`).join(', ')
    : 'none';
  return (
    `Word (lemma): ${rec.lemma}\n` +
    `Verified root: ${rec.root} — ${rec.rootGloss}\n` +
    `Strong's definition: ${rec.bdbGloss}\n` +
    `Related words: ${related}\n\n` +
    `In ≤45 words, describe how this word grew from its root, using only the facts above.`
  );
}

export async function narrateDevelopment(
  rec: GroundingRecord,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: DEVELOPMENT_SYSTEM,
      tools: [DEVELOPMENT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_development' },
      messages: [{ role: 'user', content: buildDevelopmentUser(rec) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { content?: Array<{ type: string; input?: { body?: string } }> };
  const tool = json.content?.find((b) => b.type === 'tool_use');
  const body = tool?.input?.body;
  if (!body) throw new Error('no emit_development tool_use in response');
  return body.trim();
}

// ── enumeration ──
async function psalmsStrongsCounts(supabase: SupabaseClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bible_interlinear')
      .select('strongs')
      .eq('language', 'hebrew')
      .like('verse_id', 'psa.%')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`bible_interlinear query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ strongs: string | null }>) {
      const s = normalizeStrongs(r.strongs);
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }
  return counts;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

  const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const anthropicKey = requireEnv('ANTHROPIC_API_KEY');

  const dict = JSON.parse(await readFile(fileURLToPath(DICT_URL), 'utf8')) as Record<string, OsHebrewEntry>;
  const lexicon = buildLexicon(dict);

  const counts = await psalmsStrongsCounts(supabase);
  const targets = [...counts.entries()]
    .filter(([s]) => lexicon[s])
    .sort((a, b) => b[1] - a[1]);
  const planned = Number.isFinite(limit) ? targets.slice(0, limit) : targets;
  console.log(
    `Psalms Hebrew lexeme types: ${counts.size}; in-lexicon: ${targets.length}; ` +
      `processing: ${planned.length}; dryRun=${dryRun}`,
  );

  let written = 0;
  let skipped = 0;
  let flagged = 0;
  for (const [strongs, count] of planned) {
    let record: GroundingRecord;
    try {
      record = buildGroundingRecord(strongs, lexicon);
    } catch {
      skipped++;
      continue;
    }
    let development: string;
    try {
      development = await narrateDevelopment(record, anthropicKey);
    } catch (e) {
      console.warn(`skip ${strongs} (${record.lemma}): narration failed — ${(e as Error).message}`);
      skipped++;
      continue;
    }
    const check = validateGroundedNarration(development, record);
    if (!check.ok) {
      console.warn(`FLAGGED ${strongs} (${record.lemma}): ungrounded [${check.unsupported.join(', ')}] — ${development}`);
      flagged++;
      continue;
    }
    const row = {
      strongs,
      lemma: record.lemma,
      root: record.root,
      root_gloss: record.rootGloss,
      development,
      related: record.related,
      study_value: count,
      source: ROW_SOURCE,
      model_used: MODEL,
      prompt_version: DEVELOPMENT_PROMPT_VERSION,
      reviewed: false,
    };
    if (dryRun) {
      console.log(JSON.stringify({ strongs, lemma: row.lemma, root: row.root, study_value: count, development }, null, 2));
    } else {
      const { error } = await supabase
        .from('bible_etymology')
        .upsert(row, { onConflict: 'strongs', ignoreDuplicates: true });
      if (error) {
        console.error(`upsert ${strongs} failed: ${error.message}`);
        skipped++;
        continue;
      }
    }
    written++;
  }
  console.log(`Done. ${dryRun ? 'would-write' : 'wrote'}=${written}, skipped=${skipped}, flagged=${flagged}`);
}

// Run only when invoked directly (npx tsx …), never when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
