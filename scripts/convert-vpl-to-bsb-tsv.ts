// scripts/convert-vpl-to-bsb-tsv.ts
//
// OPERATOR-ONLY TOOL — do not run in CI or import from app code.
//
// Converts an eBible.org VPL plaintext file (format: `BOOKCODE C:V Text`)
// into the BSB-compatible TSV format that ingest-bsb.ts expects:
//   `<Full Book Name> <Chapter>:<Verse>\t<Text>`
//
// Usage (after unzipping the eBible VPL archive):
//   npx tsx scripts/convert-vpl-to-bsb-tsv.ts \
//     --in /path/to/eng-kjv_vpl.txt --out scripts/data/kjv.txt
//   npx tsx scripts/convert-vpl-to-bsb-tsv.ts \
//     --in /path/to/engwebp_vpl.txt --out scripts/data/web.txt
//
// The --translation flag (KJV|WEB) defaults to detection from --in filename.
// Apocryphal books absent from the 66-book Protestant canon are silently
// skipped; a summary of skipped codes is printed at the end.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Map from eBible.org VPL 3-letter UPPERCASE OSIS codes → full English book
// names used by BOOK_ABBREV in ingest-bsb.ts.
// Only the 66 Protestant-canon books are included; apocryphal codes map to null.
const VPL_CODE_TO_FULL_NAME: Record<string, string | null> = {
  // Old Testament
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers',
  DEU: 'Deuteronomy', JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth',
  '1SA': '1 Samuel', '2SA': '2 Samuel', '1KI': '1 Kings', '2KI': '2 Kings',
  '1CH': '1 Chronicles', '2CH': '2 Chronicles', EZR: 'Ezra', NEH: 'Nehemiah',
  EST: 'Esther', JOB: 'Job', PSA: 'Psalm', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SOL: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZE: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOE: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah',
  MIC: 'Micah', NAH: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah',
  HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi',
  // New Testament
  MAT: 'Matthew', MAR: 'Mark', LUK: 'Luke', JOH: 'John',
  ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHI: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy',
  TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews', JAM: 'James',
  '1PE': '1 Peter', '2PE': '2 Peter', '1JO': '1 John', '2JO': '2 John',
  '3JO': '3 John', JUD: 'Jude', REV: 'Revelation',
  // Apocryphal/Deuterocanonical — null = skip
  '1ES': null, '2ES': null, '4ES': null, TOB: null, JDT: null,
  ESG: null, WIS: null, SIR: null, BAR: null, BEL: null,
  SUS: null, '1MA': null, '2MA': null, '3MA': null, '4MA': null,
  MAN: null, PRA: null, PRM: null, PSS: null, ODA: null, LAO: null,
};

// Matches the VPL line format: `BOOKCODE CHAPTER:VERSE rest of text`
const VPL_LINE = /^([A-Z0-9]+) (\d+):(\d+) (.+)$/;

async function main() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const outIdx = args.indexOf('--out');
  if (inIdx < 0 || outIdx < 0) {
    console.error('Usage: npx tsx scripts/convert-vpl-to-bsb-tsv.ts --in <vpl.txt> --out <output.txt>');
    process.exit(1);
  }
  const inPath = args[inIdx + 1];
  const outPath = args[outIdx + 1];

  const raw = await readFile(inPath, 'utf8');
  // Strip BOM if present.
  const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);

  const outputLines: string[] = [];
  const skippedCodes = new Map<string, number>();
  let converted = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = VPL_LINE.exec(trimmed);
    if (!m) continue; // blank or non-verse line
    const [, code, , , verseText] = m;
    const ref = trimmed.slice(code.length + 1, trimmed.length - verseText.length - 1); // "C:V"
    const fullName = VPL_CODE_TO_FULL_NAME[code];
    if (fullName === undefined) {
      // Unknown code — log and skip
      skippedCodes.set(code, (skippedCodes.get(code) ?? 0) + 1);
      continue;
    }
    if (fullName === null) {
      // Apocrypha — skip silently (counted)
      skippedCodes.set(code, (skippedCodes.get(code) ?? 0) + 1);
      continue;
    }
    outputLines.push(`${fullName} ${ref}\t${verseText}`);
    converted++;
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, outputLines.join('\n') + '\n', 'utf8');
  console.log(`Converted ${converted} verses → ${outPath}`);
  if (skippedCodes.size > 0) {
    console.log('Skipped codes (apocrypha/unknown):');
    for (const [code, count] of [...skippedCodes.entries()].sort()) {
      const label = VPL_CODE_TO_FULL_NAME[code] === null ? 'apocrypha' : 'unknown';
      console.log(`  ${code} (${label}): ${count} verses`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
