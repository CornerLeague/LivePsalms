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
// Where Hebrew/English versification diverges, STEP inserts the alternate reference
// between the verse and the #NN word index — "(32.1)" in TAHOT, "[17.15]" / "{19.41}"
// in TAGNT. The leading Book.Chapter.Verse is the English numbering the reader uses;
// we skip the bracketed alternate so the #NN word index is still captured.
const STEP_REF_RE = /^([1-9A-Za-z]{2,3})\.(\d+)\.(\d+)(?:[([{]\d+\.\d+[)\]}])?(?:#(\d+))?/;

export function stepRefToVerse(ref: string): { verseId: string; position: number } {
  const m = STEP_REF_RE.exec(ref.trim());
  if (!m) throw new Error(`unparseable STEPBible ref: "${ref}"`);
  const [, bookRaw, ch, vs, pos] = m;
  const book = bookRaw.toLowerCase();
  if (!OSIS_BOOKS.has(book)) throw new Error(`unknown STEPBible book code: "${bookRaw}"`);
  return { verseId: `${book}.${Number(ch)}.${Number(vs)}`, position: pos ? Number(pos) : 1 };
}

export function toInterlinearRows(records: StepRecord[], language: LexiconLanguage): InterlinearRow[] {
  // STEP word indices (#NN) restart within each Hebrew sub-verse. Where English
  // versification collapses several Hebrew verses into one (e.g. a Psalm
  // superscription folded into verse 0) those indices repeat, so keying position on
  // #NN would emit duplicate (verse_id, position) rows and break the upsert's primary
  // key. Number positions by appearance order per verse_id instead: unique by
  // construction, deterministic (idempotent re-runs), and identical to #NN for the
  // ~99.98% of verses with no versification divergence.
  const seq = new Map<string, number>();
  return records.map((r) => {
    const { verseId } = stepRefToVerse(r.ref);
    const position = (seq.get(verseId) ?? 0) + 1;
    seq.set(verseId, position);
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

// The two STEPBible corpora are laid out DIFFERENTLY, so parsing is language-aware
// (confirmed against the real files — see docs/runbooks/bible-lexicon-ingest.md).
//
// TAHOT (Hebrew/Aramaic OT): one field per tab column.
const TAHOT_COL = { ref: 0, original: 1, transliteration: 2, gloss: 3, strongs: 4, morph: 5 } as const;

function parseTahotRow(cols: string[]): StepRecord {
  return {
    ref: (cols[TAHOT_COL.ref] ?? '').trim(),
    original: cols[TAHOT_COL.original] ?? '',
    transliteration: cols[TAHOT_COL.transliteration] ?? '',
    gloss: cols[TAHOT_COL.gloss] ?? '',
    strongs: cols[TAHOT_COL.strongs] ?? '',
    morph: cols[TAHOT_COL.morph] ?? '',
  };
}

// TAGNT (Greek NT): col[1] fuses the Greek word and its transliteration as
// "Βίβλος (Biblos)"; col[2] is the English gloss; col[3] fuses Strong's number
// and morphology as "G0976=N-NSF", with compound words joined by " + " (e.g.
// "G1473=P-1NS + G2532=CONJ"). We split each so strongs/morph stay clean.
const TAGNT_COL = { ref: 0, word: 1, gloss: 2, strongMorph: 3 } as const;
const TAGNT_WORD_RE = /^(.*?)\s*\(([^()]*)\)\s*$/; // "Greek (translit)" -> [greek, translit]

function parseTagntRow(cols: string[]): StepRecord {
  const wordCell = (cols[TAGNT_COL.word] ?? '').trim();
  const m = TAGNT_WORD_RE.exec(wordCell);
  const units = (cols[TAGNT_COL.strongMorph] ?? '')
    .split(' + ')
    .map((u) => u.trim())
    .filter(Boolean);
  return {
    ref: (cols[TAGNT_COL.ref] ?? '').trim(),
    original: (m ? m[1] : wordCell).trim(),
    transliteration: (m ? m[2] : '').trim(),
    gloss: cols[TAGNT_COL.gloss] ?? '',
    strongs: units.map((u) => u.split('=')[0].trim()).join(' + '),
    morph: units.map((u) => u.slice(u.indexOf('=') + 1).trim()).join(' + '),
  };
}

// Drops any line whose first cell is not a valid ref, so header/license/blank
// lines are skipped automatically regardless of corpus.
export function extractStepRecords(raw: string, language: LexiconLanguage): StepRecord[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parseRow = language === 'greek' ? parseTagntRow : parseTahotRow;
  const records: StepRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    if (!STEP_REF_RE.test((cols[0] ?? '').trim())) continue; // header / license / blank
    records.push(parseRow(cols));
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
  const records = extractStepRecords(raw, language);
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
