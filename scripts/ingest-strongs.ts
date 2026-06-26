//
// One-shot ingest of the OpenScriptures Strong's dictionaries (public domain)
// into bible_strongs. Idempotent: upserts on `strongs`.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     LANG=hebrew FILE=scripts/data/strongs-hebrew-dictionary.json \
//     npx tsx scripts/ingest-strongs.ts
//   (run again with LANG=greek FILE=scripts/data/strongs-greek-dictionary.json)
//
// Source: github.com/openscriptures/strongs (JSON keyed by Strong's number with
// lemma / xlit / pron / strongs_def / kjv_def fields).

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

export type LexiconLanguage = 'hebrew' | 'aramaic' | 'greek';

export interface OsStrongsEntry {
  lemma?: string;
  xlit?: string;
  // OpenScriptures' Greek dictionary names the transliteration field `translit`
  // (the Hebrew one uses `xlit`) and omits `pron` entirely.
  translit?: string;
  pron?: string;
  strongs_def?: string;
  kjv_def?: string;
}

export interface StrongsDictRow {
  strongs: string;
  lemma: string;
  transliteration: string;
  pronunciation: string;
  short_def: string;
  full_def: string;
  language: LexiconLanguage;
}

export function toStrongsRows(dict: Record<string, OsStrongsEntry>, language: LexiconLanguage): StrongsDictRow[] {
  return Object.entries(dict).map(([strongs, e]) => {
    const shortDef = (e.strongs_def ?? '').trim();
    const fullDef = [e.strongs_def, e.kjv_def].filter(Boolean).join(' — ').trim();
    return {
      strongs,
      lemma: e.lemma ?? '',
      transliteration: e.xlit ?? e.translit ?? '',
      pronunciation: e.pron ?? '',
      short_def: shortDef,
      full_def: fullDef,
      language,
    };
  });
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

  const dict = JSON.parse(await readFile(file, 'utf8')) as Record<string, OsStrongsEntry>;
  const rows = toStrongsRows(dict, language);
  console.log(`parsed ${rows.length} ${language} Strong's entries from ${file}`);

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from('bible_strongs').upsert(batch, { onConflict: 'strongs' });
    if (error) throw error;
  }
  console.log('done');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
