# Multiple Bible Translations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the public-domain KJV and WEB translations alongside BSB so readers can choose, search, and quote any of the three.

**Architecture:** `bible_passages` keeps `id` as the pure OSIS reference and changes its primary key to composite `(translation, id)`, so multiple translations of the same verse coexist. A generalized ingest loads KJV/WEB (skipping embeddings). The Voyage semantic index stays BSB-only — semantic search returns a verse *reference*, which is then rendered in the reader's chosen translation ("embed once, display many"). FTS works natively per translation. A central `translations.ts` registry replaces every hardcoded `'BSB'` literal type, a reader dropdown + persisted preference drives the active translation, and inline `/verse` references freeze the active translation at insert.

**Tech Stack:** React + TypeScript (Vite), Supabase (Postgres + RLS + Edge Functions/Deno), Voyage embeddings, Tiptap editor, Vitest.

## Global Constraints

- **Branch:** `feat/bible-translations`, branched off `main`. `main` has migrations through `030`. Per project memory, `031–035` (trgm, bible_books, cross_references, study-folder) live on `feat/study-mode` and are **already applied to prod**. Therefore: number new migrations **`036`+**, and BEFORE pushing, reconcile ordering with study-mode (rebase or renumber) so prod's migration history stays contiguous. Apply via `supabase db push`.
- **Edge functions deploy MANUALLY:** `supabase functions deploy <name> --use-api` (not in CI). A frontend deploy does NOT carry `supabase/functions/**` changes.
- **Typecheck with `tsc -b`** (the real build), NOT bare `tsc --noEmit` (root tsconfig has `files:[]`).
- **Translations are public domain only:** `'BSB' | 'KJV' | 'WEB'`. No copyrighted texts.
- **OSIS key scheme is canonical and shared:** `id` = `{osisBook}.{chapter}.{verse}` (verse grain) or `{osisBook}.{chapter}` (pericope grain). `book` column = lowercase OSIS abbrev. Psalms = `psa`.
- **Pre-existing red baseline:** repo ships with ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), 2 failing test files (`Editor.toolbar-placement`, `garden-scene`) unrelated to this work. Verify changes add ZERO new errors; do not gate on a repo-wide green baseline.
- **Test runner:** `npx vitest run <path>` for a single file.

---

## File Structure

**New files:**
- `supabase/migrations/036_bible_passages_translation_pk.sql` — composite PK
- `supabase/migrations/037_profiles_bible_translation.sql` — preference column
- `src/notepad/bible/translations.ts` — `BibleTranslation` type + registry (id, label, full name, attribution)
- `src/notepad/bible/translations.test.ts`
- `src/notepad/bible/useBibleTranslation.ts` — preference hook (localStorage + optional profile mirror)
- `src/notepad/bible/useBibleTranslation.test.ts`
- `scripts/data/kjv.txt`, `scripts/data/web.txt` — cached source corpora (downloaded by ingest)
- `scripts/bible-parity-check.ts` — OSIS key parity report vs BSB

**Modified files:**
- `scripts/ingest-bsb.ts` → generalized ingest (translation param + skip-embed for non-BSB)
- `src/notepad/bible/useBiblePassages.ts` — translation arg + filter
- `src/notepad/bible/verse-search-client.ts` — `createBrowserVerseSearchDeps(client, translation)`
- `src/notepad/bible/verse-search.ts` — widen translation type on candidate constructors
- `src/notepad/bible/verse-search-types.ts` — `translation: BibleTranslation`
- `src/notepad/graph/reference-parser.ts` — `fetchVerseText` translation option + filter
- `src/notepad/extensions/scripture-ref.ts` — attrs type widen + freeze active translation at insert
- `src/notepad/bible/BibleReader.tsx` — translation dropdown + thread to `useBiblePassages`
- `src/notepad/bible/BibleStudyPane.tsx` — own active-translation state, pass to reader + search deps
- `src/notepad/graph/graph-view.ts:598` — fix vestigial `|| 'WEB'` default
- `supabase/functions/_shared/bible-passage.ts` — translation-aware join helper
- `supabase/functions/_shared/retrieval.ts` — translation param + BSB fallback in bible fetch
- `supabase/functions/_shared/verse-verify.ts` — translation param + BSB fallback
- `supabase/functions/lamplight-generate/index.ts`, `lamplight-chat/index.ts` — pass translation

---

## Task 1: Composite PK migration

**Files:**
- Create: `supabase/migrations/036_bible_passages_translation_pk.sql`

**Interfaces:**
- Produces: `bible_passages` accepts multiple rows per `id` (one per `translation`); PK is `(translation, id)`.

- [ ] **Step 1: Write the migration**

```sql
-- 036_bible_passages_translation_pk.sql
-- Allow multiple translations per verse reference. `id` stays the pure OSIS
-- reference ("jhn.1.1"); `translation` joins it in the primary key so BSB, KJV,
-- and WEB "jhn.1.1" coexist. All existing rows are translation='BSB', so there
-- is no collision and no data rewrite.

alter table public.bible_passages drop constraint bible_passages_pkey;
alter table public.bible_passages add primary key (translation, id);

-- Reads filter by translation then book/chapter (chapter scan) — index the triple.
create index if not exists bible_passages_translation_book_chapter
  on public.bible_passages (translation, book, chapter);
```

- [ ] **Step 2: Verify SQL applies cleanly on a scratch DB**

Run (against a local/scratch Supabase, NOT prod): `supabase db push --dry-run` (or apply to a local instance with `supabase db reset`).
Expected: no error; `\d bible_passages` shows primary key `(translation, id)`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/036_bible_passages_translation_pk.sql
git commit -m "feat(bible): composite (translation, id) PK on bible_passages"
```

> **DO NOT** run `supabase db push` against prod yet — sequence it per Global Constraints after reconciling with study-mode migrations.

---

## Task 2: Generalize the ingest script

Refactor `scripts/ingest-bsb.ts` so the parser and row builder accept any translation, and so non-BSB ingests skip embeddings. Keep BSB behavior byte-identical.

**Files:**
- Modify: `scripts/ingest-bsb.ts`
- Test: `scripts/ingest-bsb.test.ts` (create if absent)

**Interfaces:**
- Consumes: existing `parseBsbText`, `BsbCorpus`, `BOOK_ABBREV`.
- Produces:
  - `type BibleTranslationId = 'BSB' | 'KJV' | 'WEB'`
  - `parseBsbToRows(corpus: BsbCorpus, translation: BibleTranslationId): { verses: PassageRow[]; pericopes: PassageRow[] }`
  - `PassageRow.translation: BibleTranslationId` (widened from `'BSB'`)

- [ ] **Step 1: Write the failing test**

```ts
// scripts/ingest-bsb.test.ts
import { describe, it, expect } from 'vitest';
import { parseBsbText, parseBsbToRows } from './ingest-bsb';

const SAMPLE = `The Holy Bible
preamble line
Verse\tText
John 1:1\tIn the beginning was the Word.
John 1:2\tHe was with God in the beginning.
`;

describe('parseBsbToRows translation param', () => {
  it('stamps the given translation on verse and pericope rows', () => {
    const corpus = parseBsbText(SAMPLE);
    const { verses, pericopes } = parseBsbToRows(corpus, 'KJV');
    expect(verses).toHaveLength(2);
    expect(verses[0]).toMatchObject({ id: 'jhn.1.1', translation: 'KJV', book: 'jhn' });
    expect(pericopes[0]).toMatchObject({ id: 'jhn.1', translation: 'KJV' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run scripts/ingest-bsb.test.ts`
Expected: FAIL — `parseBsbToRows` takes 1 arg / `translation` is `'BSB'`.

- [ ] **Step 3: Widen the type and thread the translation param**

In `scripts/ingest-bsb.ts`:

```ts
export type BibleTranslationId = 'BSB' | 'KJV' | 'WEB';

export interface PassageRow {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  translation: BibleTranslationId;
  text: string;
  pericope_id: string;
}

export function parseBsbToRows(
  corpus: BsbCorpus,
  translation: BibleTranslationId,
): { verses: PassageRow[]; pericopes: PassageRow[] } {
  const verses: PassageRow[] = [];
  const pericopes: PassageRow[] = [];
  for (const book of corpus.books) {
    for (const ch of book.chapters) {
      const pericopeId = `${book.abbrev}.${ch.number}`;
      const verseTexts: string[] = [];
      for (const v of ch.verses) {
        verses.push({
          id: `${book.abbrev}.${ch.number}.${v.number}`,
          book: book.abbrev,
          chapter: ch.number,
          verse_start: v.number,
          verse_end: v.number,
          translation,
          text: v.text,
          pericope_id: pericopeId,
        });
        verseTexts.push(v.text);
      }
      pericopes.push({
        id: pericopeId,
        book: book.abbrev,
        chapter: ch.number,
        verse_start: ch.verses[0]?.number ?? 1,
        verse_end: ch.verses[ch.verses.length - 1]?.number ?? 1,
        translation,
        text: verseTexts.join('\n'),
        pericope_id: pericopeId,
      });
    }
  }
  return { verses, pericopes };
}
```

- [ ] **Step 4: Parameterize `main()` (translation + source + skip-embed)**

Replace the hardcoded constants and `main()` with a translation-driven config. The Supabase upsert `onConflict` MUST become the composite key.

```ts
interface IngestConfig {
  translation: BibleTranslationId;
  url: string;
  cachePath: string;
  embed: boolean; // only BSB embeds (shared semantic index)
}

const SOURCES: Record<BibleTranslationId, IngestConfig> = {
  BSB: { translation: 'BSB', url: 'https://bereanbible.com/bsb.txt', cachePath: 'scripts/data/bsb.txt', embed: true },
  // KJV/WEB sources pinned in Task 3. embed:false — they reuse BSB's semantic index.
  KJV: { translation: 'KJV', url: '', cachePath: 'scripts/data/kjv.txt', embed: false },
  WEB: { translation: 'WEB', url: '', cachePath: 'scripts/data/web.txt', embed: false },
};

async function loadCorpus(cfg: IngestConfig): Promise<BsbCorpus> {
  let text: string;
  if (existsSync(cfg.cachePath)) {
    text = await readFile(cfg.cachePath, 'utf8');
  } else {
    if (!cfg.url) throw new Error(`no cached corpus at ${cfg.cachePath} and no url for ${cfg.translation}`);
    await mkdir('scripts/data', { recursive: true });
    const res = await fetch(cfg.url);
    if (!res.ok) throw new Error(`fetch ${cfg.url}: ${res.status}`);
    text = await res.text();
    await writeFile(cfg.cachePath, text);
  }
  return parseBsbText(text);
}

async function main() {
  const translation = (process.env.TRANSLATION ?? 'BSB') as BibleTranslationId;
  const cfg = SOURCES[translation];
  if (!cfg) throw new Error(`unknown TRANSLATION: ${translation}`);

  const url = required('SUPABASE_URL');
  const key = required('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`loading ${translation} corpus…`);
  const corpus = await loadCorpus(cfg);
  const { verses, pericopes } = parseBsbToRows(corpus, translation);
  const all = [...verses, ...pericopes];
  console.log(`parsed ${verses.length} verses + ${pericopes.length} pericopes = ${all.length} rows`);

  // 1. Upsert bible_passages on the composite key.
  for (let i = 0; i < all.length; i += 500) {
    const batch = all.slice(i, i + 500);
    const { error } = await supabase.from('bible_passages').upsert(batch, { onConflict: 'translation,id' });
    if (error) throw error;
  }
  console.log('bible_passages upserted');

  if (!cfg.embed) {
    console.log(`skip embeddings for ${translation} (shared semantic index = BSB only)`);
    console.log('done');
    return;
  }

  const voyageKey = required('VOYAGE_AI_KEY');
  // ... existing embedding block unchanged (BSB only) ...
}
```

Keep the existing embedding block (`embedDocuments` / `upsertWithRetry` / loop) verbatim below the `if (!cfg.embed)` guard, including the `required('VOYAGE_AI_KEY')` move into the BSB path (it's no longer needed for KJV/WEB).

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run scripts/ingest-bsb.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `tsc -b`
Expected: no NEW errors (the pre-existing `force-sphere.test.ts` errors may remain).

- [ ] **Step 7: Commit**

```bash
git add scripts/ingest-bsb.ts scripts/ingest-bsb.test.ts
git commit -m "feat(bible): generalize ingest for any translation, skip embeddings for non-BSB"
```

---

## Task 3: Pin KJV/WEB sources, ingest, and parity-check (operational)

This task produces DATA, not app code. It is run once per environment by an operator with service-role creds.

**Files:**
- Modify: `scripts/ingest-bsb.ts` (`SOURCES.KJV.url`, `SOURCES.WEB.url`)
- Create: `scripts/bible-parity-check.ts`
- Create (downloaded): `scripts/data/kjv.txt`, `scripts/data/web.txt`

**Interfaces:**
- Consumes: generalized ingest from Task 2.
- Produces: `bible_passages` rows for KJV and WEB.

- [ ] **Step 1: Pin verifiably-public-domain, OSIS-mappable sources**

Requirement: each source must be a verse-per-line corpus whose book names map through `BOOK_ABBREV` (full English names, "Psalm" singular, "Song of Solomon"). Candidate sources (verify license + format before committing the URL):
- **WEB:** eBible.org WEB distribution (public domain). Convert to the BSB TSV shape (`<Book> <Chapter>:<Verse>\t<Text>`) if not already.
- **KJV:** a clean public-domain KJV plaintext (e.g. eBible.org `engkjv` / `kjv`), same TSV shape.

If a source's book names differ (e.g. "Psalms", "Song of Songs", "Revelation of John"), add the aliases to `BOOK_ABBREV` in `scripts/ingest-bsb.ts` rather than mutating the source. Set `SOURCES.KJV.url` and `SOURCES.WEB.url` to the chosen URLs.

> **LOG, do not silently truncate:** if any book name fails to map, the ingest already throws `unknown ... book name`. Fix the alias; never skip a book.

- [ ] **Step 2: Write the parity-check script**

```ts
// scripts/bible-parity-check.ts
// Reports OSIS verse-key differences between a translation and BSB so
// versification gaps surface before launch. Read-only.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRANSLATION=KJV \
//   npx tsx scripts/bible-parity-check.ts
import { createClient } from '@supabase/supabase-js';

async function keysFor(supabase: ReturnType<typeof createClient>, translation: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bible_passages')
      .select('id')
      .eq('translation', translation)
      .like('id', '%.%.%') // verse grain only
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: string }>) keys.add(r.id);
    if (data.length < PAGE) break;
  }
  return keys;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const translation = process.env.TRANSLATION ?? 'KJV';
  const [bsb, other] = await Promise.all([keysFor(supabase, 'BSB'), keysFor(supabase, translation)]);
  const missing = [...bsb].filter((k) => !other.has(k));
  const extra = [...other].filter((k) => !bsb.has(k));
  console.log(`${translation}: ${other.size} verse keys; BSB: ${bsb.size}`);
  console.log(`missing in ${translation} (present in BSB): ${missing.length}`, missing.slice(0, 50));
  console.log(`extra in ${translation} (absent in BSB): ${extra.length}`, extra.slice(0, 50));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run the ingests (operator, against the target DB)**

Run:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRANSLATION=KJV npx tsx scripts/ingest-bsb.ts
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRANSLATION=WEB npx tsx scripts/ingest-bsb.ts
```
Expected: each prints `bible_passages upserted` then `skip embeddings … done`.

- [ ] **Step 4: Run parity checks**

Run:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRANSLATION=KJV npx tsx scripts/bible-parity-check.ts
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRANSLATION=WEB npx tsx scripts/bible-parity-check.ts
```
Expected: counts within a small delta of BSB (~31k verse keys). Record any `missing`/`extra` keys in the PR description — these are the versification edge cases the BSB fallback (Task 13) covers.

- [ ] **Step 5: Commit (script + pinned URLs only; do NOT commit the large corpora unless the repo already tracks `scripts/data/`)**

```bash
git add scripts/bible-parity-check.ts scripts/ingest-bsb.ts
git commit -m "feat(bible): pin KJV/WEB sources + OSIS parity-check script"
```

---

## Task 4: Translations registry + `BibleTranslation` type

**Files:**
- Create: `src/notepad/bible/translations.ts`
- Test: `src/notepad/bible/translations.test.ts`

**Interfaces:**
- Produces:
  - `type BibleTranslation = 'BSB' | 'KJV' | 'WEB'`
  - `const TRANSLATIONS: readonly TranslationInfo[]`
  - `const DEFAULT_TRANSLATION: BibleTranslation = 'BSB'`
  - `function isBibleTranslation(v: unknown): v is BibleTranslation`
  - `function translationInfo(id: BibleTranslation): TranslationInfo`
  - `interface TranslationInfo { id: BibleTranslation; label: string; fullName: string; attribution: string }`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/bible/translations.test.ts
import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, DEFAULT_TRANSLATION, isBibleTranslation, translationInfo } from './translations';

describe('translations registry', () => {
  it('exposes BSB, KJV, WEB with labels and attribution', () => {
    expect(TRANSLATIONS.map((t) => t.id)).toEqual(['BSB', 'KJV', 'WEB']);
    for (const t of TRANSLATIONS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.fullName.length).toBeGreaterThan(0);
      expect(t.attribution.length).toBeGreaterThan(0);
    }
  });
  it('defaults to BSB', () => { expect(DEFAULT_TRANSLATION).toBe('BSB'); });
  it('guards unknown values', () => {
    expect(isBibleTranslation('KJV')).toBe(true);
    expect(isBibleTranslation('NIV')).toBe(false);
    expect(isBibleTranslation(null)).toBe(false);
  });
  it('returns info by id', () => { expect(translationInfo('KJV').fullName).toMatch(/King James/i); });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/bible/translations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

```ts
// src/notepad/bible/translations.ts
export type BibleTranslation = 'BSB' | 'KJV' | 'WEB';

export interface TranslationInfo {
  id: BibleTranslation;
  label: string;     // compact UI label, e.g. "BSB"
  fullName: string;  // e.g. "Berean Standard Bible"
  attribution: string;
}

export const TRANSLATIONS: readonly TranslationInfo[] = [
  { id: 'BSB', label: 'BSB', fullName: 'Berean Standard Bible',
    attribution: 'Berean Standard Bible — public domain.' },
  { id: 'KJV', label: 'KJV', fullName: 'King James Version',
    attribution: 'King James Version (1769) — public domain in the United States. In the United Kingdom the Crown holds perpetual letters patent.' },
  { id: 'WEB', label: 'WEB', fullName: 'World English Bible',
    attribution: 'World English Bible — public domain.' },
];

export const DEFAULT_TRANSLATION: BibleTranslation = 'BSB';

const BY_ID = new Map(TRANSLATIONS.map((t) => [t.id, t]));

export function isBibleTranslation(v: unknown): v is BibleTranslation {
  return typeof v === 'string' && BY_ID.has(v as BibleTranslation);
}

export function translationInfo(id: BibleTranslation): TranslationInfo {
  const info = BY_ID.get(id);
  if (!info) throw new Error(`unknown translation: ${id}`);
  return info;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/bible/translations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/translations.ts src/notepad/bible/translations.test.ts
git commit -m "feat(bible): central translations registry + BibleTranslation type"
```

---

## Task 5: `useBiblePassages` honors translation

**Files:**
- Modify: `src/notepad/bible/useBiblePassages.ts`
- Test: `src/notepad/bible/useBiblePassages.test.ts` (create if absent)

**Interfaces:**
- Consumes: `BibleTranslation` (Task 4).
- Produces: `useBiblePassages(book: string, chapter: number, translation: BibleTranslation): UseBiblePassagesResult` — query gains `.eq('translation', translation)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/bible/useBiblePassages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const calls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase', () => {
  const builder: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'select', 'like', 'order']) builder[m] = vi.fn(() => builder);
  (builder as Record<string, unknown>).eq = vi.fn((col: string, val: unknown) => {
    calls.push({ col, val }); return builder;
  });
  (builder as Record<string, unknown>).then = (res: (v: unknown) => void) =>
    res({ data: [{ id: 'jhn.1.1', verse_start: 1, text: 'In the beginning…' }], error: null });
  return { supabase: builder };
});

import { useBiblePassages } from './useBiblePassages';

describe('useBiblePassages translation filter', () => {
  beforeEach(() => { calls.length = 0; });
  it('filters bible_passages by the given translation', async () => {
    const { result } = renderHook(() => useBiblePassages('jhn', 1, 'KJV'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls).toContainEqual({ col: 'translation', val: 'KJV' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/bible/useBiblePassages.test.ts`
Expected: FAIL — hook takes 2 args / no `.eq('translation', …)`.

- [ ] **Step 3: Add the param and filter**

In `src/notepad/bible/useBiblePassages.ts`:

```ts
import type { BibleTranslation } from './translations';
// ...
export function useBiblePassages(
  book: string,
  chapter: number,
  translation: BibleTranslation,
): UseBiblePassagesResult {
```

In the query, add the translation filter and include it in the effect deps:

```ts
      const { data, error: qErr } = await supabase
        .from('bible_passages')
        .select('id, verse_start, text')
        .eq('translation', translation)
        .like('id', `${book}.${chapter}.%`)
        .order('verse_start', { ascending: true });
```

```ts
  }, [book, chapter, translation]);
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/bible/useBiblePassages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/useBiblePassages.ts src/notepad/bible/useBiblePassages.test.ts
git commit -m "feat(bible): useBiblePassages filters by translation"
```

---

## Task 6: `useBibleTranslation` preference hook (localStorage)

Device-level preference, modeled on the session-storage allow-list pattern. The cross-device profile mirror is added in Task 8.

**Files:**
- Modify: `src/notepad/session/session-storage.ts` (add a guarded key + accessors)
- Create: `src/notepad/bible/useBibleTranslation.ts`
- Test: `src/notepad/bible/useBibleTranslation.test.ts`

**Interfaces:**
- Consumes: `BibleTranslation`, `DEFAULT_TRANSLATION`, `isBibleTranslation`, `TRANSLATIONS` (Task 4); `loadEnum`/`saveEnum` (session-storage).
- Produces:
  - `KEY_BIBLE_TRANSLATION` const + `loadBibleTranslation()` / `saveBibleTranslation(t)` in session-storage.
  - `useBibleTranslation(): { translation: BibleTranslation; setTranslation: (t: BibleTranslation) => void }`

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/bible/useBibleTranslation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBibleTranslation } from './useBibleTranslation';

describe('useBibleTranslation', () => {
  beforeEach(() => localStorage.clear());
  it('defaults to BSB', () => {
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });
  it('persists a new selection across remounts', () => {
    const first = renderHook(() => useBibleTranslation());
    act(() => first.result.current.setTranslation('KJV'));
    const second = renderHook(() => useBibleTranslation());
    expect(second.result.current.translation).toBe('KJV');
  });
  it('ignores a corrupt stored value', () => {
    localStorage.setItem('psalms.bible.translation', 'NIV');
    const { result } = renderHook(() => useBibleTranslation());
    expect(result.current.translation).toBe('BSB');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/bible/useBibleTranslation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add storage accessors**

In `src/notepad/session/session-storage.ts`, add near the other keys:

```ts
const KEY_BIBLE_TRANSLATION = 'psalms.bible.translation';
export { KEY_BIBLE_TRANSLATION };
```

(Reuse the existing `loadEnum`/`saveEnum`; no new read/write helpers needed.)

- [ ] **Step 4: Implement the hook**

```ts
// src/notepad/bible/useBibleTranslation.ts
import { useCallback, useState } from 'react';
import { loadEnum, saveEnum, KEY_BIBLE_TRANSLATION } from '../session/session-storage';
import { type BibleTranslation, DEFAULT_TRANSLATION, TRANSLATIONS } from './translations';

const ALLOWED = TRANSLATIONS.map((t) => t.id) as readonly BibleTranslation[];

export interface UseBibleTranslationResult {
  translation: BibleTranslation;
  setTranslation: (t: BibleTranslation) => void;
}

export function useBibleTranslation(): UseBibleTranslationResult {
  const [translation, setState] = useState<BibleTranslation>(() =>
    loadEnum<BibleTranslation>(KEY_BIBLE_TRANSLATION, ALLOWED, DEFAULT_TRANSLATION),
  );
  const setTranslation = useCallback((t: BibleTranslation) => {
    setState(t);
    saveEnum(KEY_BIBLE_TRANSLATION, t);
  }, []);
  return { translation, setTranslation };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/bible/useBibleTranslation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/session/session-storage.ts src/notepad/bible/useBibleTranslation.ts src/notepad/bible/useBibleTranslation.test.ts
git commit -m "feat(bible): device-level translation preference hook"
```

---

## Task 7: Translation dropdown in `BibleReader`

**Files:**
- Modify: `src/notepad/bible/BibleReader.tsx`
- Modify: `src/notepad/bible/BibleStudyPane.tsx` (owns active translation, passes it down)
- Test: `src/notepad/bible/BibleReader.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `useBibleTranslation` (Task 6), `TRANSLATIONS` (Task 4), `useBiblePassages(book, chapter, translation)` (Task 5).
- Produces: `BibleReaderProps` gains `translation: BibleTranslation` and `onTranslationChange: (t: BibleTranslation) => void`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/notepad/bible/BibleReader.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('./useBiblePassages', () => ({
  useBiblePassages: () => ({ verses: [{ verse: 1, text: 'In the beginning…' }], loading: false, error: null }),
}));
import { BibleReader } from './BibleReader';

describe('BibleReader translation selector', () => {
  it('renders a translation control and reports changes', () => {
    const onTranslationChange = vi.fn();
    render(<BibleReader translation="BSB" onTranslationChange={onTranslationChange} />);
    const select = screen.getByLabelText('Translation') as HTMLSelectElement;
    expect(select.value).toBe('BSB');
    fireEvent.change(select, { target: { value: 'KJV' } });
    expect(onTranslationChange).toHaveBeenCalledWith('KJV');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: FAIL — no `Translation` control / props don't exist.

- [ ] **Step 3: Add props + dropdown + thread to the hook**

In `BibleReader.tsx`, extend props and signature:

```tsx
import { type BibleTranslation } from './translations';
import { TRANSLATIONS } from './translations';
// ...
export interface BibleReaderProps {
  initialBook?: string;
  initialChapter?: number;
  translation: BibleTranslation;
  onTranslationChange: (t: BibleTranslation) => void;
  onPassageChange?: (ref: PassageRef) => void;
  onSelectVerse?: (ref: VerseRef) => void;
  highlightSwatchByVerse?: Record<number, string>;
  onSetHighlight?: (verse: number, swatchId: string) => void;
  onRemoveHighlight?: (verse: number) => void;
}
```

Add `translation` + `onTranslationChange` to the destructured params, then pass translation into the hook:

```tsx
  const { verses, loading, error } = useBiblePassages(book, chapter, translation);
```

In the header (`<div className="flex items-center gap-1">` block, before the prev/next buttons), add:

```tsx
          <select
            aria-label="Translation"
            value={translation}
            onChange={(e) => onTranslationChange(e.target.value as BibleTranslation)}
            className="text-[11px] font-semibold rounded px-1 py-0.5 mr-1 outline-none"
            style={{ color: 'var(--deep-umber)', background: 'transparent', border: '1px solid var(--pale-stone)' }}
          >
            {TRANSLATIONS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
```

- [ ] **Step 4: Wire `BibleStudyPane` to own the active translation**

In `src/notepad/bible/BibleStudyPane.tsx`, call the preference hook and pass it down:

```tsx
import { useBibleTranslation } from './useBibleTranslation';
// inside the component:
const { translation, setTranslation } = useBibleTranslation();
// ...pass to <BibleReader ... translation={translation} onTranslationChange={setTranslation} />
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck (catches any other `BibleReader` call sites needing the new required props)**

Run: `tsc -b`
Expected: if a call site errors (e.g. `StudyReader.tsx`), add `translation`/`onTranslationChange` there too via `useBibleTranslation`. No NEW errors when done.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleStudyPane.tsx src/notepad/bible/BibleReader.test.tsx
git commit -m "feat(bible): translation selector in the reader header"
```

---

## Task 8: Cross-device preference mirror (`profiles.bible_translation`)

**Files:**
- Create: `supabase/migrations/037_profiles_bible_translation.sql`
- Modify: `src/notepad/bible/useBibleTranslation.ts` (hydrate from + write to profile when signed in)
- Modify: `src/notepad/bible/useBibleTranslation.test.ts` (add signed-in cases)

**Interfaces:**
- Consumes: an authenticated Supabase client + `userId`.
- Produces: `useBibleTranslation({ userId?: string | null } = {})` — localStorage stays the synchronous default; when `userId` is set, hydrate from `profiles.bible_translation` and persist there on change.

- [ ] **Step 1: Write the migration**

```sql
-- 037_profiles_bible_translation.sql
-- Per-user default Bible translation (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
alter table public.profiles
  add column bible_translation text not null default 'BSB';
```

Verify `021_protect_privileged_profile_columns.sql` does NOT block this column (it guards privileged columns like `note_count`; a new user-editable column must remain updatable under the existing "Users can update own profile" policy). If 021 uses an explicit allow-list of updatable columns, add `bible_translation` to it.

- [ ] **Step 2: Write the failing test (signed-in hydration + write)**

```ts
// add to src/notepad/bible/useBibleTranslation.test.ts
import { vi } from 'vitest';
// Mock the supabase profile read/write used by the hook (adjust import path to the
// hook's actual client accessor). Assert that mounting with a userId hydrates from
// the profile row and that setTranslation writes profiles.bible_translation.
```

(Write concrete expectations against whatever client accessor the hook uses — see Step 3 for the exact call shape to assert: `from('profiles').select('bible_translation').eq('id', userId).single()` on mount, and `from('profiles').update({ bible_translation }).eq('id', userId)` on change.)

- [ ] **Step 3: Extend the hook**

```ts
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
// ...
export function useBibleTranslation(
  { userId = null }: { userId?: string | null } = {},
): UseBibleTranslationResult {
  const [translation, setState] = useState<BibleTranslation>(() =>
    loadEnum<BibleTranslation>(KEY_BIBLE_TRANSLATION, ALLOWED, DEFAULT_TRANSLATION),
  );

  // Hydrate from the profile when signed in (localStorage is the instant default).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('bible_translation').eq('id', userId).single();
      const remote = data?.bible_translation;
      if (!cancelled && isBibleTranslation(remote)) {
        setState(remote);
        saveEnum(KEY_BIBLE_TRANSLATION, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setTranslation = useCallback((t: BibleTranslation) => {
    setState(t);
    saveEnum(KEY_BIBLE_TRANSLATION, t);
    if (userId && supabase) {
      void supabase.from('profiles').update({ bible_translation: t }).eq('id', userId);
    }
  }, [userId]);

  return { translation, setTranslation };
}
```

Add the `isBibleTranslation` import. Update `BibleStudyPane` (and any other caller) to pass `{ userId }` from its existing auth context.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/notepad/bible/useBibleTranslation.test.ts`
Expected: PASS (anon cases from Task 6 still green; signed-in cases green).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/037_profiles_bible_translation.sql src/notepad/bible/useBibleTranslation.ts src/notepad/bible/useBibleTranslation.test.ts src/notepad/bible/BibleStudyPane.tsx
git commit -m "feat(bible): cross-device translation preference via profiles.bible_translation"
```

---

## Task 9: `fetchVerseText` honors translation

**Files:**
- Modify: `src/notepad/graph/reference-parser.ts`
- Test: `src/notepad/graph/reference-parser.test.ts` (add a case; create if absent)

**Interfaces:**
- Consumes: `BibleTranslation`, `DEFAULT_TRANSLATION` (Task 4).
- Produces: `fetchVerseText(ref, options?: { signal?: AbortSignal; translation?: BibleTranslation })` — filters `bible_passages` by translation (default BSB) and returns that translation in `VerseResult.translation`.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/graph/reference-parser.test.ts (add)
import { describe, it, expect, vi } from 'vitest';
const eqCalls: Array<{ col: string; val: unknown }> = [];
vi.mock('@/lib/supabase', () => {
  const b: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'select', 'in', 'order']) b[m] = vi.fn(() => b);
  (b as Record<string, unknown>).eq = vi.fn((col: string, val: unknown) => { eqCalls.push({ col, val }); return b; });
  (b as Record<string, unknown>).then = (res: (v: unknown) => void) =>
    res({ data: [{ id: 'jhn.3.16', verse_start: 16, text: 'For God so loved…' }], error: null });
  return { supabase: b };
});
import { fetchVerseText } from './reference-parser';

describe('fetchVerseText translation', () => {
  it('filters by translation and echoes it back', async () => {
    eqCalls.length = 0;
    const r = await fetchVerseText('John 3:16', { translation: 'WEB' });
    expect(eqCalls).toContainEqual({ col: 'translation', val: 'WEB' });
    expect(r?.translation).toBe('WEB');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/graph/reference-parser.test.ts`
Expected: FAIL — no translation option / always returns 'BSB'.

- [ ] **Step 3: Thread the option**

In `reference-parser.ts`:

```ts
import { type BibleTranslation, DEFAULT_TRANSLATION } from '../bible/translations';
// ...
export async function fetchVerseText(
  ref: string,
  options?: { signal?: AbortSignal; translation?: BibleTranslation },
): Promise<VerseResult | null> {
  if (!supabase) return null;
  const translation = options?.translation ?? DEFAULT_TRANSLATION;
  const parsed = parseVerseRef(ref);
  if (!parsed) return null;
  const osisBook = BOOK_TO_OSIS[parsed.book];
  if (!osisBook) return null;
  // ...build ids unchanged...
  try {
    let query = supabase
      .from('bible_passages')
      .select('id, verse_start, text')
      .eq('translation', translation)
      .in('id', ids)
      .order('verse_start', { ascending: true });
    if (options?.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    const text = data.map((r) => (r.text as string) ?? '').join(' ').trim();
    if (!text) return null;
    const refSuffix = end !== start ? `${start}-${end}` : `${start}`;
    return { text, reference: `${parsed.book} ${parsed.chapter}:${refSuffix}`, translation };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/graph/reference-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/graph/reference-parser.ts src/notepad/graph/reference-parser.test.ts
git commit -m "feat(bible): fetchVerseText filters by translation"
```

---

## Task 10: Verse-search deps thread the active translation

**Files:**
- Modify: `src/notepad/bible/verse-search-client.ts`
- Test: `src/notepad/bible/verse-search-client.test.ts` (create if absent)

**Interfaces:**
- Consumes: `fetchVerseText(..., { translation })` (Task 9), `BibleTranslation`, `DEFAULT_TRANSLATION`.
- Produces: `createBrowserVerseSearchDeps(client?: SupabaseClient | null, translation?: BibleTranslation): VerseSearchDeps` — `ftsSearch` and `resolvePericope` filter by translation; `fetchVerseText` passes it through. (`semanticSearch` unchanged — BSB-only index; the inserted node's text is normalized to the active translation in Task 11.)

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/bible/verse-search-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createBrowserVerseSearchDeps } from './verse-search-client';

function fakeClient(captured: Array<{ col: string; val: unknown }>) {
  const b: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['from', 'select', 'like', 'textSearch', 'limit', 'order', 'abortSignal']) b[m] = vi.fn(() => b);
  (b as Record<string, unknown>).eq = vi.fn((col: string, val: unknown) => { captured.push({ col, val }); return b; });
  (b as Record<string, unknown>).then = (res: (v: unknown) => void) => res({ data: [], error: null });
  return b as unknown as Parameters<typeof createBrowserVerseSearchDeps>[0];
}

describe('createBrowserVerseSearchDeps translation', () => {
  it('FTS filters by the given translation', async () => {
    const captured: Array<{ col: string; val: unknown }> = [];
    const deps = createBrowserVerseSearchDeps(fakeClient(captured), 'KJV');
    await deps.ftsSearch('love', {});
    expect(captured).toContainEqual({ col: 'translation', val: 'KJV' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/bible/verse-search-client.test.ts`
Expected: FAIL — factory takes 1 arg / FTS uses `'BSB'`.

- [ ] **Step 3: Thread translation through the deps**

In `verse-search-client.ts`:

```ts
import { type BibleTranslation, DEFAULT_TRANSLATION } from './translations';
// ...
export function createBrowserVerseSearchDeps(
  client: SupabaseClient | null = defaultSupabase,
  translation: BibleTranslation = DEFAULT_TRANSLATION,
): VerseSearchDeps {
  return {
    async ftsSearch(query, opts): Promise<RawFtsRow[]> {
      if (!client || !query.trim()) return [];
      let q = client
        .from('bible_passages')
        .select('id, book, chapter, verse_start, verse_end, text')
        .eq('translation', translation)
        .like('id', '%.%.%')
        .textSearch('text_tsv', query, { type: 'websearch' })
        .limit(FTS_LIMIT)
        .order('id', { ascending: true });
      // ...unchanged...
    },
    // semanticSearch unchanged (BSB-only index)
    async resolvePericope(pericopeId, opts): Promise<PericopeRange | null> {
      // ...
      let q = client
        .from('bible_passages')
        .select('chapter, verse_start, verse_end, text')
        .eq('pericope_id', pericopeId)
        .eq('translation', translation)
        .order('verse_start', { ascending: true });
      // ...unchanged...
    },
    fetchVerseText: (ref, o) => fetchVerseText(ref, { ...o, translation }),
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/bible/verse-search-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/verse-search-client.ts src/notepad/bible/verse-search-client.test.ts
git commit -m "feat(bible): verse-search deps filter by active translation"
```

---

## Task 11: Inline `scriptureRef` freezes the active translation at insert

Widen the `BibleTranslation` type across candidate constructors and the node attrs, stamp the active translation at insert, and fix the vestigial `'WEB'` default.

**Files:**
- Modify: `src/notepad/bible/verse-search-types.ts` (`VerseCandidate.translation: BibleTranslation`)
- Modify: `src/notepad/bible/verse-search.ts` (constructors take/emit the active translation)
- Modify: `src/notepad/extensions/scripture-ref.ts` (attrs type widen; insert stamps active translation)
- Modify: `src/notepad/graph/graph-view.ts:598` (replace `|| 'WEB'` with the real translation)
- Test: `src/notepad/extensions/scripture-ref.test.ts` (add an insert-translation case)

**Interfaces:**
- Consumes: `BibleTranslation`, `DEFAULT_TRANSLATION` (Task 4).
- Produces: `ScriptureRefOptions` gains `translation: BibleTranslation`; `insertScriptureRef` writes `translation` from options (not a literal). `referenceCandidate`, `normalizeFtsRow`, `normalizeSemanticRow` accept the active `translation` so a candidate's `translation` reflects its source text.

- [ ] **Step 1: Write the failing test**

```ts
// src/notepad/extensions/scripture-ref.test.ts (add)
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScriptureRef } from './scripture-ref';

describe('scriptureRef freezes active translation', () => {
  it('stamps the option translation on inserted nodes', () => {
    const editor = new Editor({
      extensions: [StarterKit, ScriptureRef.configure({ search: null, translation: 'KJV' })],
    });
    editor.commands.insertScriptureRef({
      osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      translation: 'KJV', text: 'For God so loved the world…',
    });
    const json = editor.getJSON();
    const node = JSON.stringify(json);
    expect(node).toContain('"translation":"KJV"');
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/extensions/scripture-ref.test.ts`
Expected: FAIL — `configure({ translation })` not accepted / insert hardcodes `'BSB'`.

- [ ] **Step 3: Widen the shared candidate type**

In `verse-search-types.ts`:

```ts
import type { BibleTranslation } from './translations';
// in VerseCandidate:
  translation: BibleTranslation;
```

- [ ] **Step 4: Thread translation into candidate constructors**

In `verse-search.ts`, add a `translation` parameter (default `DEFAULT_TRANSLATION`) to `referenceCandidate`, `normalizeFtsRow`, and `normalizeSemanticRow`, replacing each `translation: 'BSB'` literal with the param. Update `createVerseSearch`/`completeReference` to pass it where they build candidates. Example for `normalizeFtsRow`:

```ts
import { type BibleTranslation, DEFAULT_TRANSLATION } from './translations';

export function normalizeFtsRow(row: RawFtsRow, translation: BibleTranslation = DEFAULT_TRANSLATION): VerseCandidate {
  return { /* ...unchanged... */ translation, source: 'fts', score: FTS_SCORE };
}
```

Apply the same pattern to `referenceCandidate(parsed, text, translation = DEFAULT_TRANSLATION)` and `normalizeSemanticRow(row, opts)` (add `translation` to `opts`). At each call site inside `createVerseSearch`/the builders in `scripture-ref.ts`, pass the deps' active translation. (Where the builder lacks the translation, default keeps BSB — safe.)

- [ ] **Step 5: Widen node attrs + stamp at insert**

In `scripture-ref.ts`:

```ts
import { type BibleTranslation, DEFAULT_TRANSLATION } from '../bible/translations';

export interface ScriptureRefOptions {
  search: VerseSearchDeps | null;
  translation: BibleTranslation;
}
export interface ScriptureRefAttrs {
  osis: string; book: string; chapter: number; verseStart: number;
  verseEnd: number | null; translation: BibleTranslation; text: string;
}
// addOptions:
  addOptions() { return { search: null, translation: DEFAULT_TRANSLATION }; },
```

In `addProseMirrorPlugins`, capture the option and use it in `insertFromCandidate`:

```ts
    const translation = this.options.translation;
    // ...
        .insertScriptureRef({
          osis: c.osis, book: c.book, chapter: c.chapter,
          verseStart: c.verseStart, verseEnd: c.verseEnd,
          translation,            // freeze the active translation
          text: c.text,
        })
```

Leave the `translation` attribute's `default: 'BSB'` and `parseHTML` fallback as-is (existing notes/HTML without `data-translation` correctly read back as BSB).

- [ ] **Step 6: Fix the vestigial `'WEB'` default**

In `src/notepad/graph/graph-view.ts:598`, replace:

```ts
            translation: node.scriptureTranslation || 'WEB',
```

with the real value (BSB is the safe canonical default now that `'WEB'` is a real translation):

```ts
            translation: node.scriptureTranslation || 'BSB',
```

- [ ] **Step 7: Wire the editor to pass the active translation**

Find where `ScriptureRef.configure({ search })` is wired (the editor setup that builds `createBrowserVerseSearchDeps`). Pass both the translation-aware deps AND the option:

```ts
ScriptureRef.configure({
  search: createBrowserVerseSearchDeps(supabase, translation),
  translation,
})
```

(`translation` comes from `useBibleTranslation` at the editor's mount; thread it through the editor's props/context the same way other per-user settings are.)

- [ ] **Step 8: Run the test + typecheck**

Run: `npx vitest run src/notepad/extensions/scripture-ref.test.ts && tsc -b`
Expected: test PASS; `tsc -b` surfaces any remaining `'BSB'`-literal mismatches (e.g. `node-peek-data.ts`, `use-verse-tooltip.ts`) — widen those to `BibleTranslation`/`string` as needed. No NEW errors.

- [ ] **Step 9: Commit**

```bash
git add src/notepad/bible/verse-search-types.ts src/notepad/bible/verse-search.ts src/notepad/extensions/scripture-ref.ts src/notepad/graph/graph-view.ts src/notepad/extensions/scripture-ref.test.ts
git commit -m "feat(bible): inline scripture refs freeze the active translation at insert"
```

---

## Task 12: Lamplight retrieval renders the chosen translation (edge functions)

Thread a `translation` through the bible-passage join helpers with a BSB fallback, so the AI quotes the reader's version. The embeddings/semantic match stays BSB-only; only the TEXT fetched for the matched references changes.

**Files:**
- Modify: `supabase/functions/_shared/bible-passage.ts`
- Modify: `supabase/functions/_shared/retrieval.ts` (`rerankBibleRows` fetch)
- Modify: `supabase/functions/_shared/verse-verify.ts` (verify fetch)
- Modify: `supabase/functions/lamplight-generate/index.ts:220`, `supabase/functions/lamplight-chat/index.ts:126,197,235`
- Test: `supabase/functions/_shared/bible-passage.test.ts`, `_shared/retrieval.test.ts` (extend)

**Interfaces:**
- Produces: a translation-aware bible-text fetch: given a set of OSIS `id`s and a `translation`, return text in that translation, falling back to BSB for any id missing in it.

- [ ] **Step 1: Write the failing test (fallback behavior)**

```ts
// supabase/functions/_shared/bible-passage.test.ts (add or create)
import { describe, it, expect } from 'vitest';
import { fetchPassageText } from './bible-passage.ts';

// Fake supabase: returns KJV for jhn.3.16 only; BSB for both ids.
function fakeSupabase() {
  return {
    from() {
      return {
        select() { return this; },
        in(_col: string, ids: string[]) { this._ids = ids; return this; },
        eq(_col: string, val: string) { this._t = val; return this; },
        async then(res: (v: unknown) => void) {
          const t = (this as Record<string, string>)._t;
          const ids = (this as Record<string, string[]>)._ids;
          const rows = ids
            .filter((id) => (t === 'KJV' ? id === 'jhn.3.16' : true))
            .map((id) => ({ id, text: `${t}:${id}`, book: 'jhn', chapter: 3, verse_start: 16, verse_end: 16 }));
          res({ data: rows, error: null });
        },
      };
    },
  };
}

describe('fetchPassageText fallback', () => {
  it('uses the chosen translation, falling back to BSB per-id', async () => {
    const byId = await fetchPassageText(fakeSupabase() as never, ['jhn.3.16', 'jhn.3.17'], 'KJV');
    expect(byId.get('jhn.3.16')?.text).toBe('KJV:jhn.3.16');
    expect(byId.get('jhn.3.17')?.text).toBe('BSB:jhn.3.17'); // fell back
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run supabase/functions/_shared/bible-passage.test.ts`
Expected: FAIL — `fetchPassageText` not exported.

- [ ] **Step 3: Add the fallback fetch helper**

In `supabase/functions/_shared/bible-passage.ts`:

```ts
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'; // match the file's existing import style

export async function fetchPassageText(
  supabase: SupabaseClient,
  ids: string[],
  translation: string,
): Promise<Map<string, BiblePassageRow>> {
  const byId = new Map<string, BiblePassageRow>();
  if (ids.length === 0) return byId;

  const pull = async (t: string, need: string[]) => {
    if (need.length === 0) return;
    const { data, error } = await supabase
      .from('bible_passages')
      .select('id, book, chapter, verse_start, verse_end, text')
      .eq('translation', t)
      .in('id', need);
    if (error) throw error;
    for (const r of (data ?? []) as BiblePassageRow[]) byId.set(r.id, r);
  };

  await pull(translation, ids);
  if (translation !== 'BSB') {
    const missing = ids.filter((id) => !byId.has(id));
    await pull('BSB', missing); // versification fallback
  }
  return byId;
}
```

- [ ] **Step 4: Use the helper in the consumers**

- `retrieval.ts` `rerankBibleRows`: replace the inline `.from('bible_passages').select('id, text').in('id', sourceIds)` with `fetchPassageText(deps.supabase, sourceIds, translation)` (thread a `translation` arg into `rerankBibleRows` and its caller; default `'BSB'`).
- `lamplight-generate/index.ts:220` and `lamplight-chat/index.ts:126,197,235`: pass the request's translation (from the body — see Step 5) into the passage fetch, swapping each ad-hoc `bible_passages` select for `fetchPassageText` (or adding `.eq('translation', translation)` + a BSB fallback for the cross-ref join at line 235).

- [ ] **Step 5: Accept `translation` on the request body**

In `lamplight-generate` and `lamplight-chat` request parsing, read an optional `translation` (validate against `'BSB'|'KJV'|'WEB'`, default `'BSB'`). On the client, add `translation` to the `functions.invoke(...)` bodies for these calls (from `useBibleTranslation`). The `verse-search` semantic function needs NO translation (it returns references only).

- [ ] **Step 6: Run tests + typecheck the functions**

Run: `npx vitest run supabase/functions/_shared/bible-passage.test.ts supabase/functions/_shared/retrieval.test.ts`
Expected: PASS. Also `tsc -b` for the app side.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/bible-passage.ts supabase/functions/_shared/retrieval.ts supabase/functions/_shared/verse-verify.ts supabase/functions/lamplight-generate/index.ts supabase/functions/lamplight-chat/index.ts supabase/functions/_shared/bible-passage.test.ts
git commit -m "feat(bible): Lamplight quotes the chosen translation with BSB fallback"
```

- [ ] **Step 8: Deploy the edge functions (operator, manual)**

Run:
```bash
supabase functions deploy lamplight-generate --use-api
supabase functions deploy lamplight-chat --use-api
```
Expected: deploy succeeds. (CI does NOT deploy functions.)

---

## Task 13: Attribution affordance near the selector

**Files:**
- Modify: `src/notepad/bible/BibleReader.tsx` (a small info line/tooltip showing `translationInfo(translation).attribution`)
- Test: `src/notepad/bible/BibleReader.test.tsx` (extend)

**Interfaces:**
- Consumes: `translationInfo` (Task 4).

- [ ] **Step 1: Write the failing test**

```tsx
// add to BibleReader.test.tsx
it('exposes the active translation attribution', () => {
  render(<BibleReader translation="KJV" onTranslationChange={() => {}} />);
  expect(screen.getByLabelText('Translation')
    .closest('div')!.querySelector('[title]')!.getAttribute('title')).toMatch(/public domain/i);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: FAIL — no attribution element.

- [ ] **Step 3: Add the attribution affordance**

Next to the `<select>` in the header, add an info marker carrying the attribution as a tooltip:

```tsx
import { translationInfo } from './translations';
import { Info } from 'lucide-react';
// ...
          <span title={translationInfo(translation).attribution} aria-label="Translation info">
            <Info className="w-3 h-3" style={{ color: 'var(--silica)' }} />
          </span>
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleReader.test.tsx
git commit -m "feat(bible): show translation attribution by the selector"
```

---

## Task 14: Full-suite verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the bible-related test suite**

Run: `npx vitest run src/notepad/bible src/notepad/graph src/notepad/extensions scripts/ingest-bsb.test.ts`
Expected: all green; the only failures anywhere are the pre-existing `Editor.toolbar-placement` / `garden-scene` files (NOT touched here).

- [ ] **Step 2: Typecheck**

Run: `tsc -b`
Expected: no NEW errors beyond the pre-existing `force-sphere.test.ts` baseline.

- [ ] **Step 3: Manual smoke (after migrations applied + ingest run + functions deployed)**

Checklist:
- Reader: switch BSB → KJV → WEB; chapter text changes; book/chapter nav unaffected.
- Highlights: highlight a verse in BSB, switch to KJV — highlight persists (same `verse_id`).
- `/verse` picker: insert a ref while KJV active; node shows `· KJV`; switching the reader later does NOT change that note's wording (freeze-at-insert). Existing BSB notes still read `· BSB`.
- Search: keyword search returns results in the active translation; semantic search returns the right references rendered in the active translation.
- Lamplight: with KJV active, the AI quotes KJV (and BSB for any verse missing in KJV).
- Preference: set KJV signed-in on device A; sign in on device B → defaults to KJV.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/bible-translations
gh pr create --title "feat(bible): KJV + WEB translations" --body "Implements docs/superpowers/specs/2026-06-20-multiple-bible-translations-design.md. Migrations 036/037 must be reconciled with feat/study-mode's 031–035 before db push."
```

---

## Self-Review

**Spec coverage:**
- §1 composite PK → Task 1 ✓
- §2 generalized ingest + parity → Tasks 2, 3 ✓
- §3 shared semantic index (FTS per-translation, semantic BSB-only, Lamplight + BSB fallback) → Tasks 5, 10, 12 ✓
- §4 registry, `useBiblePassages`, dropdown, preference hook + profile column → Tasks 4, 5, 6, 7, 8 ✓
- §5 freeze-at-insert + vestigial `'WEB'` fix → Tasks 9, 10, 11 ✓
- §6 versification → parity check (Task 3) + BSB fallback (Task 12) ✓
- §7 attribution → Task 4 (strings) + Task 13 (UI) ✓
- Rollout order / Testing → Tasks 1–3 ordering, Task 14 ✓

**Placeholder scan:** Task 3 deliberately defers exact source URLs to operator verification (license-gating) and Task 8/12 reference the caller's existing auth/translation context — these are integration points, not unfilled code. Concrete code is shown for every behavioral change.

**Type consistency:** `BibleTranslation` (Task 4) is the single widened type used in Tasks 5, 7, 9, 10, 11, plus `BibleTranslationId` (the script-local alias in `ingest-bsb.ts`, Task 2, kept separate because scripts don't import from `src/`). `fetchPassageText(supabase, ids, translation)` (Task 12) is consistent across its consumers. `useBibleTranslation` signature evolves from `()` (Task 6) to `({ userId })` (Task 8) — Task 8 explicitly updates callers.
