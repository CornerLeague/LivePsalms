# Scripture Focus List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `☰ Focus` toggle to the Bible pane that swaps the current chapter for a user-curated, ordered list of verses (saved or a zero-friction Quick list), built for following along in a church service.

**Architecture:** A new `src/notepad/bible/focus/` module holds pure logic (reference parser, verse-text assembler), a persistence adapter pair (in-memory + Supabase, mirroring `highlights/`), the `useScriptureFocusLists` orchestration hook, and three presentational components. `BibleReader` gains one **optional** `focus` bridge prop (toggle + body render-prop + per-verse add) so its other consumer (`StudyReader`) is untouched. `BibleStudyPane` owns the hook and wires the components; because both desktop (`StudyWindow`) and mobile (`MobileNotepadWorkspace`) render the same `BibleStudyPane`, both surfaces get Focus with no separate mobile wiring.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react (jsdom), Supabase (Postgres + RLS), Tailwind utility classes + CSS custom properties, lucide-react icons, sonner toasts.

## Global Constraints

- **Zero-new-errors, not green baseline:** the repo ships ~114 lint errors, 4 tsc errors (`force-sphere.test.ts`), and 2 failing test files (`Editor.toolbar-placement`, `garden-scene`) UNRELATED to this work. Every task must add **zero new** lint/tsc/test errors; do NOT gate on a repo-wide green.
- **Typecheck with `tsc -b`** (the real build command), NOT bare `tsc --noEmit` (root tsconfig has `files:[]` and checks nothing).
- **Migrations apply via `supabase db push`** (history is in sync; only new migrations are pending). Latest existing migration is `041`; this feature adds `042`.
- **Translation-agnostic storage:** focus items store the *reference* (OSIS book abbrev + chapter + verse range) and a denormalized display `label`, never verse text. Text is fetched live per the active translation so one list reads in BSB / KJV / WEB.
- **OSIS id format:** `bible_passages.id` is `book.chapter.verse` (e.g. `jhn.3.16`); `book` is the lowercase OSIS abbrev from `bible-books.ts` (e.g. `eph`, `psa`). Verse-grain rows match `LIKE 'book.chapter.%'` (≥2 dots); the pericope aggregate row (`book.chapter`, 1 dot) is excluded by that pattern.
- **Migration FK target:** mirror `027_bible_highlights.sql` exactly — `user_id uuid references public.profiles(id) on delete cascade`, RLS via `auth.uid() = user_id`. (NOT `auth.users`; the spec snippet was wrong.)
- **Commit trailers** (the repo's convention for this work):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq
  ```
- **Do NOT touch** the pre-existing staged deletion `D Lamplight_AI_details.md` or the untracked `docs/superpowers/plans/2026-06-26-study-region-map.md`.

## File Structure

**New module — `src/notepad/bible/focus/`:**

| File | Responsibility |
|------|----------------|
| `focus-list-types.ts` | `ScriptureRef`, `FocusListItem`, `FocusList`, `FocusListAdapter` interface, `QUICK_LIST_ID` sentinel, pure `formatVerseLabel()`. |
| `reference-parser.ts` | `parseReferences(input)` → `{ refs, unparsed }`; tolerant name/abbrev → OSIS resolver built on `bible-books.ts`. |
| `in-memory-focus-list-adapter.ts` | Map-backed `FocusListAdapter` — the tested reference implementation of the CRUD/ordering contract + the hook's test double. |
| `supabase-focus-list-adapter.ts` | Production signed-in `FocusListAdapter` over the two `042` tables (thin; mirrors `highlights/supabase-bible-highlight-adapter.ts`). |
| `useFocusListVerseText.ts` | Pure `assembleFocusItemTexts()` + the hook that batch-fetches `bible_passages` per (book, chapter) and assembles per-item lines, flagging missing-in-translation. |
| `useScriptureFocusLists.ts` | Orchestration hook: saved lists, Quick list, `activeListId`, `focusModeOn`, all mutators; optimistic + rollback; localStorage persistence. |
| `AddVersePanel.tsx` | Type/paste tab (parser) + Search tab (`createVerseSearch`). |
| `FocusListSwitcher.tsx` | List switcher — dropdown (desktop) / bottom sheet (mobile) via `useIsMobile`. |
| `FocusListView.tsx` | Focus-mode body: control row (switcher + Add + Edit + count) + verse stack + edit reorder/remove + empty state. |

**Modified:**

- `src/notepad/bible/BibleReader.tsx` — add optional `focus?: BibleReaderFocusBridge` prop: toggle button in the header cluster, body branch to `focus.renderFocusBody()`, per-verse add affordance in browse mode.
- `src/notepad/bible/BibleStudyPane.tsx` — instantiate `useScriptureFocusLists`, build search deps, pass the `focus` bridge to `BibleReader`.
- `src/notepad/session/session-storage.ts` — add `KEY_FOCUS_MODE`, `KEY_FOCUS_ACTIVE_LIST`, `KEY_QUICK_LIST` constants + load/save helpers.

**New migration:** `supabase/migrations/042_scripture_focus_lists.sql`.

## Canonical Interfaces (defined once, referenced by every task)

```ts
// focus-list-types.ts
export const QUICK_LIST_ID = '__quick__';

export interface ScriptureRef {
  book: string;        // OSIS abbrev, e.g. 'eph'
  chapter: number;
  verseStart: number;
  verseEnd: number;    // === verseStart for a single verse
  label: string;       // denormalized display, e.g. 'Ephesians 2:8'
}
export interface FocusListItem extends ScriptureRef {
  id: string;
  position: number;
}
export interface FocusList {
  id: string;
  title: string;
  position: number;
  items: FocusListItem[];
}
export interface FocusListAdapter {
  listLists(): Promise<FocusList[]>;
  createList(title: string, refs: ScriptureRef[]): Promise<FocusList>;
  deleteList(id: string): Promise<void>;
  addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]>;
  removeItem(itemId: string): Promise<void>;
  reorderItems(listId: string, orderedItemIds: string[]): Promise<void>;
}
export function formatVerseLabel(name: string, chapter: number, verseStart: number, verseEnd: number): string;

// reference-parser.ts
export interface ParseResult { refs: ScriptureRef[]; unparsed: string[]; }
export function parseReferences(input: string): ParseResult;

// useFocusListVerseText.ts
export interface FocusVerseLine { verse: number; text: string; }
export interface FocusItemText { item: FocusListItem; lines: FocusVerseLine[]; missing: boolean; }
export function assembleFocusItemTexts(
  items: FocusListItem[],
  rowsByChapter: Map<string, FocusVerseLine[]>, // key = `${book}.${chapter}`
): FocusItemText[];
export function useFocusListVerseText(
  items: FocusListItem[],
  translation: BibleTranslation,
): { itemTexts: FocusItemText[]; loading: boolean };

// useScriptureFocusLists.ts
export interface UseScriptureFocusListsResult {
  focusModeOn: boolean;
  toggleFocusMode: () => void;
  savedLists: FocusList[];
  quickList: FocusList;
  activeListId: string;
  activeList: FocusList;                         // resolved; falls back to quickList
  canSave: boolean;                              // signed-in (adapter present)
  selectList: (id: string) => void;
  newList: (title: string) => Promise<void>;
  saveQuickList: (title: string) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  addRefs: (refs: ScriptureRef[]) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  reorderItem: (itemId: string, direction: 'up' | 'down') => Promise<void>;
}
export interface UseScriptureFocusListsOptions { adapterOverride?: FocusListAdapter | null; }
export function useScriptureFocusLists(opts?: UseScriptureFocusListsOptions): UseScriptureFocusListsResult;

// BibleReader.tsx
export interface BibleReaderFocusBridge {
  focusModeOn: boolean;
  onToggleFocusMode: () => void;
  activeList: FocusList | null;
  onAddCurrentVerse: (ref: ScriptureRef) => void;
  renderFocusBody: () => React.ReactNode;
}
```

**v1 YAGNI cuts (explicitly out):** rename of saved lists, reorder of lists (only items reorder), per-verse notes, sharing/export, mixed-translation lists, `scriptureRef`-node import. Duplicates are allowed (no dedupe). A chapter-only reference with no verse is treated as `unparsed`.

---

### Task 1: Migration `042_scripture_focus_lists.sql`

Two owner-scoped tables. FK + RLS mirror `027_bible_highlights.sql` exactly (`profiles(id)`, `auth.uid() = user_id`).

**Files:**
- Create: `supabase/migrations/042_scripture_focus_lists.sql`

**Interfaces:**
- Produces: tables `public.scripture_focus_lists` and `public.scripture_focus_list_items` consumed by Task 5 (`SupabaseFocusListAdapter`).

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/042_scripture_focus_lists.sql`:

```sql
-- supabase/migrations/042_scripture_focus_lists.sql
-- Per-user Scripture Focus Lists: a curated, ordered set of verses pulled up as a
-- clean reading stack (e.g. following along in a church service). Items store the
-- REFERENCE + a denormalized label, never verse text -- text is fetched live per
-- the active translation. Owner-only RLS mirrors 027_bible_highlights.sql
-- (auth.uid() = user_id; user_id references public.profiles, not auth.users).
create table if not exists public.scripture_focus_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.scripture_focus_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.scripture_focus_lists(id) on delete cascade,
  book        text not null,        -- OSIS abbrev, e.g. 'eph'
  chapter     integer not null,
  verse_start integer not null,
  verse_end   integer not null,     -- = verse_start for a single verse
  label       text not null,        -- denormalized display ref, e.g. 'Ephesians 2:8'
  position    integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists scripture_focus_lists_user_idx
  on public.scripture_focus_lists (user_id, position);
create index if not exists scripture_focus_list_items_list_idx
  on public.scripture_focus_list_items (list_id, position);

alter table public.scripture_focus_lists enable row level security;
alter table public.scripture_focus_list_items enable row level security;

-- Lists: owner-only on every verb.
create policy "Users can view own focus lists"
  on public.scripture_focus_lists for select using (auth.uid() = user_id);
create policy "Users can insert own focus lists"
  on public.scripture_focus_lists for insert with check (auth.uid() = user_id);
create policy "Users can update own focus lists"
  on public.scripture_focus_lists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own focus lists"
  on public.scripture_focus_lists for delete using (auth.uid() = user_id);

-- Items: scoped through the parent list's owner.
create policy "Users can view own focus list items"
  on public.scripture_focus_list_items for select
  using (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "Users can insert own focus list items"
  on public.scripture_focus_list_items for insert
  with check (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "Users can update own focus list items"
  on public.scripture_focus_list_items for update
  using (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "Users can delete own focus list items"
  on public.scripture_focus_list_items for delete
  using (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
```

- [ ] **Step 2: Verify the SQL parses (dry run)**

Run: `supabase db push --dry-run`
Expected: lists `042_scripture_focus_lists.sql` as the only pending migration, no syntax errors. (Do NOT apply yet — application happens in Task 14 after the code lands, so a half-built feature never points at a live table.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_scripture_focus_lists.sql
git commit -m "feat(bible): migration 042 — scripture focus lists tables + RLS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 2: `focus-list-types.ts` — types + label helper

**Files:**
- Create: `src/notepad/bible/focus/focus-list-types.ts`
- Test: `src/notepad/bible/focus/focus-list-types.test.ts`

**Interfaces:**
- Produces: `ScriptureRef`, `FocusListItem`, `FocusList`, `FocusListAdapter`, `QUICK_LIST_ID`, `formatVerseLabel()` (see Canonical Interfaces). Consumed by every later task.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/focus-list-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatVerseLabel, QUICK_LIST_ID } from './focus-list-types';

describe('formatVerseLabel', () => {
  it('formats a single verse as "Name chapter:verse"', () => {
    expect(formatVerseLabel('Ephesians', 2, 8, 8)).toBe('Ephesians 2:8');
  });

  it('formats a range as "Name chapter:start-end"', () => {
    expect(formatVerseLabel('Psalm', 23, 1, 3)).toBe('Psalm 23:1-3');
  });

  it('treats verseEnd === verseStart as a single verse (no range dash)', () => {
    expect(formatVerseLabel('John', 3, 16, 16)).toBe('John 3:16');
  });
});

describe('QUICK_LIST_ID', () => {
  it('is a stable sentinel string', () => {
    expect(QUICK_LIST_ID).toBe('__quick__');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/focus-list-types.test.ts`
Expected: FAIL — `Cannot find module './focus-list-types'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/focus-list-types.ts`:

```ts
// Types + the persistence contract for Scripture Focus Lists. Items are
// translation-agnostic: they store the reference + a denormalized display label,
// never verse text (text is fetched live per the active translation).

/** Sentinel id for the unsaved, in-memory Quick list. */
export const QUICK_LIST_ID = '__quick__';

export interface ScriptureRef {
  /** OSIS abbrev, e.g. 'eph' (see bible-books.ts). */
  book: string;
  chapter: number;
  verseStart: number;
  /** === verseStart for a single verse. */
  verseEnd: number;
  /** Denormalized display reference, e.g. 'Ephesians 2:8' or 'Psalm 23:1-3'. */
  label: string;
}

export interface FocusListItem extends ScriptureRef {
  id: string;
  position: number;
}

export interface FocusList {
  id: string;
  title: string;
  position: number;
  items: FocusListItem[];
}

/** CRUD + ordering contract. Two implementations: in-memory (tested) + Supabase. */
export interface FocusListAdapter {
  listLists(): Promise<FocusList[]>;
  createList(title: string, refs: ScriptureRef[]): Promise<FocusList>;
  deleteList(id: string): Promise<void>;
  /** Append items after the existing ones; `startPosition` = current item count. */
  addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]>;
  removeItem(itemId: string): Promise<void>;
  reorderItems(listId: string, orderedItemIds: string[]): Promise<void>;
}

/** Build the denormalized display label for a reference. */
export function formatVerseLabel(
  name: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): string {
  return verseEnd > verseStart
    ? `${name} ${chapter}:${verseStart}-${verseEnd}`
    : `${name} ${chapter}:${verseStart}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/focus-list-types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/focus-list-types.ts src/notepad/bible/focus/focus-list-types.test.ts
git commit -m "feat(bible): focus-list types + label helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 3: `reference-parser.ts` — tolerant reference parser

The highest-value unit-test target. Resolves book names + common abbreviations + numbered books to OSIS abbrevs (built on `bible-books.ts`), parses comma/newline/semicolon batches with single verses or ranges, and reports unparseable fragments.

**Files:**
- Create: `src/notepad/bible/focus/reference-parser.ts`
- Test: `src/notepad/bible/focus/reference-parser.test.ts`

**Interfaces:**
- Consumes: `ScriptureRef`, `formatVerseLabel` (Task 2); `BIBLE_BOOKS`, `BibleBook`, `bookByAbbrev` from `../bible-books`.
- Produces: `parseReferences(input: string): { refs: ScriptureRef[]; unparsed: string[] }` — consumed by `AddVersePanel` (Task 9).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/reference-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseReferences } from './reference-parser';

describe('parseReferences — single references', () => {
  it('parses a plain "Book chapter:verse"', () => {
    const { refs, unparsed } = parseReferences('John 3:16');
    expect(unparsed).toEqual([]);
    expect(refs).toEqual([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
  });

  it('parses a verse range with a hyphen', () => {
    const { refs } = parseReferences('Ps 23:1-3');
    expect(refs).toEqual([
      { book: 'psa', chapter: 23, verseStart: 1, verseEnd: 3, label: 'Psalm 23:1-3' },
    ]);
  });

  it('parses an en-dash range', () => {
    expect(parseReferences('Eph 2:8–9').refs[0]).toMatchObject({ verseStart: 8, verseEnd: 9 });
  });

  it('is case-insensitive on the book name', () => {
    expect(parseReferences('eph 2:8').refs[0].book).toBe('eph');
    expect(parseReferences('EPHESIANS 2:8').refs[0].book).toBe('eph');
  });
});

describe('parseReferences — abbreviations & numbered books', () => {
  it('resolves common abbreviations that are not plain prefixes', () => {
    expect(parseReferences('Jn 3:16').refs[0].book).toBe('jhn');
    expect(parseReferences('Mt 5:9').refs[0].book).toBe('mat');
    expect(parseReferences('Phil 4:13').refs[0].book).toBe('php');   // Philippians, not Philemon
    expect(parseReferences('Phlm 6').refs).toEqual([]);              // chapter-only -> unparsed (see below)
  });

  it('resolves numbered books with and without a space', () => {
    expect(parseReferences('1 Cor 13:4').refs[0].book).toBe('1co');
    expect(parseReferences('1Cor 13:4').refs[0].book).toBe('1co');
    expect(parseReferences('2 Tim 1:7').refs[0].book).toBe('2ti');
    expect(parseReferences('1 Jn 4:8').refs[0].book).toBe('1jn');
  });

  it('accepts the "Psalms" plural alias', () => {
    expect(parseReferences('Psalms 23:1').refs[0].book).toBe('psa');
  });
});

describe('parseReferences — batches', () => {
  it('splits on commas and newlines and keeps order', () => {
    const { refs } = parseReferences('John 3:16, Ps 23:1-3\nEph 2:8-9');
    expect(refs.map((r) => r.label)).toEqual(['John 3:16', 'Psalm 23:1-3', 'Ephesians 2:8-9']);
  });

  it('adds the parseable refs and reports the unparseable fragments', () => {
    const { refs, unparsed } = parseReferences('John 3:16, gibberish, Eph 2:8');
    expect(refs.map((r) => r.label)).toEqual(['John 3:16', 'Ephesians 2:8']);
    expect(unparsed).toEqual(['gibberish']);
  });

  it('ignores empty fragments from trailing/double separators', () => {
    expect(parseReferences('John 3:16, ,\n').unparsed).toEqual([]);
  });
});

describe('parseReferences — rejections', () => {
  it('rejects an unknown book', () => {
    expect(parseReferences('Hesitations 2:8')).toEqual({ refs: [], unparsed: ['Hesitations 2:8'] });
  });

  it('rejects an out-of-range chapter (John has 21)', () => {
    expect(parseReferences('John 99:1').unparsed).toEqual(['John 99:1']);
  });

  it('rejects a chapter-only reference (a verse is required)', () => {
    expect(parseReferences('Genesis 1').unparsed).toEqual(['Genesis 1']);
  });

  it('rejects an inverted range (end < start)', () => {
    expect(parseReferences('John 3:16-2').unparsed).toEqual(['John 3:16-2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/reference-parser.test.ts`
Expected: FAIL — `Cannot find module './reference-parser'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/reference-parser.ts`:

```ts
// Tolerant Scripture-reference parser for the focus-list "type / paste" path.
// Resolves book names, common abbreviations, and numbered books to OSIS abbrevs
// using the canonical bible-books metadata, then parses single verses or ranges
// from a comma/newline/semicolon-separated batch. Unparseable fragments are
// reported (never throw) so the rest of a paste still adds.
import { BIBLE_BOOKS, type BibleBook, bookByAbbrev } from '../bible-books';
import { formatVerseLabel, type ScriptureRef } from './focus-list-types';

export interface ParseResult {
  refs: ScriptureRef[];
  unparsed: string[];
}

// Common abbreviations / spellings that a plain prefix match cannot resolve
// (e.g. "Jn", or ambiguous "Phil"). Keys are normalized (lowercase, no dots,
// single-spaced); values are OSIS abbrevs from bible-books.ts. Both spaced and
// unspaced numbered forms are listed so either lookup hits.
const ALIASES: Record<string, string> = {
  ge: 'gen', gen: 'gen', ex: 'exo', exo: 'exo', exod: 'exo',
  lev: 'lev', lv: 'lev', num: 'num', nm: 'num', nb: 'num',
  deut: 'deu', deu: 'deu', dt: 'deu',
  josh: 'jos', jos: 'jos', jsh: 'jos', judg: 'jdg', jdg: 'jdg', jgs: 'jdg',
  ruth: 'rut', rut: 'rut', ru: 'rut',
  '1sam': '1sa', '1 sam': '1sa', '1sa': '1sa', '1 sa': '1sa',
  '2sam': '2sa', '2 sam': '2sa', '2sa': '2sa', '2 sa': '2sa',
  '1kgs': '1ki', '1 kgs': '1ki', '1ki': '1ki', '1 ki': '1ki', '1kings': '1ki', '1 kings': '1ki',
  '2kgs': '2ki', '2 kgs': '2ki', '2ki': '2ki', '2 ki': '2ki', '2kings': '2ki', '2 kings': '2ki',
  '1chr': '1ch', '1 chr': '1ch', '1ch': '1ch', '1 ch': '1ch',
  '2chr': '2ch', '2 chr': '2ch', '2ch': '2ch', '2 ch': '2ch',
  ezr: 'ezr', neh: 'neh', est: 'est', esth: 'est',
  ps: 'psa', psa: 'psa', psalm: 'psa', psalms: 'psa', pss: 'psa',
  prov: 'pro', pro: 'pro', prv: 'pro',
  eccl: 'ecc', ecc: 'ecc', qoh: 'ecc',
  song: 'sng', sos: 'sng', sng: 'sng', 'song of songs': 'sng', 'song of solomon': 'sng', canticles: 'sng',
  isa: 'isa', is: 'isa', jer: 'jer', lam: 'lam',
  ezek: 'ezk', ezk: 'ezk', eze: 'ezk', dan: 'dan', dn: 'dan',
  hos: 'hos', joel: 'jol', jol: 'jol', amos: 'amo', amo: 'amo',
  obad: 'oba', oba: 'oba', ob: 'oba', jonah: 'jon', jon: 'jon', jnh: 'jon',
  mic: 'mic', mc: 'mic', nah: 'nam', nam: 'nam', hab: 'hab',
  zeph: 'zep', zep: 'zep', hag: 'hag', hg: 'hag',
  zech: 'zec', zec: 'zec', zch: 'zec', mal: 'mal', ml: 'mal',
  matt: 'mat', mat: 'mat', mt: 'mat', mark: 'mrk', mrk: 'mrk', mk: 'mrk', mr: 'mrk',
  luke: 'luk', luk: 'luk', lk: 'luk', john: 'jhn', jhn: 'jhn', jn: 'jhn', jo: 'jhn',
  acts: 'act', act: 'act', ac: 'act',
  rom: 'rom', rm: 'rom',
  '1cor': '1co', '1 cor': '1co', '1co': '1co', '2cor': '2co', '2 cor': '2co', '2co': '2co',
  gal: 'gal', ga: 'gal', eph: 'eph', ephes: 'eph',
  php: 'php', phil: 'php', philip: 'php', col: 'col',
  '1thess': '1th', '1 thess': '1th', '1th': '1th', '1thes': '1th', '1 thes': '1th',
  '2thess': '2th', '2 thess': '2th', '2th': '2th', '2thes': '2th', '2 thes': '2th',
  '1tim': '1ti', '1 tim': '1ti', '1ti': '1ti', '2tim': '2ti', '2 tim': '2ti', '2ti': '2ti',
  tit: 'tit', ti: 'tit', phlm: 'phm', phm: 'phm', philem: 'phm', philemon: 'phm',
  heb: 'heb', jas: 'jas', jms: 'jas', james: 'jas',
  '1pet': '1pe', '1 pet': '1pe', '1pe': '1pe', '1pt': '1pe',
  '2pet': '2pe', '2 pet': '2pe', '2pe': '2pe', '2pt': '2pe',
  '1jn': '1jn', '1 jn': '1jn', '1jhn': '1jn', '1john': '1jn', '1 john': '1jn',
  '2jn': '2jn', '2 jn': '2jn', '2john': '2jn', '2 john': '2jn',
  '3jn': '3jn', '3 jn': '3jn', '3john': '3jn', '3 john': '3jn',
  jude: 'jud', jud: 'jud', rev: 'rev', rv: 'rev', apoc: 'rev',
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

/** Resolve a book token (name or abbreviation) to a canonical book, or null. */
function resolveBookToken(token: string): BibleBook | null {
  const n = normalize(token);
  if (!n) return null;
  // 1. Alias table (handles abbreviations + numbered variants, spaced or not).
  const abbrev = ALIASES[n] ?? ALIASES[n.replace(/\s+/g, '')];
  if (abbrev) return bookByAbbrev(abbrev) ?? null;
  // 2. Exact canonical name.
  const exact = BIBLE_BOOKS.find((b) => b.name.toLowerCase() === n);
  if (exact) return exact;
  // 3. Bidirectional prefix (so "genesis"->Genesis and "psalms"->Psalm); the
  //    shortest matching name wins to keep it deterministic.
  const prefix = BIBLE_BOOKS.filter((b) => {
    const name = b.name.toLowerCase();
    return name.startsWith(n) || n.startsWith(name);
  });
  if (prefix.length > 0) return prefix.reduce((best, b) => (b.name.length < best.name.length ? b : best));
  return null;
}

// Book part (optional 1-3 prefix + letters/spaces/periods), then chapter, then an
// optional ":verse" with an optional "-/–/— end".
const REF_RE = /^([1-3]?\s*[a-z][a-z. ]*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?$/i;

/** Parse a string of one or more references; never throws. */
export function parseReferences(input: string): ParseResult {
  const refs: ScriptureRef[] = [];
  const unparsed: string[] = [];
  const tokens = input.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

  for (const token of tokens) {
    const m = REF_RE.exec(token);
    if (!m) { unparsed.push(token); continue; }

    const book = resolveBookToken(m[1]);
    const chapter = Number(m[2]);
    if (!book || chapter < 1 || chapter > book.chapterCount) { unparsed.push(token); continue; }

    // A verse is required — a chapter-only reference is not a focus-list verse.
    if (m[3] == null) { unparsed.push(token); continue; }
    const verseStart = Number(m[3]);
    const verseEnd = m[4] != null ? Number(m[4]) : verseStart;
    if (verseStart < 1 || verseEnd < verseStart) { unparsed.push(token); continue; }

    refs.push({
      book: book.abbrev,
      chapter,
      verseStart,
      verseEnd,
      label: formatVerseLabel(book.name, chapter, verseStart, verseEnd),
    });
  }

  return { refs, unparsed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/reference-parser.test.ts`
Expected: PASS (all cases). If the chapter-only case `Phlm 6` ever needs to parse as a verse, that is a deliberate v1 cut — leave it `unparsed`.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/reference-parser.ts src/notepad/bible/focus/reference-parser.test.ts
git commit -m "feat(bible): tolerant scripture reference parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 4: `in-memory-focus-list-adapter.ts` — tested CRUD contract

A `Map`-backed `FocusListAdapter`. It is the **reference implementation of the contract** (fully tested) and the **hook's test double** (Task 7). Ids are generated locally; positions are dense and 0-based.

**Files:**
- Create: `src/notepad/bible/focus/in-memory-focus-list-adapter.ts`
- Test: `src/notepad/bible/focus/in-memory-focus-list-adapter.test.ts`

**Interfaces:**
- Consumes: `FocusListAdapter`, `FocusList`, `FocusListItem`, `ScriptureRef` (Task 2).
- Produces: `class InMemoryFocusListAdapter implements FocusListAdapter` with a `constructor(seed?: FocusList[])` and a `nextId` counter. Consumed by Task 7's tests.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/in-memory-focus-list-adapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryFocusListAdapter } from './in-memory-focus-list-adapter';
import type { ScriptureRef } from './focus-list-types';

const ref = (label: string): ScriptureRef => ({
  book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label,
});

describe('InMemoryFocusListAdapter', () => {
  it('creates a list with items in order and lists it back', async () => {
    const a = new InMemoryFocusListAdapter();
    const created = await a.createList('Sunday AM', [ref('a'), ref('b')]);
    expect(created.title).toBe('Sunday AM');
    expect(created.items.map((i) => [i.label, i.position])).toEqual([['a', 0], ['b', 1]]);

    const lists = await a.listLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].id).toBe(created.id);
  });

  it('appends items after the existing ones using startPosition', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a')]);
    const added = await a.addItems(list.id, [ref('b'), ref('c')], 1);
    expect(added.map((i) => i.position)).toEqual([1, 2]);
    const [reloaded] = await a.listLists();
    expect(reloaded.items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
  });

  it('removes an item', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a'), ref('b')]);
    await a.removeItem(list.items[0].id);
    const [reloaded] = await a.listLists();
    expect(reloaded.items.map((i) => i.label)).toEqual(['b']);
  });

  it('reorders items to match the given id order and renumbers positions', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a'), ref('b'), ref('c')]);
    const [ia, ib, ic] = list.items;
    await a.reorderItems(list.id, [ic.id, ia.id, ib.id]);
    const [reloaded] = await a.listLists();
    expect(reloaded.items.map((i) => [i.label, i.position])).toEqual([['c', 0], ['a', 1], ['b', 2]]);
  });

  it('deletes a list', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', []);
    await a.deleteList(list.id);
    expect(await a.listLists()).toEqual([]);
  });

  it('returns deep copies so callers cannot mutate internal state', async () => {
    const a = new InMemoryFocusListAdapter();
    const list = await a.createList('L', [ref('a')]);
    list.items[0].label = 'MUTATED';
    const [reloaded] = await a.listLists();
    expect(reloaded.items[0].label).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/in-memory-focus-list-adapter.test.ts`
Expected: FAIL — `Cannot find module './in-memory-focus-list-adapter'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/in-memory-focus-list-adapter.ts`:

```ts
// Map-backed FocusListAdapter: the tested reference implementation of the CRUD/
// ordering contract and the test double for useScriptureFocusLists. Returns deep
// copies so callers can mutate results without corrupting internal state.
import type { FocusList, FocusListAdapter, FocusListItem, ScriptureRef } from './focus-list-types';

function clone(list: FocusList): FocusList {
  return { ...list, items: list.items.map((i) => ({ ...i })) };
}

export class InMemoryFocusListAdapter implements FocusListAdapter {
  #lists = new Map<string, FocusList>();
  #seq = 0;

  constructor(seed: FocusList[] = []) {
    for (const l of seed) this.#lists.set(l.id, clone(l));
  }

  #id(prefix: string): string {
    this.#seq += 1;
    return `${prefix}-${this.#seq}`;
  }

  #toItems(refs: ScriptureRef[], startPosition: number): FocusListItem[] {
    return refs.map((r, idx) => ({ ...r, id: this.#id('item'), position: startPosition + idx }));
  }

  async listLists(): Promise<FocusList[]> {
    return [...this.#lists.values()]
      .sort((a, b) => a.position - b.position)
      .map(clone);
  }

  async createList(title: string, refs: ScriptureRef[]): Promise<FocusList> {
    const list: FocusList = {
      id: this.#id('list'),
      title,
      position: this.#lists.size,
      items: this.#toItems(refs, 0),
    };
    this.#lists.set(list.id, list);
    return clone(list);
  }

  async deleteList(id: string): Promise<void> {
    this.#lists.delete(id);
  }

  async addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]> {
    const list = this.#lists.get(listId);
    if (!list) throw new Error(`list ${listId} not found`);
    const items = this.#toItems(refs, startPosition);
    list.items.push(...items);
    return items.map((i) => ({ ...i }));
  }

  async removeItem(itemId: string): Promise<void> {
    for (const list of this.#lists.values()) {
      const idx = list.items.findIndex((i) => i.id === itemId);
      if (idx !== -1) { list.items.splice(idx, 1); return; }
    }
  }

  async reorderItems(listId: string, orderedItemIds: string[]): Promise<void> {
    const list = this.#lists.get(listId);
    if (!list) throw new Error(`list ${listId} not found`);
    const byId = new Map(list.items.map((i) => [i.id, i]));
    list.items = orderedItemIds
      .map((id, position) => {
        const item = byId.get(id);
        return item ? { ...item, position } : null;
      })
      .filter((i): i is FocusListItem => i !== null);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/in-memory-focus-list-adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/in-memory-focus-list-adapter.ts src/notepad/bible/focus/in-memory-focus-list-adapter.test.ts
git commit -m "feat(bible): in-memory focus-list adapter (tested CRUD contract)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 5: `supabase-focus-list-adapter.ts` — production persistence

Thin pass-through over the `042` tables, mirroring `highlights/supabase-bible-highlight-adapter.ts` (class takes `(client, userId)`, `from(table)…`, throws on error). The CRUD/ordering *contract* is already proven by Task 4's in-memory adapter; here we TDD the two trivial single-call mutations with the repo's chainable-builder mock and verify the multi-call methods via `tsc -b` + the Task 14 smoke test (this matches the highlights precedent, where the Supabase adapter is not unit-tested).

**Files:**
- Create: `src/notepad/bible/focus/supabase-focus-list-adapter.ts`
- Test: `src/notepad/bible/focus/supabase-focus-list-adapter.test.ts`

**Interfaces:**
- Consumes: `FocusListAdapter`, `FocusList`, `FocusListItem`, `ScriptureRef` (Task 2); `SupabaseClient` from `@supabase/supabase-js`; the `042` tables (Task 1).
- Produces: `class SupabaseFocusListAdapter implements FocusListAdapter` with `constructor(client: SupabaseClient, userId: string)`. Consumed by Task 7's production path.

- [ ] **Step 1: Write the failing test** (single-call mutations)

Create `src/notepad/bible/focus/supabase-focus-list-adapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseFocusListAdapter } from './supabase-focus-list-adapter';

// Chainable supabase builder mock: delete()/eq() return `this`; the final eq()
// resolves to { error }. from() records the table name.
const { from, del, eq } = vi.hoisted(() => {
  const del = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  return { from, del, eq };
});

function wire(error: unknown = null) {
  const builder = { delete: del, eq, then: (r: (v: { error: unknown }) => unknown) => Promise.resolve(r({ error })) };
  del.mockReturnValue(builder);
  eq.mockReturnValue(builder);
  from.mockReturnValue(builder);
}

beforeEach(() => { from.mockReset(); del.mockReset(); eq.mockReset(); wire(); });

const adapter = () => new SupabaseFocusListAdapter({ from } as never, 'user-1');

describe('SupabaseFocusListAdapter — single-call mutations', () => {
  it('removeItem deletes the item row by id', async () => {
    await adapter().removeItem('item-9');
    expect(from).toHaveBeenCalledWith('scripture_focus_list_items');
    expect(eq).toHaveBeenCalledWith('id', 'item-9');
  });

  it('deleteList deletes the list row by id', async () => {
    await adapter().deleteList('list-3');
    expect(from).toHaveBeenCalledWith('scripture_focus_lists');
    expect(eq).toHaveBeenCalledWith('id', 'list-3');
  });

  it('throws when the delete returns an error', async () => {
    wire({ message: 'boom' });
    await expect(adapter().removeItem('x')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/supabase-focus-list-adapter.test.ts`
Expected: FAIL — `Cannot find module './supabase-focus-list-adapter'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/supabase-focus-list-adapter.ts`:

```ts
// Production FocusListAdapter over the 042 tables (RLS-scoped to the signed-in
// user). Thin pass-through, mirroring supabase-bible-highlight-adapter.ts. The
// CRUD/ordering contract is proven by InMemoryFocusListAdapter's tests.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FocusList, FocusListAdapter, FocusListItem, ScriptureRef } from './focus-list-types';

interface ListRow { id: string; title: string; position: number; }
interface ItemRow {
  id: string; list_id: string; book: string; chapter: number;
  verse_start: number; verse_end: number; label: string; position: number;
}

function toItem(r: ItemRow): FocusListItem {
  return {
    id: r.id, book: r.book, chapter: r.chapter,
    verseStart: r.verse_start, verseEnd: r.verse_end, label: r.label, position: r.position,
  };
}

export class SupabaseFocusListAdapter implements FocusListAdapter {
  #client: SupabaseClient;
  #userId: string;

  constructor(client: SupabaseClient, userId: string) {
    this.#client = client;
    this.#userId = userId;
  }

  async listLists(): Promise<FocusList[]> {
    const { data: lists, error: lErr } = await this.#client
      .from('scripture_focus_lists')
      .select('id, title, position')
      .order('position', { ascending: true });
    if (lErr) throw lErr;
    const listRows = (lists ?? []) as ListRow[];
    if (listRows.length === 0) return [];

    const { data: items, error: iErr } = await this.#client
      .from('scripture_focus_list_items')
      .select('id, list_id, book, chapter, verse_start, verse_end, label, position')
      .in('list_id', listRows.map((l) => l.id))
      .order('position', { ascending: true });
    if (iErr) throw iErr;
    const itemRows = (items ?? []) as ItemRow[];

    return listRows.map((l) => ({
      id: l.id,
      title: l.title,
      position: l.position,
      items: itemRows.filter((i) => i.list_id === l.id).map(toItem),
    }));
  }

  async createList(title: string, refs: ScriptureRef[]): Promise<FocusList> {
    const { data: list, error: lErr } = await this.#client
      .from('scripture_focus_lists')
      .insert({ user_id: this.#userId, title })
      .select('id, title, position')
      .single();
    if (lErr) throw lErr;
    const row = list as ListRow;

    const created: FocusList = { id: row.id, title: row.title, position: row.position, items: [] };
    if (refs.length > 0) created.items = await this.addItems(row.id, refs, 0);
    return created;
  }

  async deleteList(id: string): Promise<void> {
    const { error } = await this.#client.from('scripture_focus_lists').delete().eq('id', id);
    if (error) throw error;
  }

  async addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]> {
    if (refs.length === 0) return [];
    const rows = refs.map((r, idx) => ({
      list_id: listId, book: r.book, chapter: r.chapter,
      verse_start: r.verseStart, verse_end: r.verseEnd, label: r.label,
      position: startPosition + idx,
    }));
    const { data, error } = await this.#client
      .from('scripture_focus_list_items')
      .insert(rows)
      .select('id, list_id, book, chapter, verse_start, verse_end, label, position');
    if (error) throw error;
    return ((data ?? []) as ItemRow[]).map(toItem).sort((a, b) => a.position - b.position);
  }

  async removeItem(itemId: string): Promise<void> {
    const { error } = await this.#client.from('scripture_focus_list_items').delete().eq('id', itemId);
    if (error) throw error;
  }

  async reorderItems(_listId: string, orderedItemIds: string[]): Promise<void> {
    // Renumber positions densely. One update per item keeps it simple and RLS-safe;
    // lists are short (a service's worth of verses), so the round-trip count is fine.
    for (let position = 0; position < orderedItemIds.length; position += 1) {
      const { error } = await this.#client
        .from('scripture_focus_list_items')
        .update({ position })
        .eq('id', orderedItemIds[position]);
      if (error) throw error;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/supabase-focus-list-adapter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors (pre-existing `force-sphere.test.ts` errors may remain; this file must contribute none).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/bible/focus/supabase-focus-list-adapter.ts src/notepad/bible/focus/supabase-focus-list-adapter.test.ts
git commit -m "feat(bible): supabase focus-list adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 6: `session-storage.ts` — focus persistence helpers

Add per-device persistence for the Quick list, the active-list id, and the focus-mode flag, following the existing module's guarded-`localStorage` pattern (the module is named "session-storage" but uses `localStorage`; matches `KEY_EDITOR_TAB`).

**Files:**
- Modify: `src/notepad/session/session-storage.ts`
- Test: `src/notepad/session/session-storage.focus.test.ts`

**Interfaces:**
- Consumes: `FocusListItem` (Task 2).
- Produces: `KEY_FOCUS_MODE`, `KEY_FOCUS_ACTIVE_LIST`; `loadFocusMode()/saveFocusMode(on)`, `loadActiveListId()/saveActiveListId(id)`, `loadQuickListItems()/saveQuickListItems(items)`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/session/session-storage.focus.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadFocusMode, saveFocusMode,
  loadActiveListId, saveActiveListId,
  loadQuickListItems, saveQuickListItems,
} from './session-storage';
import type { FocusListItem } from '@/notepad/bible/focus/focus-list-types';

afterEach(() => localStorage.clear());

const item: FocusListItem = {
  id: 'i1', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16', position: 0,
};

describe('focus session persistence', () => {
  it('defaults to focus mode off and no active list', () => {
    expect(loadFocusMode()).toBe(false);
    expect(loadActiveListId()).toBeNull();
    expect(loadQuickListItems()).toEqual([]);
  });

  it('round-trips focus mode', () => {
    saveFocusMode(true);
    expect(loadFocusMode()).toBe(true);
    saveFocusMode(false);
    expect(loadFocusMode()).toBe(false);
  });

  it('round-trips the active list id', () => {
    saveActiveListId('list-7');
    expect(loadActiveListId()).toBe('list-7');
  });

  it('round-trips quick list items', () => {
    saveQuickListItems([item]);
    expect(loadQuickListItems()).toEqual([item]);
  });

  it('returns [] for corrupt quick-list json', () => {
    localStorage.setItem('psalms.bible.focus.quickList', '{not json');
    expect(loadQuickListItems()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/session/session-storage.focus.test.ts`
Expected: FAIL — the named exports do not exist yet.

- [ ] **Step 3: Add the constants to the export block**

In `src/notepad/session/session-storage.ts`, add three constants next to the existing `KEY_*` declarations (after `const KEY_MOBILE_STUDY_TAB = ...`):

```ts
const KEY_FOCUS_MODE = 'psalms.bible.focus.mode';
const KEY_FOCUS_ACTIVE_LIST = 'psalms.bible.focus.activeListId';
const KEY_QUICK_LIST = 'psalms.bible.focus.quickList';
```

And add them to the existing `export { … }` block (append inside the braces):

```ts
  KEY_FOCUS_MODE,
  KEY_FOCUS_ACTIVE_LIST,
  KEY_QUICK_LIST,
```

- [ ] **Step 4: Add the helpers at the end of the file**

Append to `src/notepad/session/session-storage.ts`:

```ts
import type { FocusListItem } from '@/notepad/bible/focus/focus-list-types';

export function loadFocusMode(): boolean {
  return readRaw(KEY_FOCUS_MODE) === '1';
}
export function saveFocusMode(on: boolean): void {
  writeRaw(KEY_FOCUS_MODE, on ? '1' : '0');
}

export function loadActiveListId(): string | null {
  return readRaw(KEY_FOCUS_ACTIVE_LIST);
}
export function saveActiveListId(id: string | null): void {
  writeRaw(KEY_FOCUS_ACTIVE_LIST, id);
}

export function loadQuickListItems(): FocusListItem[] {
  const raw = readRaw(KEY_QUICK_LIST);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FocusListItem[]) : [];
  } catch {
    return [];
  }
}
export function saveQuickListItems(items: FocusListItem[]): void {
  writeRaw(KEY_QUICK_LIST, JSON.stringify(items));
}
```

> Note: the `import type` must sit at the TOP of the file with the other imports (move it up if your editor's lint requires it); the function bodies stay at the end. `readRaw`/`writeRaw` are already defined in this module.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/notepad/session/session-storage.focus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/session/session-storage.ts src/notepad/session/session-storage.focus.test.ts
git commit -m "feat(bible): session persistence for focus mode + active list + quick list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 7: `useScriptureFocusLists.ts` — orchestration hook

Owns saved lists (signed-in, via adapter), the in-memory Quick list (persisted to localStorage), `activeListId`, and `focusModeOn`. Mutations on saved lists are optimistic with rollback + toast; Quick-list mutations are in-memory + persisted. Tests inject `InMemoryFocusListAdapter`; production builds `SupabaseFocusListAdapter` from `supabase` + `userId` (mirroring `useBibleHighlights`).

**Files:**
- Create: `src/notepad/bible/focus/useScriptureFocusLists.ts`
- Test: `src/notepad/bible/focus/useScriptureFocusLists.test.ts`

**Interfaces:**
- Consumes: `FocusListAdapter`, `FocusList`, `ScriptureRef`, `QUICK_LIST_ID` (Task 2); `InMemoryFocusListAdapter` (Task 4); `SupabaseFocusListAdapter` (Task 5); session helpers (Task 6); `supabase` from `@/lib/supabase`; `useAuthSession` from `@/auth/context/useAuthSession`; `toast` from `sonner`.
- Produces: `useScriptureFocusLists(opts?)` returning `UseScriptureFocusListsResult` (see Canonical Interfaces). Consumed by `BibleStudyPane` (Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/useScriptureFocusLists.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { useScriptureFocusLists } from './useScriptureFocusLists';
import { InMemoryFocusListAdapter } from './in-memory-focus-list-adapter';
import { QUICK_LIST_ID, type ScriptureRef } from './focus-list-types';

// useAuthSession is called internally; the injected adapter bypasses real auth.
vi.mock('@/auth/context/useAuthSession', () => ({ useAuthSession: () => ({ user: null }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const ref = (label: string, v = 16): ScriptureRef => ({
  book: 'jhn', chapter: 3, verseStart: v, verseEnd: v, label,
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('useScriptureFocusLists', () => {
  it('starts focus-off with the quick list active and empty', () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    expect(result.current.focusModeOn).toBe(false);
    expect(result.current.activeListId).toBe(QUICK_LIST_ID);
    expect(result.current.activeList.items).toEqual([]);
    expect(result.current.canSave).toBe(false);
  });

  it('toggles focus mode and persists it', () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    act(() => result.current.toggleFocusMode());
    expect(result.current.focusModeOn).toBe(true);
    expect(localStorage.getItem('psalms.bible.focus.mode')).toBe('1');
  });

  it('adds refs to the quick list when quick is active (signed-out)', async () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    await act(async () => { await result.current.addRefs([ref('John 3:16')]); });
    expect(result.current.quickList.items.map((i) => i.label)).toEqual(['John 3:16']);
    // persisted
    expect(JSON.parse(localStorage.getItem('psalms.bible.focus.quickList')!)).toHaveLength(1);
  });

  it('loads saved lists from the adapter on mount (signed-in)', async () => {
    const adapter = new InMemoryFocusListAdapter();
    await adapter.createList('Comfort', [ref('a')]);
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    expect(result.current.canSave).toBe(true);
    expect(result.current.savedLists[0].title).toBe('Comfort');
  });

  it('saveQuickList persists the quick items into a new saved list and activates it', async () => {
    const adapter = new InMemoryFocusListAdapter();
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await act(async () => { await result.current.addRefs([ref('John 3:16')]); });
    await act(async () => { await result.current.saveQuickList('Sunday AM'); });
    await waitFor(() => expect(result.current.savedLists).toHaveLength(1));
    expect(result.current.savedLists[0].title).toBe('Sunday AM');
    expect(result.current.activeListId).toBe(result.current.savedLists[0].id);
    // quick list is cleared after saving
    expect(result.current.quickList.items).toEqual([]);
  });

  it('falls back to the quick list when the active saved list is deleted', async () => {
    const adapter = new InMemoryFocusListAdapter();
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: adapter }));
    await act(async () => { await result.current.newList('Romans'); });
    const id = result.current.activeListId;
    expect(id).not.toBe(QUICK_LIST_ID);
    await act(async () => { await result.current.deleteList(id); });
    expect(result.current.activeListId).toBe(QUICK_LIST_ID);
  });

  it('reorders quick-list items up/down', async () => {
    const { result } = renderHook(() => useScriptureFocusLists({ adapterOverride: null }));
    await act(async () => { await result.current.addRefs([ref('a', 1), ref('b', 2), ref('c', 3)]); });
    const second = result.current.quickList.items[1].id;
    await act(async () => { await result.current.reorderItem(second, 'up'); });
    expect(result.current.quickList.items.map((i) => i.label)).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/useScriptureFocusLists.test.ts`
Expected: FAIL — `Cannot find module './useScriptureFocusLists'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/useScriptureFocusLists.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/auth/context/useAuthSession';
import {
  loadFocusMode, saveFocusMode,
  loadActiveListId, saveActiveListId,
  loadQuickListItems, saveQuickListItems,
} from '@/notepad/session/session-storage';
import {
  QUICK_LIST_ID,
  type FocusList, type FocusListAdapter, type FocusListItem, type ScriptureRef,
} from './focus-list-types';
import { SupabaseFocusListAdapter } from './supabase-focus-list-adapter';

export interface UseScriptureFocusListsResult {
  focusModeOn: boolean;
  toggleFocusMode: () => void;
  savedLists: FocusList[];
  quickList: FocusList;
  activeListId: string;
  activeList: FocusList;
  canSave: boolean;
  selectList: (id: string) => void;
  newList: (title: string) => Promise<void>;
  saveQuickList: (title: string) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  addRefs: (refs: ScriptureRef[]) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  reorderItem: (itemId: string, direction: 'up' | 'down') => Promise<void>;
}

export interface UseScriptureFocusListsOptions {
  /** Tests inject an adapter; omit in production to build from supabase + userId. */
  adapterOverride?: FocusListAdapter | null;
}

function newItemId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `q-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function refToQuickItem(ref: ScriptureRef, position: number): FocusListItem {
  return { ...ref, id: newItemId(), position };
}

export function useScriptureFocusLists(
  opts: UseScriptureFocusListsOptions = {},
): UseScriptureFocusListsResult {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;

  const adapter: FocusListAdapter | null = useMemo(() => {
    if (opts.adapterOverride !== undefined) return opts.adapterOverride;
    if (supabase && userId) return new SupabaseFocusListAdapter(supabase, userId);
    return null;
  }, [opts.adapterOverride, userId]);

  const [savedLists, setSavedLists] = useState<FocusList[]>([]);
  const [focusModeOn, setFocusModeOn] = useState<boolean>(() => loadFocusMode());
  const [activeListId, setActiveListId] = useState<string>(() => loadActiveListId() ?? QUICK_LIST_ID);
  const [quickItems, setQuickItems] = useState<FocusListItem[]>(() => loadQuickListItems());

  const canSave = adapter != null;

  // Load saved lists when an adapter is present.
  useEffect(() => {
    if (!adapter) { setSavedLists([]); return; }
    let cancelled = false;
    adapter.listLists()
      .then((lists) => { if (!cancelled) setSavedLists(lists); })
      .catch((err) => { if (!cancelled) console.warn('[useScriptureFocusLists] load failed:', err); });
    return () => { cancelled = true; };
  }, [adapter]);

  const quickList: FocusList = useMemo(
    () => ({ id: QUICK_LIST_ID, title: 'Quick list', position: -1, items: quickItems }),
    [quickItems],
  );

  const persistQuick = useCallback((items: FocusListItem[]) => {
    setQuickItems(items);
    saveQuickListItems(items);
  }, []);

  // Resolve the active list; fall back to the quick list if the id is unknown.
  const activeList: FocusList = useMemo(() => {
    if (activeListId === QUICK_LIST_ID) return quickList;
    return savedLists.find((l) => l.id === activeListId) ?? quickList;
  }, [activeListId, savedLists, quickList]);

  const toggleFocusMode = useCallback(() => {
    setFocusModeOn((prev) => { const next = !prev; saveFocusMode(next); return next; });
  }, []);

  const selectList = useCallback((id: string) => {
    setActiveListId(id);
    saveActiveListId(id);
  }, []);

  const addRefs = useCallback(async (refs: ScriptureRef[]) => {
    if (refs.length === 0) return;
    if (activeListId === QUICK_LIST_ID) {
      persistQuick([...quickItems, ...refs.map((r, i) => refToQuickItem(r, quickItems.length + i))]);
      return;
    }
    if (!adapter) return;
    const list = savedLists.find((l) => l.id === activeListId);
    if (!list) return;
    const prev = savedLists;
    try {
      const created = await adapter.addItems(activeListId, refs, list.items.length);
      setSavedLists((cur) => cur.map((l) => (l.id === activeListId ? { ...l, items: [...l.items, ...created] } : l)));
    } catch (err) {
      console.warn('[useScriptureFocusLists] addItems failed:', err);
      setSavedLists(prev);
      toast.error('Could not add to the list. Please try again.');
    }
  }, [activeListId, adapter, quickItems, savedLists, persistQuick]);

  const removeItem = useCallback(async (itemId: string) => {
    if (activeListId === QUICK_LIST_ID) {
      persistQuick(quickItems.filter((i) => i.id !== itemId).map((i, idx) => ({ ...i, position: idx })));
      return;
    }
    if (!adapter) return;
    const prev = savedLists;
    setSavedLists((cur) => cur.map((l) => (l.id === activeListId
      ? { ...l, items: l.items.filter((i) => i.id !== itemId).map((i, idx) => ({ ...i, position: idx })) }
      : l)));
    try {
      await adapter.removeItem(itemId);
    } catch (err) {
      console.warn('[useScriptureFocusLists] removeItem failed:', err);
      setSavedLists(prev);
      toast.error('Could not remove the verse. Please try again.');
    }
  }, [activeListId, adapter, quickItems, savedLists, persistQuick]);

  const reorderItem = useCallback(async (itemId: string, direction: 'up' | 'down') => {
    const reorder = (items: FocusListItem[]): FocusListItem[] | null => {
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx === -1) return null;
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= items.length) return null;
      const next = [...items];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next.map((i, position) => ({ ...i, position }));
    };

    if (activeListId === QUICK_LIST_ID) {
      const next = reorder(quickItems);
      if (next) persistQuick(next);
      return;
    }
    if (!adapter) return;
    const list = savedLists.find((l) => l.id === activeListId);
    if (!list) return;
    const next = reorder(list.items);
    if (!next) return;
    const prev = savedLists;
    setSavedLists((cur) => cur.map((l) => (l.id === activeListId ? { ...l, items: next } : l)));
    try {
      await adapter.reorderItems(activeListId, next.map((i) => i.id));
    } catch (err) {
      console.warn('[useScriptureFocusLists] reorderItems failed:', err);
      setSavedLists(prev);
      toast.error('Could not reorder. Please try again.');
    }
  }, [activeListId, adapter, quickItems, savedLists, persistQuick]);

  const newList = useCallback(async (title: string) => {
    if (!adapter) { toast.error('Sign in to save lists.'); return; }
    try {
      const created = await adapter.createList(title, []);
      setSavedLists((cur) => [...cur, created]);
      selectList(created.id);
    } catch (err) {
      console.warn('[useScriptureFocusLists] newList failed:', err);
      toast.error('Could not create the list. Please try again.');
    }
  }, [adapter, selectList]);

  const saveQuickList = useCallback(async (title: string) => {
    if (!adapter) { toast.error('Sign in to save lists.'); return; }
    try {
      const created = await adapter.createList(title, quickItems);
      setSavedLists((cur) => [...cur, created]);
      selectList(created.id);
      persistQuick([]); // the quick list resets once saved
    } catch (err) {
      console.warn('[useScriptureFocusLists] saveQuickList failed:', err);
      toast.error('Could not save the list. Please try again.');
    }
  }, [adapter, quickItems, selectList, persistQuick]);

  const deleteList = useCallback(async (id: string) => {
    if (!adapter) return;
    const prev = savedLists;
    setSavedLists((cur) => cur.filter((l) => l.id !== id));
    if (activeListId === id) selectList(QUICK_LIST_ID);
    try {
      await adapter.deleteList(id);
    } catch (err) {
      console.warn('[useScriptureFocusLists] deleteList failed:', err);
      setSavedLists(prev);
      toast.error('Could not delete the list. Please try again.');
    }
  }, [adapter, activeListId, savedLists, selectList]);

  return {
    focusModeOn, toggleFocusMode,
    savedLists, quickList, activeListId, activeList, canSave,
    selectList, newList, saveQuickList, deleteList,
    addRefs, removeItem, reorderItem,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/useScriptureFocusLists.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/useScriptureFocusLists.ts src/notepad/bible/focus/useScriptureFocusLists.test.ts
git commit -m "feat(bible): useScriptureFocusLists orchestration hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 8: `useFocusListVerseText.ts` — verse-text assembler + hook

A pure assembler (heavily tested) plus a hook that batch-fetches `bible_passages`
one query per distinct `(book, chapter)` — mirroring `useBiblePassages.ts` exactly
— then assembles per-item lines and flags items missing in the active translation.

**Files:**
- Create: `src/notepad/bible/focus/useFocusListVerseText.ts`
- Test: `src/notepad/bible/focus/useFocusListVerseText.test.ts`

**Interfaces:**
- Consumes: `FocusListItem` (Task 2); `supabase` from `@/lib/supabase`; `BibleTranslation` from `../translations`.
- Produces: `FocusVerseLine`, `FocusItemText`, `assembleFocusItemTexts()`, `useFocusListVerseText()` (see Canonical Interfaces). Consumed by `FocusListView` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/useFocusListVerseText.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

// Chainable supabase builder mock (mirrors useBiblePassages.test.ts): select/eq/
// like/order return `this`; awaiting the builder resolves to { data, error }.
const { order, like, select, eq, from, getBuilder, setOrderResult } = vi.hoisted(() => {
  const order = vi.fn();
  const like = vi.fn();
  const select = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  let orderResult: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: {
    select: typeof select; like: typeof like; order: typeof order; eq: typeof eq;
    then: (r: (v: { data: unknown; error: unknown }) => unknown) => Promise<unknown>;
  } = {
    select, like, order, eq,
    then: (resolve) => Promise.resolve(resolve(orderResult)),
  };
  select.mockImplementation(() => builder);
  like.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  return {
    order, like, select, eq, from,
    getBuilder: () => builder,
    setOrderResult: (v: { data: unknown; error: unknown }) => { orderResult = v; },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

import { assembleFocusItemTexts, useFocusListVerseText } from './useFocusListVerseText';
import type { FocusListItem, FocusVerseLine } from './focus-list-types';
import type { FocusItemText } from './useFocusListVerseText';

const item = (over: Partial<FocusListItem>): FocusListItem => ({
  id: 'i', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16,
  label: 'John 3:16', position: 0, ...over,
});

beforeEach(() => {
  from.mockClear(); select.mockClear(); like.mockClear(); order.mockClear(); eq.mockClear();
  const builder = getBuilder();
  select.mockImplementation(() => builder);
  like.mockImplementation(() => builder);
  order.mockImplementation(() => builder);
  eq.mockImplementation(() => builder);
  from.mockImplementation(() => builder);
  setOrderResult({ data: [], error: null });
});
afterEach(cleanup);

describe('assembleFocusItemTexts (pure)', () => {
  it('keeps only the single verse for a single-verse item', () => {
    const items = [item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16 })];
    const rows: FocusVerseLine[] = [
      { verse: 15, text: 'that whoever believes' },
      { verse: 16, text: 'For God so loved the world' },
      { verse: 17, text: 'For God did not send his Son' },
    ];
    const out = assembleFocusItemTexts(items, new Map([['jhn.3', rows]]));
    expect(out).toHaveLength(1);
    expect(out[0].missing).toBe(false);
    expect(out[0].lines.map((l) => l.verse)).toEqual([16]);
    expect(out[0].lines[0].text).toBe('For God so loved the world');
  });

  it('keeps every verse within an inclusive range', () => {
    const items = [item({ id: 'b', book: 'psa', chapter: 23, verseStart: 1, verseEnd: 3, label: 'Psalm 23:1-3' })];
    const rows: FocusVerseLine[] = [
      { verse: 1, text: 'The LORD is my shepherd' },
      { verse: 2, text: 'He makes me lie down' },
      { verse: 3, text: 'He restores my soul' },
      { verse: 4, text: 'Even though I walk' },
    ];
    const out = assembleFocusItemTexts(items, new Map([['psa.23', rows]]));
    expect(out[0].missing).toBe(false);
    expect(out[0].lines.map((l) => l.verse)).toEqual([1, 2, 3]);
  });

  it('flags an item missing when its chapter has no rows (missing in translation)', () => {
    const items = [item({ id: 'c', book: 'eph', chapter: 2, verseStart: 8, verseEnd: 9, label: 'Ephesians 2:8-9' })];
    const out = assembleFocusItemTexts(items, new Map()); // no rows fetched for eph.2
    expect(out[0].missing).toBe(true);
    expect(out[0].lines).toEqual([]);
  });

  it('preserves item order in the output', () => {
    const items = [
      item({ id: 'a', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' }),
      item({ id: 'b', book: 'psa', chapter: 23, verseStart: 1, verseEnd: 1, label: 'Psalm 23:1' }),
    ];
    const out = assembleFocusItemTexts(items, new Map([
      ['jhn.3', [{ verse: 16, text: 'x' }]],
      ['psa.23', [{ verse: 1, text: 'y' }]],
    ]));
    expect(out.map((o) => o.item.id)).toEqual(['a', 'b']);
  });
});

describe('useFocusListVerseText (hook)', () => {
  it('fetches the item chapter and assembles the verse line', async () => {
    setOrderResult({
      data: [
        { id: 'eph.2.8', verse_start: 8, text: 'For it is by grace you have been saved' },
        { id: 'eph.2.9', verse_start: 9, text: 'not by works, so that no one can boast' },
      ],
      error: null,
    });
    const items = [item({ id: 'x', book: 'eph', chapter: 2, verseStart: 8, verseEnd: 8, label: 'Ephesians 2:8' })];
    const { result } = renderHook(() => useFocusListVerseText(items, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(from).toHaveBeenCalledWith('bible_passages');
    expect(eq).toHaveBeenCalledWith('translation', 'BSB');
    expect(like).toHaveBeenCalledWith('id', 'eph.2.%');
    expect(order).toHaveBeenCalledWith('verse_start', { ascending: true });
    expect(result.current.itemTexts).toHaveLength(1);
    expect(result.current.itemTexts[0].missing).toBe(false);
    expect(result.current.itemTexts[0].lines.map((l) => l.verse)).toEqual([8]);
  });

  it('returns no item texts and loads nothing for an empty list', async () => {
    const out: FocusItemText[] = [];
    const { result } = renderHook(() => useFocusListVerseText(out as never, 'BSB'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.itemTexts).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/useFocusListVerseText.test.ts`
Expected: FAIL — `Cannot find module './useFocusListVerseText'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/useFocusListVerseText.ts`:

```ts
// Assembles display verse text for a focus list. The pure assembler maps each
// item to the rows within its verse range (and flags missing-in-translation
// items); the hook batch-fetches one bible_passages query per distinct
// (book, chapter) — mirroring useBiblePassages.ts — and re-fetches on translation
// change. Text is fetched live so a list reads correctly in BSB / KJV / WEB.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { BibleTranslation } from '../translations';
import type { FocusListItem } from './focus-list-types';

export interface FocusVerseLine {
  verse: number;
  text: string;
}

export interface FocusItemText {
  item: FocusListItem;
  lines: FocusVerseLine[];
  missing: boolean;
}

interface PassageRow {
  id: string;
  verse_start: number;
  text: string;
}

/** Map each item to the fetched rows inside its verse range. Pure + sync. */
export function assembleFocusItemTexts(
  items: FocusListItem[],
  rowsByChapter: Map<string, FocusVerseLine[]>,
): FocusItemText[] {
  return items.map((item) => {
    const rows = rowsByChapter.get(`${item.book}.${item.chapter}`) ?? [];
    const lines = rows.filter((r) => r.verse >= item.verseStart && r.verse <= item.verseEnd);
    return { item, lines, missing: lines.length === 0 };
  });
}

/**
 * Fetch + assemble verse text for a focus list's items in the given translation.
 * One query per distinct (book, chapter); re-runs when the chapter set or the
 * translation changes.
 */
export function useFocusListVerseText(
  items: FocusListItem[],
  translation: BibleTranslation,
): { itemTexts: FocusItemText[]; loading: boolean } {
  const [rowsByChapter, setRowsByChapter] = useState<Map<string, FocusVerseLine[]>>(new Map());
  const [loading, setLoading] = useState(false);

  // Distinct, sorted `${book}.${chapter}` keys; the join is the effect's signal so
  // a new array identity with the same chapters does not re-fetch.
  const keySignature = useMemo(() => {
    const keys = new Set<string>();
    for (const it of items) keys.add(`${it.book}.${it.chapter}`);
    return [...keys].sort().join(',');
  }, [items]);

  useEffect(() => {
    const keys = keySignature ? keySignature.split(',') : [];
    if (!supabase || keys.length === 0) {
      setRowsByChapter(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const entries = await Promise.all(
        keys.map(async (key) => {
          const [book, chapterStr] = key.split('.');
          const { data, error } = await supabase!
            .from('bible_passages')
            .select('id, verse_start, text')
            .eq('translation', translation)
            .like('id', `${book}.${chapterStr}.%`)
            .order('verse_start', { ascending: true });
          if (error || !data) return [key, [] as FocusVerseLine[]] as const;
          const lines = (data as PassageRow[]).map((r) => ({ verse: r.verse_start, text: r.text }));
          return [key, lines] as const;
        }),
      );
      if (cancelled) return;
      setRowsByChapter(new Map(entries));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [keySignature, translation]);

  const itemTexts = useMemo(
    () => assembleFocusItemTexts(items, rowsByChapter),
    [items, rowsByChapter],
  );

  return { itemTexts, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/useFocusListVerseText.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/useFocusListVerseText.ts src/notepad/bible/focus/useFocusListVerseText.test.ts
git commit -m "feat(bible): focus-list verse-text assembler + hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 9: `AddVersePanel.tsx` — type/paste + search tabs

The Add panel: a **Type / paste** tab (uses `parseReferences`) and a **Search** tab
(uses `createVerseSearch`). Parsed/searched refs are handed up via `onAddRefs`.

**Files:**
- Create: `src/notepad/bible/focus/AddVersePanel.tsx`
- Test: `src/notepad/bible/focus/AddVersePanel.test.tsx`

**Interfaces:**
- Consumes: `parseReferences` (Task 3); `formatVerseLabel`, `ScriptureRef` (Task 2); `createVerseSearch` from `../verse-search`; `VerseCandidate`, `VerseSearchDeps` from `../verse-search-types`; `BibleTranslation` from `../translations`.
- Produces: `AddVersePanel` (props `{ onAddRefs, searchDeps, translation }`). Consumed by `FocusListView` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/AddVersePanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AddVersePanel } from './AddVersePanel';
import type { VerseSearchDeps, RawFtsRow } from '../verse-search-types';

afterEach(cleanup);

// A deps stub whose FTS path returns one John 3:16 row; the rest are inert.
function depsWithFts(rows: RawFtsRow[]): VerseSearchDeps {
  return {
    ftsSearch: async () => rows,
    semanticSearch: async () => [],
    resolvePericope: async () => null,
    fetchVerseText: async () => null,
  };
}

describe('AddVersePanel — type / paste', () => {
  it('parses a pasted batch and calls onAddRefs with the parsed refs', () => {
    const onAddRefs = vi.fn();
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={depsWithFts([])} translation="BSB" />);
    fireEvent.change(screen.getByLabelText(/paste references/i), {
      target: { value: 'John 3:16, Eph 2:8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
      { book: 'eph', chapter: 2, verseStart: 8, verseEnd: 8, label: 'Ephesians 2:8' },
    ]);
  });

  it('reports the unparseable fragments and still adds the rest', () => {
    const onAddRefs = vi.fn();
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={depsWithFts([])} translation="BSB" />);
    fireEvent.change(screen.getByLabelText(/paste references/i), {
      target: { value: 'John 3:16, gibberish' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
    expect(screen.getByText(/Couldn.t read:/i)).toHaveTextContent('gibberish');
  });
});

describe('AddVersePanel — search', () => {
  it('adds a tapped search result as a ScriptureRef', async () => {
    const onAddRefs = vi.fn();
    const deps = depsWithFts([
      { id: 'jhn.3.16', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: null, text: 'For God so loved the world' },
    ]);
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={deps} translation="BSB" />);
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    fireEvent.change(screen.getByLabelText(/search verses/i), { target: { value: 'loved' } });

    const result = await screen.findByRole('button', { name: /John 3:16/ });
    fireEvent.click(result);
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/AddVersePanel.test.tsx`
Expected: FAIL — `Cannot find module './AddVersePanel'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/AddVersePanel.tsx`:

```tsx
// The "+ Add" panel for a focus list: a Type/paste tab (tolerant reference parser)
// and a Search tab (shared verse-search). Both surface ScriptureRefs via onAddRefs;
// the panel never persists anything itself.
import { useEffect, useMemo, useState } from 'react';
import { parseReferences } from './reference-parser';
import { formatVerseLabel, type ScriptureRef } from './focus-list-types';
import { createVerseSearch } from '../verse-search';
import type { VerseCandidate, VerseSearchDeps } from '../verse-search-types';
import type { BibleTranslation } from '../translations';

export interface AddVersePanelProps {
  onAddRefs: (refs: ScriptureRef[]) => void;
  searchDeps: VerseSearchDeps;
  translation: BibleTranslation;
}

// A search candidate's osis ("jhn.3.16") carries the OSIS abbrev we store as
// ScriptureRef.book; candidate.book is the canonical display name for the label.
function candidateToRef(c: VerseCandidate): ScriptureRef {
  const book = c.osis.split('.')[0];
  const verseEnd = c.verseEnd ?? c.verseStart;
  return {
    book,
    chapter: c.chapter,
    verseStart: c.verseStart,
    verseEnd,
    label: formatVerseLabel(c.book, c.chapter, c.verseStart, verseEnd),
  };
}

export function AddVersePanel({ onAddRefs, searchDeps, translation }: AddVersePanelProps) {
  const [tab, setTab] = useState<'paste' | 'search'>('paste');
  const [text, setText] = useState('');
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VerseCandidate[]>([]);

  const search = useMemo(() => createVerseSearch(searchDeps), [searchDeps]);
  useEffect(() => () => search.cancel(), [search]);

  const submitPaste = () => {
    const { refs, unparsed: bad } = parseReferences(text);
    if (refs.length > 0) { onAddRefs(refs); setText(''); }
    setUnparsed(bad);
  };

  const runSearch = (value: string) => {
    setQuery(value);
    if (!value.trim()) { setResults([]); search.cancel(); return; }
    search.query(value, (next) => setResults(next));
  };

  return (
    <div className="px-3 py-2" style={{ borderTop: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}>
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => setTab('paste')}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: tab === 'paste' ? 'rgba(196,154,120,0.22)' : 'transparent', color: 'var(--deep-umber)' }}
        >
          Type / paste
        </button>
        <button
          onClick={() => setTab('search')}
          className="text-[11px] px-2 py-1 rounded"
          style={{ background: tab === 'search' ? 'rgba(196,154,120,0.22)' : 'transparent', color: 'var(--deep-umber)' }}
        >
          Search
        </button>
      </div>

      {tab === 'paste' ? (
        <div>
          <textarea
            aria-label="Paste references"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="John 3:16, Ps 23:1-3, Eph 2:8-9"
            rows={3}
            className="w-full text-[12px] p-2 rounded outline-none"
            style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', background: 'transparent' }}
          />
          <div className="mt-1">
            <button
              onClick={submitPaste}
              className="text-[11px] font-semibold px-2.5 py-1 rounded"
              style={{ border: '1px solid var(--deep-umber)', color: 'var(--deep-umber)' }}
            >
              Add
            </button>
          </div>
          {unparsed.length > 0 && (
            <p className="text-[10px] mt-1" style={{ color: '#b45454' }}>
              Couldn’t read: {unparsed.join(', ')}
            </p>
          )}
        </div>
      ) : (
        <div>
          <input
            aria-label="Search verses"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder={`Search verses in ${translation}…`}
            className="w-full text-[12px] p-2 rounded outline-none"
            style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', background: 'transparent' }}
          />
          <ul className="mt-1">
            {results.map((c) => {
              const verseEnd = c.verseEnd ?? c.verseStart;
              const refLabel = formatVerseLabel(c.book, c.chapter, c.verseStart, verseEnd);
              return (
                <li key={`${c.osis}-${c.source}`}>
                  <button
                    onClick={() => onAddRefs([candidateToRef(c)])}
                    className="w-full text-left text-[11px] px-2 py-1.5 rounded hover:bg-black/5"
                    style={{ color: 'var(--deep-umber)' }}
                  >
                    <span className="font-semibold">{refLabel}</span>
                    {c.text ? <span className="opacity-70"> — {c.text}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/AddVersePanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/AddVersePanel.tsx src/notepad/bible/focus/AddVersePanel.test.tsx
git commit -m "feat(bible): focus-list Add panel (type/paste + search)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 10: `FocusListSwitcher.tsx` — list switcher

A button labeled with the active list's title; opening it shows a dropdown
(desktop) / bottom sheet (mobile) of saved lists, the Quick list, `New list…`, and
(when the Quick list is active and savable) a `Save this list…` action. Naming uses
`window.prompt` for v1 (a styled name dialog is a documented polish follow-up).

**Files:**
- Create: `src/notepad/bible/focus/FocusListSwitcher.tsx`
- Test: `src/notepad/bible/focus/FocusListSwitcher.test.tsx`

**Interfaces:**
- Consumes: `QUICK_LIST_ID`, `FocusList` (Task 2); `useIsMobile` from `@/hooks/use-mobile`.
- Produces: `FocusListSwitcher` (props `{ savedLists, quickList, activeListId, canSave, onSelect, onNew, onSaveQuick, onDelete, editMode }`). Consumed by `FocusListView` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/FocusListSwitcher.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// useIsMobile reads matchMedia — stub it (desktop).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

import { FocusListSwitcher } from './FocusListSwitcher';
import { QUICK_LIST_ID, type FocusList } from './focus-list-types';

const quick: FocusList = { id: QUICK_LIST_ID, title: 'Quick list', position: -1, items: [] };
const saved: FocusList[] = [
  { id: 'list-1', title: 'Comfort', position: 0, items: [] },
  { id: 'list-2', title: 'Romans', position: 1, items: [] },
];

function makeProps(over: Partial<React.ComponentProps<typeof FocusListSwitcher>> = {}) {
  return {
    savedLists: saved,
    quickList: quick,
    activeListId: 'list-1',
    canSave: true,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onSaveQuick: vi.fn(),
    onDelete: vi.fn(),
    editMode: false,
    ...over,
  };
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(cleanup);

describe('FocusListSwitcher', () => {
  it('opens the panel and renders saved list names + the quick list', () => {
    render(<FocusListSwitcher {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ })); // the toggle shows the active title
    expect(screen.getByRole('button', { name: /^Romans$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick list \(unsaved\)/ })).toBeInTheDocument();
  });

  it('selecting a saved list calls onSelect with its id', () => {
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Romans$/ }));
    expect(props.onSelect).toHaveBeenCalledWith('list-2');
  });

  it('"New list…" prompts for a name and calls onNew', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Sunday AM');
    const props = makeProps();
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /New list/ }));
    expect(props.onNew).toHaveBeenCalledWith('Sunday AM');
  });

  it('offers Save when the Quick list is active, savable, and non-empty', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Sunday AM');
    const props = makeProps({
      activeListId: QUICK_LIST_ID,
      quickList: { ...quick, items: [{ id: 'i', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16', position: 0 }] },
    });
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Quick list/ })); // toggle (active title)
    fireEvent.click(screen.getByRole('button', { name: /Save this list/ }));
    expect(props.onSaveQuick).toHaveBeenCalledWith('Sunday AM');
  });

  it('shows a delete control per saved list only in edit mode', () => {
    const props = makeProps({ editMode: true });
    render(<FocusListSwitcher {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Comfort/ }));
    fireEvent.click(screen.getByRole('button', { name: /Delete Romans/ }));
    expect(props.onDelete).toHaveBeenCalledWith('list-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/FocusListSwitcher.test.tsx`
Expected: FAIL — `Cannot find module './FocusListSwitcher'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/FocusListSwitcher.tsx`:

```tsx
// List switcher for focus mode: dropdown (desktop) / bottom sheet (mobile). Lists
// saved lists with the active one checkmarked, the unsaved Quick list, "New list…",
// and — when the Quick list is active and savable — a "Save this list…" action.
// v1 names lists via window.prompt (a styled dialog is a deferred polish item).
import { useState } from 'react';
import { Check, ChevronDown, Plus, Save, X, Zap } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { QUICK_LIST_ID, type FocusList } from './focus-list-types';

export interface FocusListSwitcherProps {
  savedLists: FocusList[];
  quickList: FocusList;
  activeListId: string;
  canSave: boolean;
  onSelect: (id: string) => void;
  onNew: (title: string) => void;
  onSaveQuick: (title: string) => void;
  onDelete: (id: string) => void;
  editMode: boolean;
}

export function FocusListSwitcher({
  savedLists, quickList, activeListId, canSave,
  onSelect, onNew, onSaveQuick, onDelete, editMode,
}: FocusListSwitcherProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const activeTitle = activeListId === QUICK_LIST_ID
    ? quickList.title
    : savedLists.find((l) => l.id === activeListId)?.title ?? quickList.title;

  const promptName = (): string | null => {
    const name = window.prompt('Name this list');
    const trimmed = name?.trim();
    return trimmed ? trimmed : null;
  };

  const handleNew = () => {
    const name = promptName();
    if (name) { onNew(name); setOpen(false); }
  };
  const handleSaveQuick = () => {
    const name = promptName();
    if (name) { onSaveQuick(name); setOpen(false); }
  };

  const showSaveQuick = activeListId === QUICK_LIST_ID && canSave && quickList.items.length > 0;

  const panel = (
    <div
      className={isMobile
        ? 'fixed inset-x-0 bottom-0 z-50 rounded-t-xl p-3'
        : 'absolute left-0 top-full z-50 mt-1 w-56 rounded-lg p-1'}
      style={{ background: '#fff', border: '1px solid var(--pale-stone)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}
    >
      {savedLists.map((l) => (
        <div key={l.id} className="flex items-center">
          <button
            onClick={() => { onSelect(l.id); setOpen(false); }}
            className="flex-1 flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
            style={{ color: 'var(--deep-umber)' }}
          >
            <Check className="w-3 h-3 shrink-0" style={{ opacity: l.id === activeListId ? 1 : 0 }} />
            {l.title}
          </button>
          {editMode && (
            <button
              aria-label={`Delete ${l.title}`}
              onClick={() => onDelete(l.id)}
              className="p-1 rounded hover:bg-black/10"
            >
              <X className="w-3 h-3" style={{ color: '#b45454' }} />
            </button>
          )}
        </div>
      ))}

      <div className="my-1" style={{ borderTop: '1px solid var(--pale-stone)' }} />

      <button
        onClick={() => { onSelect(QUICK_LIST_ID); setOpen(false); }}
        className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        <Zap className="w-3 h-3 shrink-0" /> Quick list (unsaved)
      </button>

      <button
        onClick={handleNew}
        className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        <Plus className="w-3 h-3 shrink-0" /> New list…
      </button>

      {showSaveQuick && (
        <button
          onClick={handleSaveQuick}
          className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
          style={{ color: 'var(--deep-umber)' }}
        >
          <Save className="w-3 h-3 shrink-0" /> Save this list…
        </button>
      )}
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        {activeTitle}
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--silica)' }} />
      </button>
      {open && panel}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/FocusListSwitcher.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/FocusListSwitcher.tsx src/notepad/bible/focus/FocusListSwitcher.test.tsx
git commit -m "feat(bible): focus-list switcher (dropdown/bottom-sheet)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 11: `FocusListView.tsx` — focus-mode body

The focus-mode body: a control row (switcher + Add toggle + Edit toggle + verse
count), the optional Add panel, and the verse stack with per-row reorder/remove in
edit mode plus an empty state. Verse text comes from `useFocusListVerseText`.

**Files:**
- Create: `src/notepad/bible/focus/FocusListView.tsx`
- Test: `src/notepad/bible/focus/FocusListView.test.tsx`

**Interfaces:**
- Consumes: `UseScriptureFocusListsResult` (Task 7); `useFocusListVerseText` (Task 8); `FocusListSwitcher` (Task 10); `AddVersePanel` (Task 9); `VerseSearchDeps` from `../verse-search-types`; `BibleTranslation` from `../translations`.
- Produces: `FocusListView` (props `{ focus, translation, searchDeps }`). Consumed by `BibleStudyPane` (Task 13, via the reader's `renderFocusBody`).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/bible/focus/FocusListView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// useIsMobile (via FocusListSwitcher) reads matchMedia — stub it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

// Control the assembled verse text so the view test stays about the view.
const { verseTextRef } = vi.hoisted(() => ({
  verseTextRef: { current: { itemTexts: [] as unknown[], loading: false } },
}));
vi.mock('./useFocusListVerseText', () => ({
  useFocusListVerseText: () => verseTextRef.current,
}));

import { FocusListView } from './FocusListView';
import type { UseScriptureFocusListsResult } from './useScriptureFocusLists';
import type { FocusListItem } from './focus-list-types';
import type { VerseSearchDeps } from '../verse-search-types';

const item = (id: string, label: string): FocusListItem => ({
  id, book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label, position: 0,
});

function makeFocus(items: FocusListItem[]): UseScriptureFocusListsResult {
  return {
    focusModeOn: true,
    toggleFocusMode: vi.fn(),
    savedLists: [],
    quickList: { id: '__quick__', title: 'Quick list', position: -1, items },
    activeListId: '__quick__',
    activeList: { id: '__quick__', title: 'Quick list', position: -1, items },
    canSave: false,
    selectList: vi.fn(),
    newList: vi.fn(),
    saveQuickList: vi.fn(),
    deleteList: vi.fn(),
    addRefs: vi.fn(),
    removeItem: vi.fn(),
    reorderItem: vi.fn(),
  };
}

// Drive the mocked hook from the focus's items.
function wireVerseText(items: FocusListItem[]) {
  verseTextRef.current = {
    itemTexts: items.map((it) => ({ item: it, lines: [{ verse: it.verseStart, text: `text ${it.label}` }], missing: false })),
    loading: false,
  };
}

const searchDeps = {} as VerseSearchDeps;
beforeEach(() => { verseTextRef.current = { itemTexts: [], loading: false }; });
afterEach(cleanup);

describe('FocusListView', () => {
  it('renders the verse count', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    render(<FocusListView focus={makeFocus(items)} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.getByText('2 verses')).toBeInTheDocument();
  });

  it('shows the empty state when the list has no items', () => {
    render(<FocusListView focus={makeFocus([])} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.getByText(/No verses yet/i)).toBeInTheDocument();
  });

  it('toggles the Add panel', () => {
    render(<FocusListView focus={makeFocus([])} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.queryByLabelText(/paste references/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add verses/i }));
    expect(screen.getByLabelText(/paste references/i)).toBeInTheDocument();
  });

  it('reorders a verse up in edit mode', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    const focus = makeFocus(items);
    render(<FocusListView focus={focus} translation="BSB" searchDeps={searchDeps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit list/i }));
    fireEvent.click(screen.getByRole('button', { name: /Move John 3:17 up/i }));
    expect(focus.reorderItem).toHaveBeenCalledWith('b', 'up');
  });

  it('removes a verse in edit mode', () => {
    const items = [item('a', 'John 3:16')];
    wireVerseText(items);
    const focus = makeFocus(items);
    render(<FocusListView focus={focus} translation="BSB" searchDeps={searchDeps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit list/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remove John 3:16/i }));
    expect(focus.removeItem).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/focus/FocusListView.test.tsx`
Expected: FAIL — `Cannot find module './FocusListView'`.

- [ ] **Step 3: Write the implementation**

Create `src/notepad/bible/focus/FocusListView.tsx`:

```tsx
// The focus-mode body: control row (switcher + Add + Edit + count), the optional
// Add panel, and the ordered verse stack (with per-row reorder/remove in edit mode
// and a friendly empty state). Verse text is fetched/assembled by
// useFocusListVerseText so the stack reads in the active translation.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react';
import type { BibleTranslation } from '../translations';
import type { VerseSearchDeps } from '../verse-search-types';
import type { UseScriptureFocusListsResult } from './useScriptureFocusLists';
import { useFocusListVerseText } from './useFocusListVerseText';
import { FocusListSwitcher } from './FocusListSwitcher';
import { AddVersePanel } from './AddVersePanel';

export interface FocusListViewProps {
  focus: UseScriptureFocusListsResult;
  translation: BibleTranslation;
  searchDeps: VerseSearchDeps;
}

export function FocusListView({ focus, translation, searchDeps }: FocusListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const { itemTexts } = useFocusListVerseText(focus.activeList.items, translation);

  const count = focus.activeList.items.length;

  return (
    <div style={{ fontFamily: 'Outfit, sans-serif' }}>
      {/* control row */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--pale-stone)' }}>
        <FocusListSwitcher
          savedLists={focus.savedLists}
          quickList={focus.quickList}
          activeListId={focus.activeListId}
          canSave={focus.canSave}
          onSelect={focus.selectList}
          onNew={focus.newList}
          onSaveQuick={focus.saveQuickList}
          onDelete={focus.deleteList}
          editMode={editMode}
        />
        <button
          aria-label="Add verses"
          aria-pressed={showAdd}
          onClick={() => setShowAdd((s) => !s)}
          className="p-1.5 rounded hover:bg-black/5"
          style={{ background: showAdd ? 'rgba(196,154,120,0.22)' : 'transparent' }}
        >
          <Plus className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
        </button>
        <button
          aria-label="Edit list"
          aria-pressed={editMode}
          onClick={() => setEditMode((e) => !e)}
          className="p-1.5 rounded hover:bg-black/5"
          style={{ background: editMode ? 'rgba(196,154,120,0.22)' : 'transparent' }}
        >
          <Pencil className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--silica)' }}>
          {count} verse{count === 1 ? '' : 's'}
        </span>
      </div>

      {showAdd && (
        <AddVersePanel onAddRefs={focus.addRefs} searchDeps={searchDeps} translation={translation} />
      )}

      {/* verse stack */}
      <div className="px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        {count === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            No verses yet. Tap ＋ to add a verse, or paste a list of references.
          </p>
        ) : (
          itemTexts.map((it, idx) => (
            <div key={it.item.id} className="mb-4">
              <div className="flex items-center gap-1 mb-1">
                <span
                  className="text-[10px] font-semibold tracking-[0.14em]"
                  style={{ color: 'var(--lamplight-accent)', fontFamily: 'Outfit, sans-serif' }}
                >
                  {it.item.label.toUpperCase()}
                </span>
                {editMode && (
                  <span className="ml-auto flex items-center gap-0.5">
                    <button
                      aria-label={`Move ${it.item.label} up`}
                      disabled={idx === 0}
                      onClick={() => focus.reorderItem(it.item.id, 'up')}
                      className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" style={{ color: 'var(--deep-umber)' }} />
                    </button>
                    <button
                      aria-label={`Move ${it.item.label} down`}
                      disabled={idx === itemTexts.length - 1}
                      onClick={() => focus.reorderItem(it.item.id, 'down')}
                      className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3 h-3" style={{ color: 'var(--deep-umber)' }} />
                    </button>
                    <button
                      aria-label={`Remove ${it.item.label}`}
                      onClick={() => focus.removeItem(it.item.id)}
                      className="p-0.5 rounded hover:bg-black/10"
                    >
                      <X className="w-3 h-3" style={{ color: '#b45454' }} />
                    </button>
                  </span>
                )}
              </div>
              {it.missing ? (
                <p className="text-[12px] italic" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                  Not available in {translation}.
                </p>
              ) : (
                <p className="text-[13px] leading-[1.9]" style={{ color: 'var(--deep-umber)' }}>
                  {it.lines.map((l) => l.text).join(' ')}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/bible/focus/FocusListView.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/focus/FocusListView.tsx src/notepad/bible/focus/FocusListView.test.tsx
git commit -m "feat(bible): focus-list reading/edit body view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 12: `BibleReader.tsx` — focus toggle + body branch + per-verse add

Add an **optional** `focus?: BibleReaderFocusBridge` prop: a `ListOrdered` toggle in
the header cluster, a body branch to `focus.renderFocusBody()` when focus mode is on,
and a per-verse `Plus` "add to active list" affordance while browsing. The prop is
optional so the other consumer (`StudyReader.tsx`) stays untouched.

**Files:**
- Modify: `src/notepad/bible/BibleReader.tsx`
- Test: `src/notepad/bible/BibleReader.test.tsx` (append cases)

**Interfaces:**
- Consumes: `FocusList`, `ScriptureRef` (Task 2).
- Produces: `BibleReaderFocusBridge` (see Canonical Interfaces) + the optional `focus` prop on `BibleReaderProps`. Consumed by `BibleStudyPane` (Task 13).

- [ ] **Step 1: Write the failing tests**

First, add the two type imports to the TOP import group of the test file (after the
existing `import { toast } from 'sonner';` line — NOT below the `describe` blocks, or
the `import/first` lint rule fires):

```tsx
import type { BibleReaderFocusBridge } from './BibleReader';
import type { FocusList } from './focus/focus-list-types';
```

Then append this block after the last existing `describe` block (before EOF):

```tsx
const quickList: FocusList = { id: '__quick__', title: 'Quick list', position: -1, items: [] };

function makeBridge(over: Partial<BibleReaderFocusBridge> = {}): BibleReaderFocusBridge {
  return {
    focusModeOn: false,
    onToggleFocusMode: vi.fn(),
    activeList: quickList,
    onAddCurrentVerse: vi.fn(),
    renderFocusBody: () => <div data-testid="focus-body">FOCUS BODY</div>,
    ...over,
  };
}

describe('BibleReader focus bridge', () => {
  it('renders no focus toggle when no focus prop is given', () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /focus list/i })).not.toBeInTheDocument();
  });

  it('renders the focus toggle and reports a click', () => {
    const bridge = makeBridge();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} focus={bridge} />);
    fireEvent.click(screen.getByRole('button', { name: /focus list/i }));
    expect(bridge.onToggleFocusMode).toHaveBeenCalled();
  });

  it('renders the focus body (not the chapter) when focus mode is on', () => {
    const bridge = makeBridge({ focusModeOn: true });
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} focus={bridge} />);
    expect(screen.getByTestId('focus-body')).toBeInTheDocument();
    expect(screen.queryByText(/In the beginning was the Word/)).not.toBeInTheDocument();
  });

  it('adds the current verse to the active list without selecting it', () => {
    const bridge = makeBridge();
    const onSelectVerse = vi.fn();
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        focus={bridge} onSelectVerse={onSelectVerse}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add John 1:1 to Quick list/i }));
    expect(bridge.onAddCurrentVerse).toHaveBeenCalledWith({
      book: 'jhn', chapter: 1, verseStart: 1, verseEnd: 1, label: 'John 1:1',
    });
    expect(onSelectVerse).not.toHaveBeenCalled(); // stopPropagation kept the tap off the verse
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: FAIL — `BibleReaderFocusBridge` is not exported / `focus` prop unknown.

- [ ] **Step 3: Add the `ReactNode` + lucide + focus-type imports**

In `src/notepad/bible/BibleReader.tsx`, change the React import (line 2) to add `type ReactNode`:

```ts
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
```

Change the lucide import (line 3) to add `ListOrdered, Plus`:

```ts
import { ChevronLeft, ChevronRight, CornerDownLeft, Search, Info, WrapText, List, Rows3, ListOrdered, Plus } from 'lucide-react';
```

Add the focus-type import directly under the lucide import:

```ts
import type { FocusList, ScriptureRef } from './focus/focus-list-types';
```

- [ ] **Step 4: Declare the bridge type and the optional prop**

In `BibleReaderProps` (after the `onVerseLayoutChange` line, before the closing `}`), add:

```ts
  /** Optional Scripture-focus bridge. When present, the reader shows a Focus toggle,
      can render a focus list instead of the chapter, and offers a per-verse "add to
      list" affordance while browsing. Omitted by the Study reader. */
  focus?: BibleReaderFocusBridge;
```

Add the exported interface immediately above the `BibleReaderProps` interface declaration:

```ts
/** Bridge the host (BibleStudyPane) passes so the reader can drive focus mode. */
export interface BibleReaderFocusBridge {
  focusModeOn: boolean;
  onToggleFocusMode: () => void;
  /** The active focus list (quick or saved); null only when no list exists. */
  activeList: FocusList | null;
  onAddCurrentVerse: (ref: ScriptureRef) => void;
  renderFocusBody: () => ReactNode;
}
```

Add `focus` to the destructured params (after `onVerseLayoutChange,`):

```ts
  onVerseLayoutChange,
  focus,
```

- [ ] **Step 5: Add the header toggle**

In the header cluster `<div className="flex items-center gap-1">` (line 179), insert the
focus toggle as the FIRST child (before the verse-layout button). Change:

```tsx
        <div className="flex items-center gap-1">
          <button
            aria-label={`Change verse layout (currently ${VERSE_LAYOUT_LABEL[verseLayout].toLowerCase()})`}
```

to:

```tsx
        <div className="flex items-center gap-1">
          {focus && (
            <button
              aria-label="Focus list"
              aria-pressed={focus.focusModeOn}
              title="Focus — read a curated verse list"
              onClick={focus.onToggleFocusMode}
              className="p-1.5 rounded hover:bg-black/5 transition-colors"
              style={{ background: focus.focusModeOn ? 'rgba(196,154,120,0.22)' : 'transparent' }}
            >
              <ListOrdered className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
            </button>
          )}
          <button
            aria-label={`Change verse layout (currently ${VERSE_LAYOUT_LABEL[verseLayout].toLowerCase()})`}
```

- [ ] **Step 6: Branch the body to the focus view**

Wrap the existing body content in a focus-mode ternary. Change the body opening
(line 334-336):

```tsx
      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        {loading && (
```

to:

```tsx
      {/* body */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        {focus?.focusModeOn ? focus.renderFocusBody() : (<>
        {loading && (
```

Then close the fragment+ternary just before the body `</div>`. Change the end of the
body block (the close of the highlight conditional through the component end):

```tsx
        )}
      </div>
    </div>
  );
}
```

to:

```tsx
        )}
        </>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the per-verse "add to active list" affordance**

Add a stable local just below `const label = ...` (line 163), so the narrowing
survives into the click handler:

```ts
  // Show the per-verse "add to list" control while browsing (focus mode off) when a
  // list is active. A const so the narrowing holds inside the click closure.
  const focusBrowseAdd = focus && !focus.focusModeOn ? focus : null;
```

Inside the `verseSpan`, add the button after the verse text. Change:

```tsx
                    <sup className="text-[9px] font-bold mr-1" style={{ color: verseNumberColor }}>{v.verse}</sup>
                    {v.text}{blockMode ? '' : ' '}
                  </span>
```

to:

```tsx
                    <sup className="text-[9px] font-bold mr-1" style={{ color: verseNumberColor }}>{v.verse}</sup>
                    {v.text}{blockMode ? '' : ' '}
                    {focusBrowseAdd?.activeList && (
                      <button
                        type="button"
                        aria-label={`Add ${meta?.name ?? book} ${chapter}:${v.verse} to ${focusBrowseAdd.activeList.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          focusBrowseAdd.onAddCurrentVerse({
                            book, chapter, verseStart: v.verse, verseEnd: v.verse,
                            label: `${meta?.name ?? book} ${chapter}:${v.verse}`,
                          });
                        }}
                        className="inline-flex items-center align-middle ml-1 p-0.5 rounded hover:bg-black/10"
                      >
                        <Plus className="w-3 h-3" style={{ color: 'var(--silica)' }} />
                      </button>
                    )}
                  </span>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/notepad/bible/BibleReader.test.tsx`
Expected: PASS — the new focus-bridge cases plus all existing cases (the `focus` prop is optional, so every prior test still renders).

- [ ] **Step 9: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors. `StudyReader.tsx` (which renders `<BibleReader>` without `focus`) still compiles because the prop is optional.

- [ ] **Step 10: Commit**

```bash
git add src/notepad/bible/BibleReader.tsx src/notepad/bible/BibleReader.test.tsx
git commit -m "feat(bible): BibleReader focus bridge (toggle, body branch, per-verse add)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 13: `BibleStudyPane.tsx` — wire the hook + bridge

Instantiate `useScriptureFocusLists`, build per-translation `searchDeps`, and pass the
`focus` bridge to `BibleReader`. Because both desktop (`StudyWindow`) and mobile
(`MobileNotepadWorkspace`) render `BibleStudyPane`, this single wiring lights up Focus
on both surfaces — no separate mobile edit.

**Files:**
- Modify: `src/notepad/bible/BibleStudyPane.tsx`
- Test: `src/notepad/bible/BibleStudyPane.test.tsx` (append cases + mocks)

**Interfaces:**
- Consumes: `useScriptureFocusLists` (Task 7); `FocusListView` (Task 11); `createBrowserVerseSearchDeps` from `./verse-search-client`; `supabase` from `@/lib/supabase`; `toast` from `sonner`; the `BibleReader` `focus` prop (Task 12).
- Produces: a fully wired Focus feature on the Study Bible pane (no new exports).

- [ ] **Step 1: Write the failing tests**

Append to the TOP-LEVEL of `src/notepad/bible/BibleStudyPane.test.tsx` these mocks
(next to the existing `vi.mock` calls — they hoist, so position is cosmetic). `BibleStudyPane`
now imports these modules, so the mocks keep every test hermetic:

```tsx
const { focusFake } = vi.hoisted(() => ({
  focusFake: {
    focusModeOn: false,
    toggleFocusMode: vi.fn(),
    savedLists: [],
    quickList: { id: '__quick__', title: 'Quick list', position: -1, items: [] },
    activeListId: '__quick__',
    activeList: { id: '__quick__', title: 'Quick list', position: -1, items: [] },
    canSave: false,
    selectList: vi.fn(),
    newList: vi.fn(),
    saveQuickList: vi.fn(),
    deleteList: vi.fn(),
    addRefs: vi.fn(),
    removeItem: vi.fn(),
    reorderItem: vi.fn(),
  },
}));
vi.mock('./focus/useScriptureFocusLists', () => ({ useScriptureFocusLists: () => focusFake }));
vi.mock('./focus/FocusListView', () => ({ FocusListView: () => <div data-testid="focus-body">focus</div> }));
vi.mock('./verse-search-client', () => ({ createBrowserVerseSearchDeps: () => ({}) }));
vi.mock('sonner', () => ({ toast: vi.fn() }));
```

Add the `toast` import and a `ReactNode` type import to the TOP import group (the
existing file uses the automatic JSX runtime and does not import `React`, so reference
`ReactNode` directly rather than `React.ReactNode`):

```tsx
import { toast } from 'sonner';
import type { ReactNode } from 'react';
```

Append a new `describe` block (after the existing one):

```tsx
describe('BibleStudyPane — Scripture Focus wiring', () => {
  it('passes a focus bridge to the reader', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const bridge = readerProps.current?.focus as Record<string, unknown> | undefined;
    expect(bridge).toBeTruthy();
    expect(typeof bridge?.onToggleFocusMode).toBe('function');
    expect(typeof bridge?.renderFocusBody).toBe('function');
  });

  it('toggling via the bridge calls the hook toggle', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    (readerProps.current?.focus as { onToggleFocusMode: () => void }).onToggleFocusMode();
    expect(focusFake.toggleFocusMode).toHaveBeenCalled();
  });

  it('renderFocusBody renders the focus list view', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const node = (readerProps.current?.focus as { renderFocusBody: () => ReactNode }).renderFocusBody();
    render(<>{node}</>);
    expect(screen.getByTestId('focus-body')).toBeInTheDocument();
  });

  it('onAddCurrentVerse adds the ref and toasts', () => {
    render(<BibleStudyPane lamplightAdapter={adapter} invoke={vi.fn()} />);
    const ref = { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' };
    (readerProps.current?.focus as { onAddCurrentVerse: (r: typeof ref) => void }).onAddCurrentVerse(ref);
    expect(focusFake.addRefs).toHaveBeenCalledWith([ref]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('John 3:16'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/notepad/bible/BibleStudyPane.test.tsx`
Expected: FAIL — `readerProps.current?.focus` is undefined (no bridge wired yet).

- [ ] **Step 3: Add imports**

In `src/notepad/bible/BibleStudyPane.tsx`, add `useMemo` to the React import (line 2):

```ts
import { useCallback, useMemo, useRef, useState } from 'react';
```

Add these imports under the existing bible imports (after the `loadBiblePassage` import, line 19):

```ts
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useScriptureFocusLists } from './focus/useScriptureFocusLists';
import { FocusListView } from './focus/FocusListView';
import { createBrowserVerseSearchDeps } from './verse-search-client';
```

- [ ] **Step 4: Instantiate the hook + search deps**

After the `useBiblePrefs()` destructure (line 57: `const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout } = useBiblePrefs();`), add:

```ts
  const focus = useScriptureFocusLists();
  const searchDeps = useMemo(() => createBrowserVerseSearchDeps(supabase, translation), [translation]);
```

- [ ] **Step 5: Pass the bridge to `BibleReader`**

In the `<BibleReader ... />` element, add the `focus` prop (after `onRemoveHighlight={removeHighlight}`):

```tsx
            onRemoveHighlight={removeHighlight}
            focus={{
              focusModeOn: focus.focusModeOn,
              onToggleFocusMode: focus.toggleFocusMode,
              activeList: focus.activeList,
              onAddCurrentVerse: (ref) => { focus.addRefs([ref]); toast(`Added ${ref.label}`); },
              renderFocusBody: () => (
                <FocusListView focus={focus} translation={translation} searchDeps={searchDeps} />
              ),
            }}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/notepad/bible/BibleStudyPane.test.tsx`
Expected: PASS — the four new wiring cases plus all existing cases.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors.

- [ ] **Step 8: Commit**

```bash
git add src/notepad/bible/BibleStudyPane.tsx src/notepad/bible/BibleStudyPane.test.tsx
git commit -m "feat(bible): wire Scripture Focus into the Study Bible pane (desktop + mobile)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01E7WpW31reSKSt4Mve2JdQq"
```

---

### Task 14: Final verification + migration apply + smoke

Verify the whole feature against the known-red baseline, apply migration `042`
(now that the code that reads it has landed), and run the manual smoke checklist.

**Files:**
- No new code. Applies `supabase/migrations/042_scripture_focus_lists.sql` (Task 1).

**Interfaces:**
- Consumes: everything from Tasks 1–13.
- Produces: a verified, migrated, smoke-tested feature.

- [ ] **Step 1: Run the focus suite green**

Run: `npx vitest run src/notepad/bible/focus src/notepad/session/session-storage.focus.test.ts src/notepad/bible/BibleReader.test.tsx src/notepad/bible/BibleStudyPane.test.tsx`
Expected: PASS — every focus test plus the two modified host suites.

- [ ] **Step 2: Typecheck the build**

Run: `npx tsc -b`
Expected: no NEW errors. The only acceptable pre-existing errors are in `force-sphere.test.ts` (the known-red baseline). If any error names a `focus/` file, `BibleReader.tsx`, or `BibleStudyPane.tsx`, fix it before proceeding.

- [ ] **Step 3: Lint the new/changed files**

Run: `npm run lint`
Expected: **zero new** errors versus the ~114-error baseline. Sanity-check the focus module specifically:

Run: `npx eslint src/notepad/bible/focus`
Expected: clean (0 errors) for the new module.

- [ ] **Step 4: Apply migration `042` (now, after code lands)**

Run: `supabase db push`
Expected: applies `042_scripture_focus_lists.sql` (the only pending migration); the two tables + RLS policies are created on the live project. (History is already in sync; only `042` is pending — see [Migration apply workflow] in project memory.)

- [ ] **Step 5: Manual smoke checklist (user runs in the app)**

Document this for the user; it is not automated:

1. **Toggle Focus:** open the Study Bible pane → the `ListOrdered` toggle appears in the header → click it → the body swaps to the focus view with the control row.
2. **Paste a batch:** `＋ Add` → Type/paste → enter `John 3:16, Ps 23:1-3, Eph 2:8-9` → `Add` → all three appear in order, full text, in the current translation.
3. **Unparseable reported:** paste `John 3:16, gibberish` → John 3:16 adds; "Couldn’t read: gibberish" shows.
4. **Search-add:** Search tab → type a keyword → tap a result → it appends.
5. **Tap-while-reading:** toggle Focus OFF → each verse shows a `＋` → tapping it adds that verse to the active list and toasts "Added …" (without selecting/highlighting the verse).
6. **Reorder/remove:** `✎ Edit` → up/down move a verse (disabled at the ends); `✕` removes one.
7. **Save (signed-in):** with the Quick list active and non-empty → switcher → `Save this list…` → name it → it becomes a named saved list and the Quick list clears.
8. **Switch lists:** the switcher moves between saved lists and the Quick list (✓ on active).
9. **Translation re-render:** change the translation in the reader header → the focus list re-renders in the new translation; a verse missing in that translation shows "Not available in {translation}".
10. **Signed-out:** only the Quick list works (persists across refresh via localStorage); `New list…` / `Save this list…` surface the "Sign in to save lists." toast.
11. **Mobile:** repeat 1–9 on the mobile Bible tab — the switcher opens as a bottom sheet; all flows work (same `BibleStudyPane`).

- [ ] **Step 6: Update project memory**

Update `~/.claude/projects/-Users-newmac-Downloads-Psalms-app/memory/project_scripture_focus_list.md` to record: plan executed, migration `042` applied, branch `feat/scripture-focus-list` ready for merge/PR, manual smoke status.

- [ ] **Step 7: Final state**

No code commit is required here unless `supabase db push` modified a tracked file
(it normally does not). The feature is fully committed across Tasks 1–13. Hand the
branch off to the **finishing-a-development-branch** skill for merge/PR.

---
