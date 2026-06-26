# Hebrew/Greek Interlinear in the Study Context Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a word-by-word Hebrew/Greek interlinear (with Strong's numbers and definitions) for the verse the user selects in the study reader, inside a dropdown at the top of the Study **Context** tab (`ApparatusRail`).

**Architecture:** A new public-read data layer (`bible_interlinear` + `bible_strongs`, ingested from STEPBible + OpenScriptures, keyed by translation-independent OSIS verse id) is queried directly from the client via two small hooks. Verse selection — already emitted by `BibleReader` via its existing-but-unwired `onSelectVerse` prop — is lifted to `StudyWorkspace` and passed into `ApparatusRail`, which renders a new `OriginalLanguagePanel`.

**Tech Stack:** React + TypeScript, Supabase (Postgres + RLS), Vitest + @testing-library/react (`renderHook`, jsdom), `tsx` ingest scripts.

## Global Constraints

- **Verse identity:** OSIS id `book.chapter.verse`, book codes **lowercase OSIS** (e.g. `jhn.3.16`). Must match `bible_passages.book` exactly. `bible-books.ts` `BIBLE_BOOKS[].abbrev` is the canonical list of the 66 codes.
- **Reference tables are public-read:** RLS `enable row level security` + policy `for select using (true)`. No user scope. Mirror `032_bible_books.sql`.
- **Migration naming:** zero-padded `NNN_snake_case.sql`; next number is **`041`**. Apply via `supabase db push`.
- **Styling in study panes:** inline styles + CSS variables (`--deep-umber`, `--silica`, `--lamplight-accent`, `--pale-stone`, `--cream`), **not Tailwind**. Lucide icons are allowed (used elsewhere in the rail).
- **No LLM involvement:** panel content is authoritative dataset data only.
- **Supabase client** is imported from `@/lib/supabase` and **may be `null`** (env missing) — guard before querying, as `useBiblePassages` does.
- **Data licensing:** STEPBible TAHOT/TAGNT = CC BY 4.0; OpenScriptures Strong's dictionaries = public domain. Attribution string is surfaced in the panel.

---

## Phase A — Data layer (backend)

### Task A1: Migration `041_bible_lexicon.sql`

**Files:**
- Create: `supabase/migrations/041_bible_lexicon.sql`

**Interfaces:**
- Produces: tables `public.bible_interlinear (verse_id, position, original, transliteration, strongs, morph, gloss, language)` PK `(verse_id, position)`; `public.bible_strongs (strongs, lemma, transliteration, pronunciation, short_def, full_def, language)` PK `strongs`. Both public-read.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/041_bible_lexicon.sql
-- Original-language interlinear + Strong's lexicon. Public read (reference data,
-- not user-scoped), mirroring bible_books / bible_cross_references. verse_id is
-- the translation-independent OSIS id (book.chapter.verse) used as the id prefix
-- in bible_passages (lowercase OSIS book codes).

create table public.bible_interlinear (
  verse_id text not null,                       -- OSIS id, e.g. 'jhn.3.16'
  position integer not null,                    -- word order within the verse, from 1
  original text not null,                        -- Hebrew/Aramaic/Greek script
  transliteration text not null default '',
  strongs text,                                  -- e.g. 'H430','G2316'; null for some particles
  morph text not null default '',                -- morphology / part of speech
  gloss text not null default '',                -- short English gloss
  language text not null check (language in ('hebrew', 'aramaic', 'greek')),
  primary key (verse_id, position)
);

create index bible_interlinear_verse on public.bible_interlinear (verse_id);

alter table public.bible_interlinear enable row level security;
create policy "Anyone can read bible_interlinear"
  on public.bible_interlinear for select using (true);

create table public.bible_strongs (
  strongs text primary key,                      -- e.g. 'H430'
  lemma text not null default '',
  transliteration text not null default '',
  pronunciation text not null default '',
  short_def text not null default '',
  full_def text not null default '',
  language text not null check (language in ('hebrew', 'aramaic', 'greek'))
);

alter table public.bible_strongs enable row level security;
create policy "Anyone can read bible_strongs"
  on public.bible_strongs for select using (true);
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`
Expected: applies `041_bible_lexicon.sql` with no error.

- [ ] **Step 3: Verify the tables exist and are empty**

Run:
```bash
supabase db push --dry-run   # confirms no pending diff after apply
```
Then in the Supabase SQL editor (or `psql`), run `select count(*) from bible_interlinear;` and `select count(*) from bible_strongs;` — both return `0`. Confirm an anonymous `select` is permitted (public read).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/041_bible_lexicon.sql
git commit -m "feat(study): add bible_interlinear + bible_strongs tables (041)"
```

---

### Task A2: Interlinear ingest (parser + script)

**Files:**
- Create: `scripts/ingest-interlinear.ts`
- Test: `scripts/ingest-interlinear.test.ts`

**Interfaces:**
- Consumes: `BIBLE_BOOKS` from `src/notepad/bible/bible-books.ts` (for the 66 valid OSIS codes).
- Produces: `stepRefToVerse(ref: string): { verseId: string; position: number }`; `toInterlinearRows(records: StepRecord[], language: LexiconLanguage): InterlinearRow[]`; `extractTahotRecords(raw: string): StepRecord[]`. Writes rows into `bible_interlinear`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/ingest-interlinear.test.ts
import { describe, it, expect } from 'vitest';
import { stepRefToVerse, toInterlinearRows, extractTahotRecords } from './ingest-interlinear';

describe('stepRefToVerse', () => {
  it('maps a STEPBible ref to a lowercase-OSIS verse id + position', () => {
    expect(stepRefToVerse('Gen.1.1#01=L')).toEqual({ verseId: 'gen.1.1', position: 1 });
    expect(stepRefToVerse('1Ki.8.27#14')).toEqual({ verseId: '1ki.8.27', position: 14 });
    expect(stepRefToVerse('Jhn.3.16#05')).toEqual({ verseId: 'jhn.3.16', position: 5 });
  });
  it('defaults position to 1 when no #NN suffix is present', () => {
    expect(stepRefToVerse('Psa.23.1')).toEqual({ verseId: 'psa.23.1', position: 1 });
  });
  it('throws on an unknown book code so format drift is caught', () => {
    expect(() => stepRefToVerse('Zzz.1.1#01')).toThrow(/unknown STEPBible book code/);
  });
});

describe('toInterlinearRows', () => {
  it('maps records to DB rows and normalizes empty strongs to null', () => {
    const rows = toInterlinearRows(
      [
        { ref: 'Gen.1.1#01=L', original: 'בְּרֵאשִׁית', transliteration: 'bereshit', gloss: 'In the beginning', strongs: 'H7225', morph: 'HR/Ncfsa' },
        { ref: 'Gen.1.1#02=L', original: 'בָּרָא', transliteration: 'bara', gloss: 'created', strongs: '', morph: 'HVqp3ms' },
      ],
      'hebrew',
    );
    expect(rows).toEqual([
      { verse_id: 'gen.1.1', position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning', language: 'hebrew' },
      { verse_id: 'gen.1.1', position: 2, original: 'בָּרָא', transliteration: 'bara', strongs: null, morph: 'HVqp3ms', gloss: 'created', language: 'hebrew' },
    ]);
  });
});

describe('extractTahotRecords', () => {
  // Tab-separated data rows begin with a ref token; license/header lines do not.
  const SAMPLE =
    'TAHOT - Translators Amalgamated Hebrew OT - License: CC BY 4.0\n' +
    '#Ref\tHebrew\tTransliteration\tTranslation\tdStrong\tGrammar\n' +
    'Gen.1.1#01=L\tבְּרֵאשִׁית\tbereshit\tIn the beginning\tH7225\tHR/Ncfsa\n' +
    'Gen.1.1#02=L\tבָּרָא\tbara\tcreated\tH1254\tHVqp3ms\n';

  it('keeps ref-led data rows and drops header/license lines', () => {
    const records = extractTahotRecords(SAMPLE);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ ref: 'Gen.1.1#01=L', original: 'בְּרֵאשִׁית', transliteration: 'bereshit', gloss: 'In the beginning', strongs: 'H7225', morph: 'HR/Ncfsa' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/ingest-interlinear.test.ts`
Expected: FAIL — `Cannot find module './ingest-interlinear'`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/ingest-interlinear.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/ingest-interlinear.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-interlinear.ts scripts/ingest-interlinear.test.ts
git commit -m "feat(study): interlinear ingest parser (STEPBible TAHOT/TAGNT)"
```

> **Operator note (not a code step):** The actual data load runs later, against the downloaded STEPBible files: confirm the column order matches `COL`, place `TAHOT.txt`/`TAGNT.txt` under `scripts/data/`, then run `LANG=hebrew FILE=scripts/data/TAHOT.txt npx tsx scripts/ingest-interlinear.ts` and again with `LANG=greek FILE=scripts/data/TAGNT.txt`. Aramaic portions (Daniel/Ezra) ship inside TAHOT; if the source tags them distinctly, run those rows with `LANG=aramaic`.

---

### Task A3: Strong's dictionary ingest (parser + script)

**Files:**
- Create: `scripts/ingest-strongs.ts`
- Test: `scripts/ingest-strongs.test.ts`
- Create: `docs/runbooks/bible-lexicon-ingest.md`

**Interfaces:**
- Produces: `toStrongsRows(dict: Record<string, OsStrongsEntry>, language: LexiconLanguage): StrongsDictRow[]`. Writes rows into `bible_strongs`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/ingest-strongs.test.ts
import { describe, it, expect } from 'vitest';
import { toStrongsRows } from './ingest-strongs';

describe('toStrongsRows', () => {
  it('maps an OpenScriptures dictionary object to bible_strongs rows', () => {
    const rows = toStrongsRows(
      {
        H430: { lemma: 'אֱלֹהִים', xlit: 'ʼĕlôhîym', pron: 'el-o-heem’', strongs_def: 'gods in the ordinary sense', kjv_def: 'angels, God, gods' },
      },
      'hebrew',
    );
    expect(rows).toEqual([
      {
        strongs: 'H430',
        lemma: 'אֱלֹהִים',
        transliteration: 'ʼĕlôhîym',
        pronunciation: 'el-o-heem’',
        short_def: 'gods in the ordinary sense',
        full_def: 'gods in the ordinary sense — angels, God, gods',
        language: 'hebrew',
      },
    ]);
  });

  it('tolerates missing fields with empty-string defaults', () => {
    const rows = toStrongsRows({ G25: { lemma: 'ἀγαπάω' } }, 'greek');
    expect(rows[0]).toEqual({
      strongs: 'G25',
      lemma: 'ἀγαπάω',
      transliteration: '',
      pronunciation: '',
      short_def: '',
      full_def: '',
      language: 'greek',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/ingest-strongs.test.ts`
Expected: FAIL — `Cannot find module './ingest-strongs'`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/ingest-strongs.ts
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
      transliteration: e.xlit ?? '',
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/ingest-strongs.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Write the ingest runbook**

```markdown
<!-- docs/runbooks/bible-lexicon-ingest.md -->
# Bible lexicon ingest (Hebrew/Greek interlinear + Strong's)

Populates `bible_interlinear` and `bible_strongs`. Run after migration 041 is applied.

## Sources (license-clean)
- Interlinear: STEPBible TAHOT (Hebrew/Aramaic OT) + TAGNT (Greek NT), CC BY 4.0 —
  https://github.com/STEPBible/STEPBible-Data
- Strong's definitions: OpenScriptures dictionaries (public domain) —
  https://github.com/openscriptures/strongs

## Steps
1. Download TAHOT + TAGNT release files; cache as `scripts/data/TAHOT.txt`, `scripts/data/TAGNT.txt`.
2. **Confirm column order** in those files matches the `COL` constant in
   `scripts/ingest-interlinear.ts` (ref, original, transliteration, gloss, dStrong, grammar).
   Adjust `COL` + re-run `npx vitest run scripts/ingest-interlinear.test.ts` if the layout differs.
3. Download `strongs-hebrew-dictionary.json` + `strongs-greek-dictionary.json` to `scripts/data/`.
4. Load (service-role env required):
   ```
   LANG=hebrew FILE=scripts/data/TAHOT.txt npx tsx scripts/ingest-interlinear.ts
   LANG=greek  FILE=scripts/data/TAGNT.txt npx tsx scripts/ingest-interlinear.ts
   LANG=hebrew FILE=scripts/data/strongs-hebrew-dictionary.json npx tsx scripts/ingest-strongs.ts
   LANG=greek  FILE=scripts/data/strongs-greek-dictionary.json  npx tsx scripts/ingest-strongs.ts
   ```
5. Spot-check: `select * from bible_interlinear where verse_id = 'jhn.3.16' order by position;`

## Known reconciliation risk
STEPBible dStrong numbers may carry disambiguation suffixes (e.g. `H1234a`) that the
OpenScriptures base dictionary lacks. Unmatched numbers degrade to "Definition unavailable"
in the UI (acceptable for MVP). A future pass can normalize suffixes.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest-strongs.ts scripts/ingest-strongs.test.ts docs/runbooks/bible-lexicon-ingest.md
git commit -m "feat(study): Strong's dictionary ingest + lexicon ingest runbook"
```

---

## Phase B — Frontend

### Task B1: `useVerseLexicon` hook

**Files:**
- Create: `src/notepad/study/lexicon/useVerseLexicon.ts`
- Test: `src/notepad/study/lexicon/useVerseLexicon.test.ts`

**Interfaces:**
- Produces: `useVerseLexicon(verseId: string | null): { words: InterlinearWord[]; language: LexiconLanguage | null; loading: boolean; error: string | null }`. Exports types `InterlinearWord`, `LexiconLanguage`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// src/notepad/study/lexicon/useVerseLexicon.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { order, select, eq, from, getBuilder, setOrderResult } = vi.hoisted(() => {
  const order = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let orderResult: { data: unknown; error: unknown } = { data: [], error: null };
  const builder = {
    select, eq, order,
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(resolve(orderResult)),
  };
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  return { order, select, eq, from, getBuilder: () => builder, setOrderResult: (v: { data: unknown; error: unknown }) => { orderResult = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useVerseLexicon } from './useVerseLexicon';

beforeEach(() => {
  from.mockClear(); select.mockClear(); eq.mockClear(); order.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setOrderResult({ data: [], error: null });
});
afterEach(cleanup);

describe('useVerseLexicon', () => {
  it('queries bible_interlinear and maps rows to words + language', async () => {
    setOrderResult({
      data: [
        { position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning', language: 'hebrew' },
        { position: 2, original: 'בָּרָא', transliteration: 'bara', strongs: 'H1254', morph: 'HVqp3ms', gloss: 'created', language: 'hebrew' },
      ],
      error: null,
    });
    const { result } = renderHook(() => useVerseLexicon('gen.1.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).toHaveBeenCalledWith('bible_interlinear');
    expect(eq).toHaveBeenCalledWith('verse_id', 'gen.1.1');
    expect(order).toHaveBeenCalledWith('position', { ascending: true });
    expect(result.current.language).toBe('hebrew');
    expect(result.current.words).toEqual([
      { position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning' },
      { position: 2, original: 'בָּרָא', transliteration: 'bara', strongs: 'H1254', morph: 'HVqp3ms', gloss: 'created' },
    ]);
  });

  it('does not query and returns empty when verseId is null', async () => {
    const { result } = renderHook(() => useVerseLexicon(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.words).toEqual([]);
    expect(result.current.language).toBeNull();
  });

  it('surfaces a query error and empties words', async () => {
    setOrderResult({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useVerseLexicon('gen.1.1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.words).toEqual([]);
    expect(result.current.error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/useVerseLexicon.test.ts`
Expected: FAIL — `Cannot find module './useVerseLexicon'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/notepad/study/lexicon/useVerseLexicon.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type LexiconLanguage = 'hebrew' | 'aramaic' | 'greek';

export interface InterlinearWord {
  position: number;
  original: string;
  transliteration: string;
  strongs: string | null;
  morph: string;
  gloss: string;
}

export interface UseVerseLexiconResult {
  words: InterlinearWord[];
  language: LexiconLanguage | null;
  loading: boolean;
  error: string | null;
}

interface InterlinearRow extends InterlinearWord {
  language: LexiconLanguage;
}

/**
 * Fetch the word-by-word interlinear for one verse from bible_interlinear.
 * `verseId` is the OSIS id (e.g. "jhn.3.16"); null clears the result without
 * querying. The verse's language is taken from its first word row.
 */
export function useVerseLexicon(verseId: string | null): UseVerseLexiconResult {
  const [words, setWords] = useState<InterlinearWord[]>([]);
  const [language, setLanguage] = useState<LexiconLanguage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (verseId == null) {
      setWords([]); setLanguage(null); setLoading(false); setError(null);
      return;
    }
    if (!supabase) {
      setWords([]); setLanguage(null); setError('Lexicon is unavailable.'); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_interlinear')
        .select('position, original, transliteration, strongs, morph, gloss, language')
        .eq('verse_id', verseId)
        .order('position', { ascending: true });
      if (cancelled) return;
      if (qErr) {
        setWords([]); setLanguage(null); setError(qErr.message);
      } else {
        const rows = (data ?? []) as InterlinearRow[];
        setWords(rows.map(({ position, original, transliteration, strongs, morph, gloss }) => ({
          position, original, transliteration, strongs, morph, gloss,
        })));
        setLanguage(rows[0]?.language ?? null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [verseId]);

  return { words, language, loading, error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/lexicon/useVerseLexicon.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/lexicon/useVerseLexicon.ts src/notepad/study/lexicon/useVerseLexicon.test.ts
git commit -m "feat(study): useVerseLexicon hook (per-verse interlinear)"
```

---

### Task B2: `useStrongsEntry` hook

**Files:**
- Create: `src/notepad/study/lexicon/useStrongsEntry.ts`
- Test: `src/notepad/study/lexicon/useStrongsEntry.test.ts`

**Interfaces:**
- Consumes: `LexiconLanguage` from `./useVerseLexicon`.
- Produces: `useStrongsEntry(strongs: string | null): { entry: StrongsEntry | null; loading: boolean; error: string | null }`. Exports type `StrongsEntry`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// src/notepad/study/lexicon/useStrongsEntry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { maybeSingle, select, eq, from, getBuilder, setResult } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let result: { data: unknown; error: unknown } = { data: null, error: null };
  const builder = { select, eq, maybeSingle };
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  maybeSingle.mockImplementation(() => Promise.resolve(result));
  from.mockImplementation(() => builder);
  return { maybeSingle, select, eq, from, getBuilder: () => builder, setResult: (v: { data: unknown; error: unknown }) => { result = v; } };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useStrongsEntry } from './useStrongsEntry';

beforeEach(() => {
  from.mockClear(); select.mockClear(); eq.mockClear(); maybeSingle.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setResult({ data: null, error: null });
  maybeSingle.mockImplementation(() => Promise.resolve({ data: null, error: null }));
});
afterEach(cleanup);

describe('useStrongsEntry', () => {
  it('fetches one row and maps snake_case columns to the entry', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({
      data: { strongs: 'H7225', lemma: 'רֵאשִׁית', transliteration: 'reshith', pronunciation: 'ray-sheeth', short_def: 'first', full_def: 'first, in place, time, order', language: 'hebrew' },
      error: null,
    }));
    const { result } = renderHook(() => useStrongsEntry('H7225'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).toHaveBeenCalledWith('bible_strongs');
    expect(eq).toHaveBeenCalledWith('strongs', 'H7225');
    expect(result.current.entry).toEqual({
      strongs: 'H7225', lemma: 'רֵאשִׁית', transliteration: 'reshith', pronunciation: 'ray-sheeth',
      shortDef: 'first', fullDef: 'first, in place, time, order', language: 'hebrew',
    });
  });

  it('returns null entry without querying when strongs is null', async () => {
    const { result } = renderHook(() => useStrongsEntry(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.entry).toBeNull();
  });

  it('serves a repeated lookup from cache (no second query)', async () => {
    maybeSingle.mockImplementation(() => Promise.resolve({
      data: { strongs: 'G2316', lemma: 'θεός', transliteration: 'theos', pronunciation: 'theh-os', short_def: 'God', full_def: 'a deity; God', language: 'greek' },
      error: null,
    }));
    const first = renderHook(() => useStrongsEntry('G2316'));
    await waitFor(() => expect(first.result.current.entry?.strongs).toBe('G2316'));
    const callsAfterFirst = from.mock.calls.length;
    const second = renderHook(() => useStrongsEntry('G2316'));
    await waitFor(() => expect(second.result.current.entry?.strongs).toBe('G2316'));
    expect(from.mock.calls.length).toBe(callsAfterFirst);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/useStrongsEntry.test.ts`
Expected: FAIL — `Cannot find module './useStrongsEntry'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/notepad/study/lexicon/useStrongsEntry.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LexiconLanguage } from './useVerseLexicon';

export interface StrongsEntry {
  strongs: string;
  lemma: string;
  transliteration: string;
  pronunciation: string;
  shortDef: string;
  fullDef: string;
  language: LexiconLanguage;
}

export interface UseStrongsEntryResult {
  entry: StrongsEntry | null;
  loading: boolean;
  error: string | null;
}

interface StrongsRow {
  strongs: string;
  lemma: string;
  transliteration: string;
  pronunciation: string;
  short_def: string;
  full_def: string;
  language: LexiconLanguage;
}

// Strong's entries are immutable reference data, so one fetch per number is
// enough no matter how many verses/words reference it this session.
const cache = new Map<string, StrongsEntry>();

/** Lazily fetch one Strong's dictionary entry; null clears without querying. */
export function useStrongsEntry(strongs: string | null): UseStrongsEntryResult {
  const [entry, setEntry] = useState<StrongsEntry | null>(strongs ? cache.get(strongs) ?? null : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (strongs == null) {
      setEntry(null); setLoading(false); setError(null);
      return;
    }
    const cached = cache.get(strongs);
    if (cached) {
      setEntry(cached); setLoading(false); setError(null);
      return;
    }
    if (!supabase) {
      setEntry(null); setError('Lexicon is unavailable.'); setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);

    (async () => {
      const { data, error: qErr } = await supabase
        .from('bible_strongs')
        .select('strongs, lemma, transliteration, pronunciation, short_def, full_def, language')
        .eq('strongs', strongs)
        .maybeSingle();
      if (cancelled) return;
      if (qErr) {
        setEntry(null); setError(qErr.message);
      } else if (data) {
        const r = data as StrongsRow;
        const mapped: StrongsEntry = {
          strongs: r.strongs,
          lemma: r.lemma,
          transliteration: r.transliteration,
          pronunciation: r.pronunciation,
          shortDef: r.short_def,
          fullDef: r.full_def,
          language: r.language,
        };
        cache.set(strongs, mapped);
        setEntry(mapped);
      } else {
        setEntry(null);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [strongs]);

  return { entry, loading, error };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/lexicon/useStrongsEntry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/lexicon/useStrongsEntry.ts src/notepad/study/lexicon/useStrongsEntry.test.ts
git commit -m "feat(study): useStrongsEntry hook (cached Strong's definitions)"
```

---

### Task B3: `OriginalLanguagePanel` component

**Files:**
- Create: `src/notepad/study/lexicon/OriginalLanguagePanel.tsx`
- Test: `src/notepad/study/lexicon/OriginalLanguagePanel.test.tsx`

**Interfaces:**
- Consumes: `useVerseLexicon`, `useStrongsEntry`, `InterlinearWord`, `LexiconLanguage`.
- Produces: `OriginalLanguagePanel({ verseId: string | null; reference: string | null })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/notepad/study/lexicon/OriginalLanguagePanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const useVerseLexicon = vi.fn();
const useStrongsEntry = vi.fn();
vi.mock('./useVerseLexicon', () => ({ useVerseLexicon: (id: string | null) => useVerseLexicon(id) }));
vi.mock('./useStrongsEntry', () => ({ useStrongsEntry: (s: string | null) => useStrongsEntry(s) }));
import { OriginalLanguagePanel } from './OriginalLanguagePanel';

beforeEach(() => {
  useVerseLexicon.mockReset();
  useStrongsEntry.mockReset();
  useStrongsEntry.mockReturnValue({ entry: null, loading: false, error: null });
});

describe('OriginalLanguagePanel', () => {
  it('prompts the user to select a verse when verseId is null', () => {
    useVerseLexicon.mockReturnValue({ words: [], language: null, loading: false, error: null });
    render(<OriginalLanguagePanel verseId={null} reference={null} />);
    expect(screen.getByText(/Tap a verse in the reader/i)).toBeTruthy();
  });

  it('renders the reference, language badge, and word rows (RTL for Hebrew)', () => {
    useVerseLexicon.mockReturnValue({
      words: [{ position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning' }],
      language: 'hebrew', loading: false, error: null,
    });
    render(<OriginalLanguagePanel verseId="gen.1.1" reference="Genesis 1:1" />);
    expect(screen.getByText('Genesis 1:1')).toBeTruthy();
    expect(screen.getByText('Hebrew')).toBeTruthy();
    const word = screen.getByText('בְּרֵאשִׁית');
    expect(word.getAttribute('dir')).toBe('rtl');
    expect(screen.getByText('H7225')).toBeTruthy();
  });

  it('expands a word to show its morphology and Strong\'s definition', () => {
    useVerseLexicon.mockReturnValue({
      words: [{ position: 1, original: 'θεός', transliteration: 'theos', strongs: 'G2316', morph: 'N-NSM', gloss: 'God' }],
      language: 'greek', loading: false, error: null,
    });
    useStrongsEntry.mockReturnValue({ entry: { strongs: 'G2316', lemma: 'θεός', transliteration: 'theos', pronunciation: 'theh-os', shortDef: 'God', fullDef: 'a deity; God', language: 'greek' }, loading: false, error: null });
    render(<OriginalLanguagePanel verseId="jhn.1.1" reference="John 1:1" />);
    fireEvent.click(screen.getByText('θεός'));
    expect(screen.getByText('N-NSM')).toBeTruthy();
    expect(screen.getByText(/a deity; God/)).toBeTruthy();
  });

  it('shows a graceful message when the verse has no lexicon data', () => {
    useVerseLexicon.mockReturnValue({ words: [], language: null, loading: false, error: null });
    render(<OriginalLanguagePanel verseId="gen.1.1" reference="Genesis 1:1" />);
    expect(screen.getByText(/isn.t available for this verse/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/OriginalLanguagePanel.test.tsx`
Expected: FAIL — `Cannot find module './OriginalLanguagePanel'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/notepad/study/lexicon/OriginalLanguagePanel.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useVerseLexicon, type InterlinearWord, type LexiconLanguage } from './useVerseLexicon';
import { useStrongsEntry } from './useStrongsEntry';

const LANGUAGE_LABEL: Record<LexiconLanguage, string> = {
  hebrew: 'Hebrew',
  aramaic: 'Aramaic',
  greek: 'Greek',
};

const ATTRIBUTION = 'Original-language data: STEPBible (TAHOT/TAGNT, CC BY 4.0) + OpenScriptures Strong’s.';
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--silica)', margin: 0 };

export interface OriginalLanguagePanelProps {
  verseId: string | null;
  reference: string | null;
}

export function OriginalLanguagePanel({ verseId, reference }: OriginalLanguagePanelProps) {
  const [open, setOpen] = useState(true);
  const { words, language, loading, error } = useVerseLexicon(verseId);

  return (
    <section style={{ marginBottom: 24, borderBottom: '1px solid var(--pale-stone)', paddingBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />}
        <span style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)' }}>ORIGINAL LANGUAGE</span>
        {language && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{LANGUAGE_LABEL[language]}</span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {verseId == null && (
            <p style={{ ...muted, fontStyle: 'italic' }}>Tap a verse in the reader to see its Hebrew &amp; Greek.</p>
          )}
          {verseId != null && loading && <p style={muted}>Loading…</p>}
          {verseId != null && !loading && error && <p style={muted}>Couldn&apos;t load original-language data.</p>}
          {verseId != null && !loading && !error && words.length === 0 && (
            <p style={muted}>Original-language data isn&apos;t available for this verse.</p>
          )}
          {verseId != null && !loading && !error && words.length > 0 && (
            <>
              {reference && <div style={{ fontSize: 11, color: 'var(--deep-umber)', fontWeight: 600, marginBottom: 8 }}>{reference}</div>}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {words.map((w) => (
                  <WordRow key={w.position} word={w} rtl={language !== 'greek'} />
                ))}
              </ul>
              <p style={{ fontSize: 10, color: 'var(--silica)', margin: '12px 0 0' }}>{ATTRIBUTION}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function WordRow({ word, rtl }: { word: InterlinearWord; rtl: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li style={{ borderRadius: 8, background: 'var(--cream, #F4F1EA)', padding: '6px 8px' }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
      >
        <span dir={rtl ? 'rtl' : 'ltr'} style={{ fontSize: 18, color: 'var(--deep-umber)' }}>{word.original}</span>
        <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--silica)' }}>{word.transliteration}</span>
        <span style={{ fontSize: 11, color: 'var(--deep-umber)' }}>{word.gloss}</span>
        {word.strongs && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--lamplight-accent)', fontWeight: 600 }}>{word.strongs}</span>}
      </button>
      {expanded && (
        <div style={{ marginTop: 6 }}>
          {word.morph && <div style={{ fontSize: 11, color: 'var(--silica)' }}>{word.morph}</div>}
          {word.strongs && <StrongsDefinition strongs={word.strongs} />}
        </div>
      )}
    </li>
  );
}

function StrongsDefinition({ strongs }: { strongs: string }) {
  const { entry, loading, error } = useStrongsEntry(strongs);
  if (loading) return <p style={{ fontSize: 11, color: 'var(--silica)', margin: '4px 0 0' }}>Loading definition…</p>;
  if (error || !entry) return <p style={{ fontSize: 11, color: 'var(--silica)', margin: '4px 0 0' }}>Definition unavailable.</p>;
  return (
    <div style={{ fontSize: 11, color: 'var(--deep-umber)', marginTop: 4, lineHeight: 1.5 }}>
      <strong>{entry.lemma}</strong>{entry.pronunciation ? ` · ${entry.pronunciation}` : ''}
      <div style={{ marginTop: 2 }}>{entry.fullDef || entry.shortDef}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/lexicon/OriginalLanguagePanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/lexicon/OriginalLanguagePanel.tsx src/notepad/study/lexicon/OriginalLanguagePanel.test.tsx
git commit -m "feat(study): OriginalLanguagePanel interlinear dropdown"
```

---

### Task B4: Forward `onSelectVerse` through `StudyReader`

**Files:**
- Modify: `src/notepad/study/panes/StudyReader.tsx`
- Test: `src/notepad/study/panes/StudyReader.test.tsx`

**Interfaces:**
- Consumes: `BibleReader`'s existing `onSelectVerse?: (ref: VerseRef) => void` prop.
- Produces: `StudyReader` accepts `onSelectVerse?: (ref: VerseRef) => void` and forwards it to `BibleReader`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// Add this test to src/notepad/study/panes/StudyReader.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const bibleReaderProps = vi.fn();
vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: Record<string, unknown>) => { bibleReaderProps(props); return null; },
}));
vi.mock('@/notepad/bible/useBibleTranslation', () => ({
  useBibleTranslation: () => ({ translation: 'BSB', setTranslation: vi.fn() }),
}));
import { StudyReader } from './StudyReader';

beforeEach(() => bibleReaderProps.mockReset());

describe('StudyReader onSelectVerse', () => {
  it('forwards onSelectVerse to BibleReader', () => {
    const onSelectVerse = vi.fn();
    render(<StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} onSelectVerse={onSelectVerse} />);
    const props = bibleReaderProps.mock.calls[0][0];
    expect(props.onSelectVerse).toBe(onSelectVerse);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/StudyReader.test.tsx -t "forwards onSelectVerse"`
Expected: FAIL — `props.onSelectVerse` is `undefined`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/notepad/study/panes/StudyReader.tsx
import { BibleReader, type VerseRef } from '@/notepad/bible/BibleReader';
import { useBibleTranslation } from '@/notepad/bible/useBibleTranslation';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
  onSelectVerse?: (ref: VerseRef) => void;
}

export function StudyReader({ book, chapter, onPassageChange, onSelectVerse }: StudyReaderProps) {
  const { translation, setTranslation } = useBibleTranslation();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setTranslation}
      onPassageChange={onPassageChange}
      onSelectVerse={onSelectVerse}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/notepad/study/panes/StudyReader.test.tsx`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/panes/StudyReader.tsx src/notepad/study/panes/StudyReader.test.tsx
git commit -m "feat(study): forward onSelectVerse through StudyReader"
```

---

### Task B5: Render the panel in `ApparatusRail` + lift `selectedVerse` in `StudyWorkspace`

**Files:**
- Modify: `src/notepad/study/panes/ApparatusRail.tsx`
- Test: `src/notepad/study/panes/ApparatusRail.test.tsx`
- Modify: `src/notepad/study/StudyWorkspace.tsx`

**Interfaces:**
- Consumes: `OriginalLanguagePanel` from `../lexicon/OriginalLanguagePanel`; `bookByAbbrev` from `@/notepad/bible/bible-books`.
- Produces: `ApparatusRail` accepts `selectedVerse?: number | null` and renders `OriginalLanguagePanel` above the book apparatus. `StudyWorkspace` owns `selectedVerse` state, resets it on passage change, sets it from `StudyReader.onSelectVerse`, and passes it to `ApparatusRail`.

- [ ] **Step 1: Write the failing test (ApparatusRail)**

```tsx
// Add to src/notepad/study/panes/ApparatusRail.test.tsx (keep existing imports/mocks).
// Append this mock near the top, after the useApparatus mock:
const panelProps = vi.fn();
vi.mock('../lexicon/OriginalLanguagePanel', () => ({
  OriginalLanguagePanel: (props: { verseId: string | null; reference: string | null }) => { panelProps(props); return null; },
}));

describe('ApparatusRail original-language panel', () => {
  it('passes the selected verse to OriginalLanguagePanel as an OSIS verseId + reference', () => {
    panelProps.mockReset();
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    render(<ApparatusRail book="jhn" chapter={3} selectedVerse={16} />);
    expect(panelProps).toHaveBeenCalledWith({ verseId: 'jhn.3.16', reference: 'John 3:16' });
  });

  it('passes null verseId when no verse is selected', () => {
    panelProps.mockReset();
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    render(<ApparatusRail book="jhn" chapter={3} selectedVerse={null} />);
    expect(panelProps).toHaveBeenCalledWith({ verseId: null, reference: null });
  });

  it('still renders the book apparatus alongside the panel', () => {
    panelProps.mockReset();
    useApparatus.mockReturnValue({
      book: { full_name: 'John', author: 'John', author_note: '', date_label: '', region: '', cultural_context: '', genre: '', summary: 'The Word.' },
      crossRefs: [], loading: false, error: null,
    });
    render(<ApparatusRail book="jhn" chapter={3} selectedVerse={null} />);
    expect(screen.getByText('John')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx`
Expected: FAIL — `OriginalLanguagePanel` not rendered / `selectedVerse` prop unused.

- [ ] **Step 3: Write the implementation (ApparatusRail)**

```tsx
// src/notepad/study/panes/ApparatusRail.tsx
import { useApparatus, type CrossRefView } from '../useApparatus';
import { bookByAbbrev } from '@/notepad/bible/bible-books';
import { OriginalLanguagePanel } from '../lexicon/OriginalLanguagePanel';

function refLabel(x: CrossRefView): string {
  const name = bookByAbbrev(x.to_book)?.name ?? x.to_book;
  const verses = x.to_verse_start === x.to_verse_end ? `${x.to_verse_start}` : `${x.to_verse_start}-${x.to_verse_end}`;
  return `${name} ${x.to_chapter}:${verses}`;
}

export interface ApparatusRailProps {
  book: string;
  chapter: number;
  selectedVerse?: number | null;
}

export function ApparatusRail({ book, chapter, selectedVerse = null }: ApparatusRailProps) {
  const { book: ctx, crossRefs, loading, error } = useApparatus(book, chapter);

  const bookName = bookByAbbrev(book)?.name ?? book;
  const verseId = selectedVerse != null ? `${book}.${chapter}.${selectedVerse}` : null;
  const reference = selectedVerse != null ? `${bookName} ${chapter}:${selectedVerse}` : null;

  return (
    <div style={{ padding: 16, fontFamily: 'Outfit, sans-serif' }}>
      <OriginalLanguagePanel verseId={verseId} reference={reference} />

      {loading && <div style={{ color: 'var(--silica)' }}>Loading study context…</div>}
      {error && (
        <div style={{ color: 'var(--silica)' }}>
          Couldn&apos;t load study context. <button onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {!loading && !error && ctx && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: 'var(--deep-umber)', margin: '0 0 8px' }}>{ctx.full_name}</h2>
          <dl style={{ fontSize: 12, color: 'var(--deep-umber)', lineHeight: 1.7, letterSpacing: '0.01em', margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div><strong>Author:</strong> {ctx.author}{ctx.author_note ? ` — ${ctx.author_note}` : ''}</div>
            {ctx.date_label && <div><strong>Date:</strong> {ctx.date_label}</div>}
            {ctx.region && <div><strong>Region:</strong> {ctx.region}</div>}
            {ctx.genre && <div><strong>Genre:</strong> {ctx.genre}</div>}
            {ctx.cultural_context && <p style={{ margin: '4px 0 0' }}>{ctx.cultural_context}</p>}
            {ctx.summary && <p style={{ margin: '4px 0 0' }}>{ctx.summary}</p>}
          </dl>
        </section>
      )}

      {!loading && !error && crossRefs.length > 0 && (
        <section>
          <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>CROSS-REFERENCES</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {crossRefs.map((x, i) => (
              <li key={i} style={{ marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--lamplight-accent)', fontWeight: 600 }}>{refLabel(x)}</span>
                {x.crossesTestament && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--lamplight-accent)' }}>OT ↔ NT</span>}
                {x.text && <div style={{ color: 'var(--deep-umber)', marginTop: 2 }}>{x.text}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the ApparatusRail test to verify it passes**

Run: `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx`
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Wire `selectedVerse` in `StudyWorkspace`**

Apply these three edits to `src/notepad/study/StudyWorkspace.tsx`:

Edit 1 — add `useEffect` to the React import (line 2):
```tsx
import { useCallback, useEffect, useState } from 'react';
```

Edit 2 — after the `passage` state (around line 34), add the selected-verse state + reset effect:
```tsx
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  // Clear the selected verse whenever the passage changes (new book/chapter).
  useEffect(() => { setSelectedVerse(null); }, [passage.book, passage.chapter]);
```

Edit 3 — pass `selectedVerse` to `ApparatusRail` (the `<ApparatusRail .../>` around line 119):
```tsx
              <ApparatusRail book={passage.book} chapter={passage.chapter} selectedVerse={selectedVerse} />
```

Edit 4 — pass `onSelectVerse` to `StudyReader` (the `<StudyReader .../>` around line 132):
```tsx
          <StudyReader
            book={passage.book}
            chapter={passage.chapter}
            onPassageChange={handlePassageChange}
            onSelectVerse={(ref) => setSelectedVerse(ref.verse)}
          />
```

- [ ] **Step 6: Verify the whole study suite + typecheck pass**

Run: `npx vitest run src/notepad/study && npx tsc -b`
Expected: all study tests PASS; `tsc -b` reports no NEW errors (a 4-error pre-existing baseline in `force-sphere.test.ts` is acceptable — confirm the count did not increase).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/study/panes/ApparatusRail.tsx src/notepad/study/panes/ApparatusRail.test.tsx src/notepad/study/StudyWorkspace.tsx
git commit -m "feat(study): render OriginalLanguagePanel from selected verse in Context tab"
```

---

## Manual verification (after Phase A data is loaded)

1. Run the app, open Study mode on John 3, tap verse 16. The Context rail's **Original Language** section shows the Greek interlinear with `θεὸς`-style words, transliterations, glosses, and `G####` chips.
2. Tap a word → its morphology + full Strong's definition expands inline.
3. Navigate to a new chapter → the panel resets to the "Tap a verse…" prompt.
4. Open an OT chapter (e.g. Genesis 1), tap verse 1 → Hebrew words render right-to-left with the **Hebrew** badge.
5. Tap a verse with no ingested data (if any) → "Original-language data isn't available for this verse."

---

## Self-Review

**Spec coverage:**
- Data source / ingest (STEPBible + OpenScriptures) → A1–A3. ✅
- Word-by-word interlinear display (script, translit, Strong's, gloss, morph; tap → full def) → B3. ✅
- Direct client query (no edge fn) → B1/B2 hooks. ✅
- `selectedVerse` lifted to `StudyWorkspace`, forwarded via `StudyReader`, consumed in `ApparatusRail` → B4/B5. ✅
- Reset on passage change → B5 Step 5 effect. ✅
- Panel at top of Context rail → B5 Step 3. ✅
- Empty / loading / missing-data / error states → B3 tests + impl. ✅
- One verse at a time, no AI, RTL Hebrew, attribution → B3. ✅
- Out of scope (ranges, audio, persistence, mobile relayout) → not built. ✅

**Type consistency:** `InterlinearWord` (B1) is consumed unchanged by B3; `LexiconLanguage` shared B1→B2→B3; `StrongsEntry` camelCase (B2) matches `StrongsDefinition` usage (B3); `VerseRef` from `BibleReader` flows StudyReader→StudyWorkspace; `verseId` format `book.chapter.verse` consistent A2 (`stepRefToVerse`) ↔ B5 (`ApparatusRail`) ↔ hooks. ✅

**Placeholder scan:** No TBD/TODO. The one external-format assumption (STEPBible `COL` order) is a real, documented constant with an explicit operator confirmation step in the runbook — not a placeholder. ✅
