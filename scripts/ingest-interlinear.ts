//
// One-shot ingest of a STEPBible interlinear corpus (TAHOT for Hebrew/Aramaic OT,
// TAGNT for Greek NT) into bible_interlinear. Idempotent: upserts on (verse_id,
// position).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     LANG=hebrew FILE=scripts/data/TAHOT.txt npx tsx scripts/ingest-interlinear.ts
//   (run again with LANG=greek FILE=scripts/data/TAGNT.txt for the NT)
//
// Source: https://github.com/STEPBible/STEPBible-Data (TAHOT / TAGNT, CC BY 4.0).
// Download a release file and cache it at scripts/data/. See the runbook for the
// exact file names and the column-order confirmation step.

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { BIBLE_BOOKS } from '../src/notepad/bible/bible-books';

export type LexiconLanguage = 'hebrew' | 'aramaic' | 'greek';

export interface StepRecord {
  ref: string;
  original: string;
  transliteration: string;
  gloss: string;
  strongs: string;
  morph: string;
}

export interface InterlinearRow {
  verse_id: string;
  position: number;
  original: string;
  transliteration: string;
  strongs: string | null;
  morph: string;
  gloss: string;
  language: LexiconLanguage;
}

const OSIS_BOOKS = new Set(BIBLE_BOOKS.map((b) => b.abbrev));

// Matches a STEPBible reference token at the start of a cell: Book.Chapter.Verse
// with an optional #NN word-position suffix. Trailing "=L"/mapping markers are
// ignored. Book code is 2-3 chars (may lead with a digit, e.g. "1Ki").
const STEP_REF_RE = /^([1-9A-Za-z]{2,3})\.(\d+)\.(\d+)(?:#(\d+))?/;

export function stepRefToVerse(ref: string): { verseId: string; position: number } {
  const m = STEP_REF_RE.exec(ref.trim());
  if (!m) throw new Error(`unparseable STEPBible ref: "${ref}"`);
  const [, bookRaw, ch, vs, pos] = m;
  const book = bookRaw.toLowerCase();
  if (!OSIS_BOOKS.has(book)) throw new Error(`unknown STEPBible book code: "${bookRaw}"`);
  return { verseId: `${book}.${Number(ch)}.${Number(vs)}`, position: pos ? Number(pos) : 1 };
}

export function toInterlinearRows(records: StepRecord[], language: LexiconLanguage): InterlinearRow[] {
  return records.map((r) => {
    const { verseId, position } = stepRefToVerse(r.ref);
    const strongs = r.strongs.trim();
    return {
      verse_id: verseId,
      position,
      original: r.original.trim(),
      transliteration: r.transliteration.trim(),
      strongs: strongs ? strongs : null,
      morph: r.morph.trim(),
      gloss: r.gloss.trim(),
      language,
    };
  });
}

// Column order in the STEPBible TAHOT/TAGNT data rows. CONFIRM against the
// downloaded file before the real ingest and adjust if the source revises its
// layout — extractTahotRecords drops any line whose first cell is not a valid
// ref, so header/license lines are skipped automatically.
const COL = { ref: 0, original: 1, transliteration: 2, gloss: 3, strongs: 4, morph: 5 } as const;

export function extractTahotRecords(raw: string): StepRecord[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const records: StepRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    const refCell = (cols[COL.ref] ?? '').trim();
    if (!STEP_REF_RE.test(refCell)) continue; // header / license / blank
    records.push({
      ref: refCell,
      original: cols[COL.original] ?? '',
      transliteration: cols[COL.transliteration] ?? '',
      gloss: cols[COL.gloss] ?? '',
      strongs: cols[COL.strongs] ?? '',
      morph: cols[COL.morph] ?? '',
    });
  }
  return records;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} required`);
  return v;
}

async function main() {
  const language = (process.env.LANG ?? 'hebrew') as LexiconLanguage;
  const file = required('FILE');
  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const raw = await readFile(file, 'utf8');
  const records = extractTahotRecords(raw);
  const rows = toInterlinearRows(records, language);
  console.log(`parsed ${rows.length} ${language} interlinear rows from ${file}`);

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from('bible_interlinear').upsert(batch, { onConflict: 'verse_id,position' });
    if (error) throw error;
    if ((i / 500) % 10 === 0) console.log(`  upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  console.log('done');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
