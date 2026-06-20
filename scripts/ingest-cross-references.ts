// scripts/ingest-cross-references.ts
// One-time idempotent loader for OpenBible.info cross-references (CC BY).
// Download cross_references.txt from https://www.openbible.info/labs/cross-references/
// and pass its path as argv[2]. Idempotent: re-running upserts on the unique key.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { osisToBook, crossesTestament } from './osis-book-map';

export interface CrossRefRow {
  from_book: string; from_chapter: number; from_verse: number;
  to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number;
  votes: number; crosses_testament: boolean;
}

function parseRef(ref: string): { book: string; chapter: number; verse: number } | null {
  // OSIS "Gen.1.1"
  const m = ref.trim().match(/^([0-9A-Za-z]+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const book = osisToBook(m[1]);
  if (!book) throw new Error(`Unmapped OSIS book token: ${m[1]}`);
  return { book, chapter: Number(m[2]), verse: Number(m[3]) };
}

export function parseCrossRefLine(line: string): CrossRefRow | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const [fromRaw, toRaw, votesRaw] = parts;
  if (fromRaw.trim() === 'From Verse') return null; // header
  const from = parseRef(fromRaw);
  if (!from) return null;
  // Target may be a single ref or a range "John.1.1-John.1.3".
  const [toStartRaw, toEndRaw] = toRaw.includes('-') ? toRaw.split('-') : [toRaw, toRaw];
  const toStart = parseRef(toStartRaw);
  const toEnd = parseRef(toEndRaw);
  if (!toStart || !toEnd) return null;
  const votes = Number(votesRaw);
  return {
    from_book: from.book, from_chapter: from.chapter, from_verse: from.verse,
    to_book: toStart.book, to_chapter: toStart.chapter,
    to_verse_start: toStart.verse, to_verse_end: toEnd.verse,
    votes: Number.isFinite(votes) ? votes : 0,
    crosses_testament: crossesTestament(from.book, toStart.book),
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: tsx scripts/ingest-cross-references.ts <cross_references.txt>');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  const supabase = createClient(url, key);

  const rows = readFileSync(path, 'utf8').split('\n')
    .map(parseCrossRefLine)
    .filter((r): r is CrossRefRow => r !== null);

  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('bible_cross_references')
      .upsert(batch, {
        onConflict: 'from_book,from_chapter,from_verse,to_book,to_chapter,to_verse_start,to_verse_end',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`batch ${i}: ${error.message}`);
    console.log(`upserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
