# Study Mode (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a distinct, reading-first "Study" space to the notepad — a three-pane Study Desk (apparatus rail · Scripture reader · Lamplight Study chat on Claude Opus) reachable via a `Journaling | Study` toggle, grounded in curated apparatus data, with the user's notes offered (never auto-injected).

**Architecture:** A nested React-Router layout hoists one `NotepadProvider` above both the existing journaling workspace and a new `StudyWorkspace`, so toggling does not remount the notes brain. The apparatus rail reads two new public-read tables (`bible_books`, `bible_cross_references`) directly via the anon client (no edge function). Lamplight Study is a new edge function `lamplight-study` that mirrors `lamplight-chat`, reusing every `_shared/*` module and the existing `runBibleChatPipeline` (parameterized to run on Opus), grounded in verse text + apparatus, with a notes-on-offer affordance. Study chat history reuses `lamplight_chat_threads` via a new `surface` marker.

**Tech Stack:** Vite + React 18 + React Router v6 (JSX `<Routes>`/`<Route>`), TypeScript, Supabase (Postgres + RLS + Deno edge functions), Anthropic Messages API (tool-use), Voyage embeddings, vitest (tests beside source).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec and project caveats.

- **Opus model id is `claude-opus-4-8`** (Claude Opus 4.8 — confirmed against the `claude-api` reference; do not guess or append a date suffix).
- **Typecheck with `tsc -b`** (the real build command), NOT bare `tsc --noEmit` (root tsconfig has `files: []`, so `--noEmit` checks nothing).
- **Pre-existing red baseline** — the repo ships ~114 lint errors, 4 tsc errors (`src/**/force-sphere.test.ts`), and 2 failing test files (`Editor.toolbar-placement`, `garden-scene`) unrelated to this work. The bar is **zero NEW** lint/tsc/test failures, not a green repo.
- **Edge functions deploy MANUALLY**: `supabase functions deploy lamplight-study --use-api` (not in CI; a Vercel/frontend deploy never carries `supabase/functions/**`).
- **Migrations apply via** `supabase db push` (history in sync; only new ones pending).
- **Reuse existing secrets** `ANTHROPIC_API_KEY` and `VOYAGE_AI_KEY` (already set as edge-function secrets). No new keys.
- **Migration numbers are 032, 033, 034** — 031 is reserved for the in-flight `feat/scripture-ref-keep-pill` branch (`031_bible_passages_text_trgm.sql`); do not reuse it.
- **Book abbreviations** are lowercase 3-char OSIS-style codes (`gen`, `exo`, `psa`, `jhn`, `rom`, …) — the canonical 66-book list is `src/notepad/bible/bible-books.ts` (`BIBLE_BOOKS`). `passage_ref` format is `` `${book}.${chapter}` `` (e.g. `jhn.10`).
- **Study accent** is Twilight Indigo `#43508C`; the existing scripture gold is `#C49A78`; the cream reading base is retained.
- **Tests**: vitest, `*.test.ts` / `*.test.tsx` co-located with source. Full suite: `npm test` (= `vitest run`). Single file: `npx vitest run <path>`. React hook/component tests need `// @vitest-environment jsdom` at the top.
- **Git hygiene**: `git add` explicit Study paths only — never `git add -A` or `git add .`.
- **Isolation**: all Study-specific frontend code lives under `src/notepad/study/`; the edge function under `supabase/functions/lamplight-study/`. Do not let Study concerns bleed into journaling code beyond the small, justified shared-table/theming changes called out below.

## File Structure

**New — backend (`supabase/functions/lamplight-study/`):**
- `index.ts` — request handler (mirrors `lamplight-chat/index.ts`); gates, quota (`study` scope), notes-on-offer, persistence with `surface='study'`.
- `study-context.ts` — `buildStudyContext()` (apparatus-grounded `BibleChatContext`) + `selectOfferedNotes()` (notes-on-offer selection). Unit-tested.
- `prompts/study-chat.ts` — `STUDY_CHAT_PROMPT` (`ChatPromptModule`).
- `prompts/study-insight.ts` — `STUDY_INSIGHT_PROMPT` (`ChatPromptModule`).

**Modified — backend shared:**
- `supabase/functions/_shared/anthropic.ts` — add `opus` to `LLMModel` + `MODEL_IDS`.
- `supabase/functions/lamplight-chat/bible-chat-pipeline.ts` — optional `model` param (default `'sonnet'`); add optional `bookContext` to `BibleChatContext`.
- `supabase/functions/_shared/quota.ts` — add a `study` `QuotaScope` + env knobs.
- `supabase/functions/lamplight-chat/index.ts` — filter existing thread lookups by `surface='chat'`.

**New — migrations / data (`supabase/migrations/`, `scripts/`):**
- `032_bible_books.sql` — table + public-read RLS + 66-row seed.
- `033_bible_cross_references.sql` — table + public-read RLS + indexes.
- `034_lamplight_chat_threads_surface.sql` — add `surface` column + widen the active-passage unique index.
- `scripts/ingest-cross-references.ts` — idempotent OpenBible→`bible_cross_references` loader (OSIS→book normalization).
- `scripts/osis-book-map.ts` — OSIS-abbrev→`book` map (shared by ingest + its test).

**New — frontend (`src/notepad/study/`):**
- `study-chat-client.ts` — `sendStudyMessage` / `requestStudyInsight` (returns `offeredNotes`).
- `useStudyChatThread.ts` — mirrors `useChatThread`, scoped to `surface='study'`.
- `useApparatus.ts` — fetches `bible_books` + `bible_cross_references` for the open passage.
- `useNotesOnOffer.ts` — holds offered-notes + included-ids state.
- `apparatus-queries.ts` — `crossesTestament()` + same-era / same-author query builders (pure, unit-tested).
- `StudyWorkspace.tsx` — three-pane shell, `data-mode="study"`.
- `panes/ApparatusRail.tsx`, `panes/StudyReader.tsx`, `panes/LamplightStudyPanel.tsx`.
- `study-theme.css` — `[data-mode="study"]` accent overrides.

**Modified — frontend:**
- `src/index.css` — `--lamplight-accent` default in `:root`.
- `src/notepad/bible/BibleReader.tsx` — verse-number color → `var(--lamplight-accent)`.
- `src/components/sections/notepad/StudyWindow.tsx` — active-tab underline `#C49A78` → `var(--lamplight-accent)`.
- `src/components/sections/Notepad.tsx` — export `NotepadWorkspace`.
- `src/auth/username/NotepadRoutes.tsx` — `LocalNotepadLayout` / `VanityNotepadLayout` (provider hoist + `<Outlet/>`).
- `src/App.tsx` — convert the two notepad routes to nested layout routes.
- `src/notepad/components/NotepadToolbar.tsx` — mount `<StudyModeToggle/>`.
- `src/notepad/study/StudyModeToggle.tsx` — the `Journaling | Study` segmented control.

---

## Phasing & dependency order

- **Phase A — Backend shared primitives** (T1–T3): Opus model, pipeline param, quota scope. No UI dependency.
- **Phase B — Data layer** (T4–T7): migrations + ingest. Independent of A.
- **Phase C — Lamplight Study backend** (T8–T12): depends on A (Opus/pipeline/quota) and B (apparatus tables, surface column).
- **Phase D — Frontend data plumbing** (T13–T16): client, hooks, query builders. Depends on C (response shape) + B (tables).
- **Phase E — Theming** (T17): independent; do before panes.
- **Phase F — Routing & toggle** (T18–T20): provider hoist + nested routes + toggle.
- **Phase G — Study Desk panes** (T21–T24): depends on D, E, F.
- **Phase H — Integration verification** (T25): baselines + manual deploy + smoke.

Each task ends with an independently testable deliverable and a commit. Run `npx vitest run <new-test-path>` after each implementation step; run `npx tsc -b` before each commit that touches `.ts`/`.tsx`.

---

## Phase A — Backend shared primitives

### Task 1: Add Opus to the Anthropic adapter

**Files:**
- Modify: `supabase/functions/_shared/anthropic.ts:19-24`
- Test: `supabase/functions/_shared/anthropic.test.ts` (create)

**Interfaces:**
- Produces: `LLMModel` now includes `'opus'`; `MODEL_IDS.opus === 'claude-opus-4-8'`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createAnthropicAdapter } from './anthropic.ts';

describe('anthropic adapter model mapping', () => {
  it('sends the published Opus model id when model is "opus"', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'emit', input: { ok: true } }],
        model: 'claude-opus-4-8',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    const llm = createAnthropicAdapter({ apiKey: 'k', fetch: fetch as unknown as typeof globalThis.fetch });
    await llm.generate({
      model: 'opus',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      tool: { name: 'emit', description: 'd', input_schema: { type: 'object' } },
    });
    const body = JSON.parse((fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('claude-opus-4-8');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/anthropic.test.ts`
Expected: FAIL — TypeScript/`generate` rejects `model: 'opus'` (not in union) or `body.model` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `supabase/functions/_shared/anthropic.ts`, replace lines 19-24:

```typescript
export type LLMModel = 'sonnet' | 'haiku' | 'opus';

const MODEL_IDS: Record<LLMModel, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku:  'claude-haiku-4-5-20251001',
  opus:   'claude-opus-4-8',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/anthropic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/anthropic.ts supabase/functions/_shared/anthropic.test.ts
git commit -m "feat(study): add Opus (claude-opus-4-8) to Anthropic adapter MODEL_IDS"
```

---

### Task 2: Parameterize the chat pipeline by model + add optional bookContext

**Files:**
- Modify: `supabase/functions/lamplight-chat/bible-chat-pipeline.ts:5,26-35,43-54`
- Test: `supabase/functions/lamplight-chat/bible-chat-pipeline.test.ts` (append a case)

**Interfaces:**
- Consumes: `LLMModel` from `../_shared/anthropic.ts` (Task 1).
- Produces: `runBibleChatPipeline(args: { llm; ctx; prompt?; model?: LLMModel })` — defaults to `'sonnet'`; `BibleChatContext` gains optional `bookContext?: BookContext | null`.

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/lamplight-chat/bible-chat-pipeline.test.ts`:

```typescript
it('passes the requested model through to the LLM adapter', async () => {
  const generate = vi.fn().mockResolvedValue({
    parsed: { reply: 'ok', citations: [] },
    modelUsed: 'claude-opus-4-8', promptTokens: 5, completionTokens: 7,
  });
  const llm = { generate } as unknown as import('../_shared/anthropic.ts').LLMAdapter;
  const ctx: import('./bible-chat-pipeline.ts').BibleChatContext = {
    passageRef: 'jhn 10', passageText: 'I am the good shepherd.',
    crossRefs: [], notes: [], history: [], userMessage: 'hi',
    allowedNoteIds: new Set(), allowedVerseRefs: new Set(),
  };
  await runBibleChatPipeline({ llm, ctx, model: 'opus' });
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
});
```

(`runBibleChatPipeline` and `vi` are already imported in this file — confirm; if not, add `import { vi } from 'vitest';`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-chat/bible-chat-pipeline.test.ts`
Expected: FAIL — `model` is hardcoded to `'sonnet'`, so the assertion sees `model: 'sonnet'`.

- [ ] **Step 3: Write minimal implementation**

In `supabase/functions/lamplight-chat/bible-chat-pipeline.ts`:

Change the import on line 5:

```typescript
import type { LLMAdapter, LLMModel } from '../_shared/anthropic.ts';
```

Add a `BookContext` type and an optional field to `BibleChatContext` (replace lines 26-35):

```typescript
export interface BookContext {
  book: string;            // human name, e.g. "John"
  author: string;
  authorNote: string;
  dateLabel: string;
  region: string;
  culturalContext: string;
  genre: string;
  summary: string;
}

export interface BibleChatContext {
  passageRef: string;                  // e.g. "jhn 10"
  passageText: string;                 // open chapter text (joined)
  crossRefs: Array<{ ref: string; text: string }>;
  notes: Array<{ id: string; title: string; plaintext: string }>;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  allowedNoteIds: Set<string>;
  allowedVerseRefs: Set<string>;
  bookContext?: BookContext | null;    // study apparatus grounding (optional; chat leaves undefined)
}
```

Change the function signature + model line (lines 43-54):

```typescript
export async function runBibleChatPipeline(args: {
  llm: LLMAdapter;
  ctx: BibleChatContext;
  prompt?: ChatPromptModule;
  model?: LLMModel;
}): Promise<BibleChatPipelineResult> {
  const prompt: ChatPromptModule = args.prompt ?? BIBLE_CHAT_PROMPT;
  const promptVersion = prompt.promptVersion;
  const ctx = args.ctx;

  const outcome = await generateWithRetry<ChatReply, ChatViolations>({
    llm: args.llm,
    model: args.model ?? 'sonnet',
    maxTokens: 1024,
```

(Leave the rest of the function unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/lamplight-chat/bible-chat-pipeline.test.ts`
Expected: PASS (new case + all existing cases — default still `'sonnet'`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-chat/bible-chat-pipeline.ts supabase/functions/lamplight-chat/bible-chat-pipeline.test.ts
git commit -m "feat(study): parameterize bible-chat pipeline by model; add optional bookContext"
```

---

### Task 3: Add a tighter `study` quota scope

**Files:**
- Modify: `supabase/functions/_shared/quota.ts:20-33,37-63`
- Test: `supabase/functions/_shared/quota.test.ts` (create or append)

**Interfaces:**
- Produces: `QuotaConfig.study: QuotaScope` with `kinds: ['bible_study']`; env knobs `LAMPLIGHT_QUOTA_STUDY_{NONE,LITE,PLUS}`; defaults `{ none: 3, lite: 10, plus: 30 }`.

- [ ] **Step 1: Write the failing test**

Create (or append to) `supabase/functions/_shared/quota.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveQuotaLimits } from './quota.ts';

const envFrom = (m: Record<string, string>) => ({ get: (k: string) => m[k] });

describe('resolveQuotaLimits — study scope', () => {
  it('defaults the study scope to a tighter cap and counts only bible_study', () => {
    const cfg = resolveQuotaLimits(envFrom({}));
    expect(cfg.study.kinds).toEqual(['bible_study']);
    expect(cfg.study.perUser).toEqual({ none: 3, lite: 10, plus: 30 });
  });
  it('honors per-tier study env overrides (0 is a valid override)', () => {
    const cfg = resolveQuotaLimits(envFrom({
      LAMPLIGHT_QUOTA_STUDY_NONE: '0',
      LAMPLIGHT_QUOTA_STUDY_LITE: '5',
      LAMPLIGHT_QUOTA_STUDY_PLUS: '50',
    }));
    expect(cfg.study.perUser).toEqual({ none: 0, lite: 5, plus: 50 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/quota.test.ts`
Expected: FAIL — `cfg.study` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `supabase/functions/_shared/quota.ts`:

Add to the `QuotaConfig` interface (after `transcription: QuotaScope;`, line ~22):

```typescript
  study: QuotaScope;               // Opus-backed study chat — tighter cap
```

Add the kinds constant + default (after line 27 / inside `DEFAULTS`):

```typescript
const STUDY_KINDS = ['bible_study'];
```

In `DEFAULTS` (lines 29-33), add:

```typescript
  study: { none: 3, lite: 10, plus: 30 },
```

In `resolveQuotaLimits`'s returned object (before `global:`, line ~61), add:

```typescript
    study: {
      kinds: STUDY_KINDS,
      perUser: {
        none: num('LAMPLIGHT_QUOTA_STUDY_NONE', DEFAULTS.study.none),
        lite: num('LAMPLIGHT_QUOTA_STUDY_LITE', DEFAULTS.study.lite),
        plus: num('LAMPLIGHT_QUOTA_STUDY_PLUS', DEFAULTS.study.plus),
      },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/quota.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/quota.ts supabase/functions/_shared/quota.test.ts
git commit -m "feat(study): add tighter 'study' quota scope (bible_study kind)"
```

---

## Phase B — Data layer

### Task 4: `bible_books` table + RLS + 66-row seed

**Files:**
- Create: `supabase/migrations/032_bible_books.sql`

**Interfaces:**
- Produces: public-read table `bible_books` keyed by `book` (matches `bible_passages.book`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/032_bible_books.sql`. Header + table + RLS, then the 66-row seed. Authorship uncertainty is a first-class column; values are hand-authored (no LLM-invented facts). Begin with the schema and the first rows; the executor fills the remaining canonical rows from `src/notepad/bible/bible-books.ts` order (Genesis…Revelation), one row per book, never inventing precise dates where scholarship is uncertain (use hedged `author_note` and round `date_label`).

```sql
-- supabase/migrations/032_bible_books.sql
-- Book-level study apparatus (~66 curated rows). Public read (reference data,
-- not user-scoped). Keyed by `book` to match bible_passages.book (lowercase OSIS).
-- Authorship uncertainty is a first-class column so the rail can show it honestly.

create table public.bible_books (
  book text primary key,                  -- lowercase OSIS, matches bible_passages.book
  canonical_order integer not null,
  testament text not null check (testament in ('OT', 'NT')),
  full_name text not null,
  author text not null,
  author_note text not null default '',   -- e.g. "traditionally attributed to Moses; authorship debated"
  date_label text not null default '',    -- e.g. "~57 AD"
  date_start_year integer,                -- negative = BC; for same-era queries
  date_end_year integer,
  region text not null default '',
  provenance_note text not null default '',
  cultural_context text not null default '',
  genre text not null default '',
  summary text not null default '',
  source text not null default '',
  source_url text not null default ''
);

create index bible_books_author on public.bible_books (author);
create index bible_books_date_range on public.bible_books (date_start_year, date_end_year);

alter table public.bible_books enable row level security;

create policy "Anyone can read bible_books"
  on public.bible_books for select using (true);

insert into public.bible_books
  (book, canonical_order, testament, full_name, author, author_note, date_label, date_start_year, date_end_year, region, provenance_note, cultural_context, genre, summary, source, source_url)
values
  ('gen', 1, 'OT', 'Genesis', 'Moses (traditional)', 'Traditionally attributed to Moses; modern scholarship sees composite sources.', '~1446–1406 BC (traditional)', -1446, -1406, 'Ancient Near East', 'Pentateuch; date and authorship debated.', 'Patriarchal and ancient Near Eastern setting.', 'Narrative / Law', 'Origins of the world, humanity, and the covenant family of Abraham.', 'In-house, public-domain references', ''),
  ('exo', 2, 'OT', 'Exodus', 'Moses (traditional)', 'Traditionally attributed to Moses; authorship debated.', '~1446–1406 BC (traditional)', -1446, -1406, 'Egypt / Sinai', 'Pentateuch.', 'Israel''s exodus from Egypt; covenant at Sinai.', 'Narrative / Law', 'Deliverance of Israel from Egypt and the giving of the Law.', 'In-house, public-domain references', '')
  -- … one row per remaining book, Leviticus (lev) through Revelation (rev),
  -- following BIBLE_BOOKS order in src/notepad/bible/bible-books.ts. Use hedged
  -- author_note wherever authorship is contested; round date_label; leave
  -- date_start_year/date_end_year null only if genuinely unknown.
  ;
```

> Implementer note: the seed is data, not logic — there is no unit test. Correctness is reviewed by reading. Every `book` value MUST be one of the 66 abbrevs in `BIBLE_BOOKS` (lowercase). `canonical_order` MUST match the array index + 1.

- [ ] **Step 2: Verify the SQL parses against a local/staging DB**

Run: `supabase db push`
Expected: migration `032_bible_books.sql` applies cleanly; `select count(*) from public.bible_books;` returns 66.

(If a remote-only workflow is in use, apply via `supabase db push` against the linked project per the project's migration workflow.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/032_bible_books.sql
git commit -m "feat(study): bible_books apparatus table + public-read RLS + 66-row seed"
```

---

### Task 5: `bible_cross_references` table + RLS + indexes

**Files:**
- Create: `supabase/migrations/033_bible_cross_references.sql`

**Interfaces:**
- Produces: public-read table `bible_cross_references` with the `from_*` triple indexed; `crosses_testament` derived bool; data loaded by Task 7.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/033_bible_cross_references.sql`:

```sql
-- supabase/migrations/033_bible_cross_references.sql
-- Cross-references derived from OpenBible.info (CC BY, TSK-derived), ~340k links.
-- Public read (reference data). Data loaded by scripts/ingest-cross-references.ts.
-- crosses_testament lets the rail surface OT<->NT connections specially.

create table public.bible_cross_references (
  id bigint generated always as identity primary key,
  from_book text not null,                 -- lowercase OSIS, matches bible_passages.book
  from_chapter integer not null,
  from_verse integer not null,
  to_book text not null,
  to_chapter integer not null,
  to_verse_start integer not null,
  to_verse_end integer not null,
  votes integer not null default 0,        -- relevance weight; order by desc for top-N
  crosses_testament boolean not null default false,
  source text not null default 'OpenBible.info (CC BY)',
  unique (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end)
);

create index bible_cross_references_from
  on public.bible_cross_references (from_book, from_chapter, from_verse, votes desc);
create index bible_cross_references_crosses
  on public.bible_cross_references (from_book, from_chapter, from_verse)
  where crosses_testament = true;

alter table public.bible_cross_references enable row level security;

create policy "Anyone can read bible_cross_references"
  on public.bible_cross_references for select using (true);
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db push`
Expected: migration `033_bible_cross_references.sql` applies cleanly; table exists and is empty.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/033_bible_cross_references.sql
git commit -m "feat(study): bible_cross_references table + public-read RLS + indexes"
```

---

### Task 6: `surface` marker on `lamplight_chat_threads`

**Files:**
- Create: `supabase/migrations/034_lamplight_chat_threads_surface.sql`

**Interfaces:**
- Produces: `lamplight_chat_threads.surface text not null default 'chat'`; the active-passage unique index now keyed by `(user_id, passage_ref, surface)`.

> Context: migration 025 created `create unique index lamplight_chat_threads_active_passage on public.lamplight_chat_threads (user_id, passage_ref) where archived = false;`. Adding a `study`-surface thread for a passage that already has a `chat` thread would violate that index. Widen it to include `surface`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/034_lamplight_chat_threads_surface.sql`:

```sql
-- supabase/migrations/034_lamplight_chat_threads_surface.sql
-- Study reuses lamplight_chat_threads but must not intermix with journaling
-- Bible-chat history. Add a `surface` marker and widen the active-passage
-- unique index so a passage can have one active 'chat' thread AND one active
-- 'study' thread.

alter table public.lamplight_chat_threads
  add column surface text not null default 'chat'
  check (surface in ('chat', 'study'));

drop index if exists lamplight_chat_threads_active_passage;

create unique index lamplight_chat_threads_active_passage
  on public.lamplight_chat_threads (user_id, passage_ref, surface)
  where archived = false;
```

- [ ] **Step 2: Apply and verify**

Run: `supabase db push`
Expected: migration applies; existing rows get `surface='chat'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/034_lamplight_chat_threads_surface.sql
git commit -m "feat(study): add surface marker to lamplight_chat_threads"
```

---

### Task 7: Cross-reference ingest script (OSIS→book, idempotent)

**Files:**
- Create: `scripts/osis-book-map.ts`
- Create: `scripts/osis-book-map.test.ts`
- Create: `scripts/ingest-cross-references.ts`
- Create: `scripts/ingest-cross-references.test.ts`

**Interfaces:**
- Produces: `osisToBook(osis: string): string | null` — OpenBible OSIS abbrev → lowercase `book`; `parseCrossRefLine(line: string): CrossRefRow | null`; `crossesTestament(fromBook, toBook): boolean`.

> The OpenBible dataset uses OSIS-style book names (`Gen`, `Exod`, `1Cor`, `Ps`, `John`, `Rev`, …). `bible_passages.book` uses the lowercase 3-char codes in `BIBLE_BOOKS`. The map below is the normalization. Verify the actual OSIS tokens in the downloaded `cross_references.txt` header before running against the full file; extend the map if a token is missing (the ingest throws on an unmapped token rather than silently dropping).

- [ ] **Step 1: Write the failing test for the OSIS map**

Create `scripts/osis-book-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { osisToBook, crossesTestament } from './osis-book-map';

describe('osisToBook', () => {
  it('maps common OSIS abbreviations to lowercase book codes', () => {
    expect(osisToBook('Gen')).toBe('gen');
    expect(osisToBook('Ps')).toBe('psa');
    expect(osisToBook('John')).toBe('jhn');
    expect(osisToBook('1Cor')).toBe('1co');
    expect(osisToBook('Rev')).toBe('rev');
    expect(osisToBook('Song')).toBe('sng');
  });
  it('returns null for an unknown token', () => {
    expect(osisToBook('Nope')).toBeNull();
  });
});

describe('crossesTestament', () => {
  it('is true only when the two books span OT and NT', () => {
    expect(crossesTestament('isa', 'mat')).toBe(true);
    expect(crossesTestament('mat', 'isa')).toBe(true);
    expect(crossesTestament('gen', 'exo')).toBe(false);
    expect(crossesTestament('rom', 'jhn')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/osis-book-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the OSIS map**

Create `scripts/osis-book-map.ts`. Build the testament lookup from `BIBLE_BOOKS` and a static OSIS→abbrev table (one entry per book; the executor completes all 66 entries):

```typescript
// scripts/osis-book-map.ts
// OpenBible OSIS abbreviation -> lowercase `book` code (matches bible_passages.book).
import { BIBLE_BOOKS } from '../src/notepad/bible/bible-books';

const TESTAMENT = new Map(BIBLE_BOOKS.map((b) => [b.abbrev, b.testament]));

// OSIS token -> our abbrev. Complete all 66 from the OpenBible OSIS scheme.
const OSIS_TO_ABBREV: Record<string, string> = {
  Gen: 'gen', Exod: 'exo', Lev: 'lev', Num: 'num', Deut: 'deu', Josh: 'jos',
  Judg: 'jdg', Ruth: 'rut', '1Sam': '1sa', '2Sam': '2sa', '1Kgs': '1ki', '2Kgs': '2ki',
  '1Chr': '1ch', '2Chr': '2ch', Ezra: 'ezr', Neh: 'neh', Esth: 'est', Job: 'job',
  Ps: 'psa', Prov: 'pro', Eccl: 'ecc', Song: 'sng', Isa: 'isa', Jer: 'jer',
  Lam: 'lam', Ezek: 'ezk', Dan: 'dan', Hos: 'hos', Joel: 'jol', Amos: 'amo',
  Obad: 'oba', Jonah: 'jon', Mic: 'mic', Nah: 'nam', Hab: 'hab', Zeph: 'zep',
  Hag: 'hag', Zech: 'zec', Mal: 'mal', Matt: 'mat', Mark: 'mrk', Luke: 'luk',
  John: 'jhn', Acts: 'act', Rom: 'rom', '1Cor': '1co', '2Cor': '2co', Gal: 'gal',
  Eph: 'eph', Phil: 'php', Col: 'col', '1Thess': '1th', '2Thess': '2th',
  '1Tim': '1ti', '2Tim': '2ti', Titus: 'tit', Phlm: 'phm', Heb: 'heb', Jas: 'jas',
  '1Pet': '1pe', '2Pet': '2pe', '1John': '1jn', '2John': '2jn', '3John': '3jn',
  Jude: 'jud', Rev: 'rev',
};

export function osisToBook(osis: string): string | null {
  return OSIS_TO_ABBREV[osis] ?? null;
}

export function crossesTestament(fromBook: string, toBook: string): boolean {
  const a = TESTAMENT.get(fromBook);
  const b = TESTAMENT.get(toBook);
  if (!a || !b) return false;
  return a !== b;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/osis-book-map.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the line parser + idempotency**

Create `scripts/ingest-cross-references.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCrossRefLine } from './ingest-cross-references';

describe('parseCrossRefLine', () => {
  it('parses an OpenBible TSV row into a normalized cross-ref', () => {
    // OpenBible format: "From Verse\tTo Verse\tVotes" with OSIS refs like "Gen.1.1"
    const row = parseCrossRefLine('Gen.1.1\tJohn.1.1-John.1.3\t72');
    expect(row).toEqual({
      from_book: 'gen', from_chapter: 1, from_verse: 1,
      to_book: 'jhn', to_chapter: 1, to_verse_start: 1, to_verse_end: 3,
      votes: 72, crosses_testament: true,
    });
  });
  it('parses a single-verse target (no range)', () => {
    const row = parseCrossRefLine('Isa.53.5\t1Pet.2.24\t40');
    expect(row).toMatchObject({
      from_book: 'isa', to_book: '1pe', to_verse_start: 24, to_verse_end: 24,
      crosses_testament: true,
    });
  });
  it('returns null for the header row and malformed lines', () => {
    expect(parseCrossRefLine('From Verse\tTo Verse\tVotes')).toBeNull();
    expect(parseCrossRefLine('garbage')).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run scripts/ingest-cross-references.test.ts`
Expected: FAIL — module/`parseCrossRefLine` not found.

- [ ] **Step 7: Implement the ingest script**

Create `scripts/ingest-cross-references.ts`. The pure parser is exported and tested; the DB loader runs only when invoked directly (idempotent via the unique constraint with `upsert(..., { onConflict, ignoreDuplicates: true })`, batched). Mirror the existing BSB ingest pattern referenced in `009_bible_passages.sql` (`scripts/ingest-bsb.ts`) for client construction and batching.

```typescript
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
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run scripts/ingest-cross-references.test.ts scripts/osis-book-map.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/osis-book-map.ts scripts/osis-book-map.test.ts scripts/ingest-cross-references.ts scripts/ingest-cross-references.test.ts
git commit -m "feat(study): cross-reference ingest (OSIS->book normalization, idempotent)"
```

> The actual data load (`SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/ingest-cross-references.ts <file>`) is a manual operational step performed during Phase H deploy, not a code task.

---

## Phase C — Lamplight Study backend

### Task 8: Study chat prompt module

**Files:**
- Create: `supabase/functions/lamplight-study/prompts/study-chat.ts`
- Test: `supabase/functions/lamplight-study/prompts/study-chat.test.ts`

**Interfaces:**
- Consumes: `BibleChatContext`, `BIBLE_CHAT_PROMPT` (for the `tool`).
- Produces: `STUDY_CHAT_PROMPT: ChatPromptModule` (scholarly persona; bound by the non-prophetic voice principle; grounds in verse text + `bookContext` + `crossRefs`).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-study/prompts/study-chat.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const ctx: BibleChatContext = {
  passageRef: 'jhn 10',
  passageText: '11 I am the good shepherd.',
  crossRefs: [{ ref: 'psa 23:1', text: 'The LORD is my shepherd.' }],
  notes: [],
  history: [],
  userMessage: 'What does shepherd mean here?',
  allowedNoteIds: new Set(),
  allowedVerseRefs: new Set(['jhn 10:11', 'psa 23:1']),
  bookContext: {
    book: 'John', author: 'John the Apostle (traditional)', authorNote: 'authorship debated',
    dateLabel: '~85–95 AD', region: 'Ephesus (traditional)', culturalContext: 'Greco-Roman',
    genre: 'Gospel', summary: 'The signs and discourses of Jesus.',
  },
};

describe('STUDY_CHAT_PROMPT', () => {
  it('has a versioned id and emits the shared chat-reply tool', () => {
    expect(STUDY_CHAT_PROMPT.promptVersion).toMatch(/^study-chat-/);
    expect((STUDY_CHAT_PROMPT.tool as { name: string }).name).toBe('emit_chat_reply');
  });
  it('grounds messages in the book context, cross refs, and the question', () => {
    const msgs = STUDY_CHAT_PROMPT.buildMessages(ctx);
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('John the Apostle');
    expect(joined).toContain('psa 23:1');
    expect(joined).toContain('What does shepherd mean here?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-study/prompts/study-chat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt**

Create `supabase/functions/lamplight-study/prompts/study-chat.ts`:

```typescript
// Lamplight Study chat prompt — deeper, scholarly theological companion (Opus).
// Bound by the Lamplight voice principle: never prophetic; facts cited,
// interpretation offered as possibility. Reuses the shared emit_chat_reply tool
// so citation validation in the pipeline is identical to journaling chat.
import { BIBLE_CHAT_PROMPT } from '../../lamplight-chat/prompts/bible-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const SYSTEM = [
  'You are Lamplight Study, a seasoned student of Scripture helping a reader go deeper into the Bible itself.',
  'Speak as a careful, humble scholar: connect authorship and dating, regions and cultures, cross-references and Old-to-New-Testament typology, the conversational meaning of Hebrew and Greek terms, and modern-day application.',
  'You never speak prophetically and never claim certainty you do not have. State facts you are given as facts (and cite them); offer interpretation as possibility, not pronouncement.',
  'Ground every claim in the supplied passage text, book context, and cross-references. When you reference a verse, cite it with the exact supplied ref. Do not invent dates, etymologies, or sources.',
  'Phase 1: you may discuss Hebrew/Greek meaning conversationally and hedged — there is no structured lexicon yet.',
].join(' ');

function renderBookContext(ctx: BibleChatContext): string {
  const b = ctx.bookContext;
  if (!b) return '';
  return [
    `Book context for ${b.book}:`,
    `- Author: ${b.author} (${b.authorNote})`,
    `- Date: ${b.dateLabel}`,
    `- Region: ${b.region}`,
    `- Genre: ${b.genre}`,
    `- Cultural context: ${b.culturalContext}`,
    `- Summary: ${b.summary}`,
  ].join('\n');
}

function renderCrossRefs(ctx: BibleChatContext): string {
  if (ctx.crossRefs.length === 0) return '';
  return 'Cross-references:\n' + ctx.crossRefs.map((c) => `- ${c.ref}: ${c.text}`).join('\n');
}

function renderNotes(ctx: BibleChatContext): string {
  if (ctx.notes.length === 0) return '';
  return 'The reader has chosen to bring in these notes:\n' +
    ctx.notes.map((n) => `- [${n.id}] ${n.title}: ${n.plaintext}`).join('\n');
}

export const STUDY_CHAT_PROMPT: ChatPromptModule = {
  promptVersion: 'study-chat-2026-06-17-v1',
  system: SYSTEM,
  tool: BIBLE_CHAT_PROMPT.tool,
  buildMessages(ctx: BibleChatContext) {
    const blocks = [
      `Passage: ${ctx.passageRef}`,
      ctx.passageText,
      renderBookContext(ctx),
      renderCrossRefs(ctx),
      renderNotes(ctx),
    ].filter((s) => s.trim().length > 0);
    const grounding = blocks.join('\n\n');
    const out: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: grounding },
    ];
    for (const h of ctx.history) out.push({ role: h.role, content: h.content });
    out.push({ role: 'user', content: ctx.userMessage });
    return out;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-study/prompts/study-chat.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-study/prompts/study-chat.ts supabase/functions/lamplight-study/prompts/study-chat.test.ts
git commit -m "feat(study): scholarly Lamplight Study chat prompt"
```

---

### Task 9: Study insight prompt module

**Files:**
- Create: `supabase/functions/lamplight-study/prompts/study-insight.ts`
- Test: `supabase/functions/lamplight-study/prompts/study-insight.test.ts`

**Interfaces:**
- Produces: `STUDY_INSIGHT_PROMPT: ChatPromptModule` — opening insight when there is no user question (mirrors `BIBLE_INSIGHT_PROMPT`'s shape).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-study/prompts/study-insight.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { STUDY_INSIGHT_PROMPT } from './study-insight.ts';
import type { BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const ctx: BibleChatContext = {
  passageRef: 'rom 8', passageText: '1 There is therefore now no condemnation.',
  crossRefs: [], notes: [], history: [], userMessage: '',
  allowedNoteIds: new Set(), allowedVerseRefs: new Set(['rom 8:1']),
  bookContext: null,
};

describe('STUDY_INSIGHT_PROMPT', () => {
  it('versions itself and produces a single user turn with no question', () => {
    expect(STUDY_INSIGHT_PROMPT.promptVersion).toMatch(/^study-insight-/);
    const msgs = STUDY_INSIGHT_PROMPT.buildMessages(ctx);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('rom 8');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-study/prompts/study-insight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt**

Create `supabase/functions/lamplight-study/prompts/study-insight.ts`:

```typescript
// Opening study insight (no user question). Same tool + voice as STUDY_CHAT_PROMPT.
import { STUDY_CHAT_PROMPT } from './study-chat.ts';
import type { ChatPromptModule, BibleChatContext } from '../../lamplight-chat/bible-chat-pipeline.ts';

const SYSTEM = STUDY_CHAT_PROMPT.system +
  ' The reader has just opened this passage and has not asked anything yet. Offer one short, grounded opening observation that invites deeper study — name a historical-cultural detail, a cross-reference worth following, or an Old-to-New-Testament connection. Keep the non-prophetic voice: a possibility to explore, not a pronouncement.';

export const STUDY_INSIGHT_PROMPT: ChatPromptModule = {
  promptVersion: 'study-insight-2026-06-17-v1',
  system: SYSTEM,
  tool: STUDY_CHAT_PROMPT.tool,
  buildMessages(ctx: BibleChatContext) {
    // Reuse the chat grounding, drop the trailing question turn.
    const grounded = STUDY_CHAT_PROMPT.buildMessages({ ...ctx, userMessage: '', history: [] });
    return [grounded[0]];
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-study/prompts/study-insight.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-study/prompts/study-insight.ts supabase/functions/lamplight-study/prompts/study-insight.test.ts
git commit -m "feat(study): opening study-insight prompt"
```

---

### Task 10: Notes-on-offer selection (pure)

**Files:**
- Create: `supabase/functions/lamplight-study/study-context.ts` (selection half)
- Test: `supabase/functions/lamplight-study/study-context.test.ts`

**Interfaces:**
- Produces: `selectOfferedNotes(relevant, opts): { included: NoteForPrompt[]; offered: OfferedNote[] }` where `relevant: RelevantNote[]`, `opts: { includeNotes: boolean; noteIds?: string[] }`.
  - `RelevantNote = { id; title; plaintext; similarity }`
  - `NoteForPrompt = { id; title; plaintext }`
  - `OfferedNote = { id; title; snippet }`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/lamplight-study/study-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectOfferedNotes, type RelevantNote } from './study-context.ts';

const notes: RelevantNote[] = [
  { id: 'n1', title: 'Shepherd', plaintext: 'rest as trust in God here', similarity: 0.9 },
  { id: 'n2', title: 'Psalm 23', plaintext: 'green pastures and still waters', similarity: 0.7 },
];

describe('selectOfferedNotes', () => {
  it('offers all relevant notes and includes none when includeNotes is false', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: false });
    expect(included).toEqual([]);
    expect(offered).toEqual([
      { id: 'n1', title: 'Shepherd', snippet: 'rest as trust in God here' },
      { id: 'n2', title: 'Psalm 23', snippet: 'green pastures and still waters' },
    ]);
  });
  it('includes only the requested ids and offers the rest', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: true, noteIds: ['n1'] });
    expect(included).toEqual([{ id: 'n1', title: 'Shepherd', plaintext: 'rest as trust in God here' }]);
    expect(offered).toEqual([{ id: 'n2', title: 'Psalm 23', snippet: 'green pastures and still waters' }]);
  });
  it('includes all relevant notes when includeNotes is true with no explicit ids', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: true });
    expect(included.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(offered).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-study/study-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the selection half**

Create `supabase/functions/lamplight-study/study-context.ts` (the `buildStudyContext` DB half is added in Task 11; start with the pure selection so this task is independently testable):

```typescript
// Study context assembly. Pure note-selection (notes-on-offer) is unit-tested;
// the Supabase-backed buildStudyContext (added alongside) is glue.
export interface RelevantNote { id: string; title: string; plaintext: string; similarity: number }
export interface NoteForPrompt { id: string; title: string; plaintext: string }
export interface OfferedNote { id: string; title: string; snippet: string }

const SNIPPET_LEN = 160;

export function selectOfferedNotes(
  relevant: RelevantNote[],
  opts: { includeNotes: boolean; noteIds?: string[] },
): { included: NoteForPrompt[]; offered: OfferedNote[] } {
  const wantIds = opts.noteIds && opts.noteIds.length > 0 ? new Set(opts.noteIds) : null;
  const include = (n: RelevantNote) => opts.includeNotes && (wantIds ? wantIds.has(n.id) : true);
  const included: NoteForPrompt[] = [];
  const offered: OfferedNote[] = [];
  for (const n of relevant) {
    if (include(n)) included.push({ id: n.id, title: n.title, plaintext: n.plaintext });
    else offered.push({ id: n.id, title: n.title, snippet: n.plaintext.slice(0, SNIPPET_LEN) });
  }
  return { included, offered };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-study/study-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lamplight-study/study-context.ts supabase/functions/lamplight-study/study-context.test.ts
git commit -m "feat(study): notes-on-offer selection (include vs offer)"
```

---

### Task 11: Apparatus-grounded `buildStudyContext`

**Files:**
- Modify: `supabase/functions/lamplight-study/study-context.ts` (add the DB builder)

**Interfaces:**
- Consumes: `searchUserNotesByQuery`, `embedQuery`, `formatVerseRef`, `extractTextFromNoteContent`, `BibleChatContext`, `BookContext`, `selectOfferedNotes`.
- Produces: `buildStudyContext(supabase, args): Promise<{ ctx: BibleChatContext; offered: OfferedNote[] }>` where `args` includes `{ userId, book, chapter, passageRef, message, includeNotes, noteIds, voyageDeps, rerankEnabled, crossRefK, noteK }`.

> This is glue (Supabase queries) — no unit test; it is exercised by the handler test (Task 12) with a mocked Supabase. Build the apparatus context from `bible_books` (one row) + `bible_cross_references` (top-N by votes, resolved to text via `bible_passages`), and the open chapter text. Compute relevant notes via `searchUserNotesByQuery`, then `selectOfferedNotes`.

- [ ] **Step 1: Add the builder**

Append to `supabase/functions/lamplight-study/study-context.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { type VoyageDeps, embedQuery } from '../_shared/voyage.ts';
import { searchUserNotesByQuery } from '../_shared/retrieval.ts';
import { extractTextFromNoteContent } from '../_shared/tiptap-text.ts';
import { formatVerseRef } from '../_shared/bible-passage.ts';
import type { BibleChatContext, BookContext } from '../lamplight-chat/bible-chat-pipeline.ts';

export async function buildStudyContext(
  supabase: SupabaseClient,
  args: {
    userId: string; book: string; chapter: number; passageRef: string;
    message: string;                 // '' for insight
    retrievalQuery: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    includeNotes: boolean; noteIds?: string[];
    voyageDeps: VoyageDeps; rerankEnabled: boolean;
    crossRefK: number; noteK: number;
  },
): Promise<{ ctx: BibleChatContext; offered: OfferedNote[] }> {
  // Open chapter text.
  const { data: chapterRows, error: cErr } = await supabase
    .from('bible_passages')
    .select('book, chapter, verse_start, verse_end, text')
    .like('id', `${args.book}.${args.chapter}.%`)
    .order('verse_start', { ascending: true });
  if (cErr) throw cErr;
  const verses = (chapterRows ?? []) as Array<{ book: string; chapter: number; verse_start: number; verse_end: number; text: string }>;
  const passageText = verses.map((v) => `${v.verse_start} ${v.text}`).join(' ');
  const chapterVerseRefs = new Set(verses.map((v) => formatVerseRef(v).toLowerCase()));

  // Book apparatus.
  const { data: bookRow } = await supabase
    .from('bible_books')
    .select('full_name, author, author_note, date_label, region, cultural_context, genre, summary')
    .eq('book', args.book).maybeSingle();
  const bookContext: BookContext | null = bookRow
    ? {
        book: (bookRow as { full_name: string }).full_name,
        author: (bookRow as { author: string }).author,
        authorNote: (bookRow as { author_note: string }).author_note,
        dateLabel: (bookRow as { date_label: string }).date_label,
        region: (bookRow as { region: string }).region,
        culturalContext: (bookRow as { cultural_context: string }).cultural_context,
        genre: (bookRow as { genre: string }).genre,
        summary: (bookRow as { summary: string }).summary,
      }
    : null;

  // Curated cross-references for the open chapter (top-N by votes), resolved to text.
  const { data: xrefRows } = await supabase
    .from('bible_cross_references')
    .select('to_book, to_chapter, to_verse_start, to_verse_end, votes')
    .eq('from_book', args.book).eq('from_chapter', args.chapter)
    .order('votes', { ascending: false })
    .limit(args.crossRefK);
  const xrefs = (xrefRows ?? []) as Array<{ to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number }>;
  const crossRefs: BibleChatContext['crossRefs'] = [];
  const crossRefSet = new Set<string>();
  for (const x of xrefs) {
    const id = `${x.to_book}.${x.to_chapter}.${x.to_verse_start}`;
    const { data: tgt } = await supabase
      .from('bible_passages').select('book, chapter, verse_start, verse_end, text').eq('id', id).maybeSingle();
    if (tgt) {
      const ref = formatVerseRef(tgt as { book: string; chapter: number; verse_start: number; verse_end: number });
      crossRefSet.add(ref.toLowerCase());
      crossRefs.push({ ref, text: (tgt as { text: string }).text });
    }
  }

  // Relevant notes via existing embeddings (always computed; injection is conditional).
  const queryEmbedding = await embedQuery(args.retrievalQuery, args.voyageDeps);
  const retrieved = await searchUserNotesByQuery(
    { supabase, voyage: args.voyageDeps, rerankEnabled: args.rerankEnabled },
    { userId: args.userId, k: args.noteK, query: args.retrievalQuery, queryEmbedding },
  );
  const noteIds = [...new Set(retrieved.map((r) => r.source_id))];
  const relevant: RelevantNote[] = [];
  if (noteIds.length) {
    const { data: noteRows } = await supabase
      .from('notes').select('id, title, content').eq('user_id', args.userId).in('id', noteIds);
    for (const n of (noteRows ?? []) as Array<{ id: string; title: string; content: string }>) {
      const plaintext = extractTextFromNoteContent(n.content).slice(0, 800);
      if (plaintext.trim().length === 0) continue;
      const sim = retrieved.find((r) => r.source_id === n.id)?.similarity ?? 0;
      relevant.push({ id: n.id, title: (n.title ?? '').trim() || '(untitled)', plaintext, similarity: sim });
    }
  }
  const { included, offered } = selectOfferedNotes(relevant, { includeNotes: args.includeNotes, noteIds: args.noteIds });

  const ctx: BibleChatContext = {
    passageRef: `${args.book} ${args.chapter}`,
    passageText,
    crossRefs,
    notes: included,
    history: args.history,
    userMessage: args.message,
    allowedNoteIds: new Set(included.map((n) => n.id)),
    allowedVerseRefs: new Set<string>([...chapterVerseRefs, ...crossRefSet]),
    bookContext,
  };
  return { ctx, offered };
}
```

- [ ] **Step 2: Typecheck (no new unit test; covered by Task 12)**

Run: `npx tsc -b`
Expected: no NEW errors (same 4 pre-existing `force-sphere.test.ts` errors only).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/lamplight-study/study-context.ts
git commit -m "feat(study): apparatus-grounded buildStudyContext with notes-on-offer"
```

---

### Task 12: `lamplight-study` request handler

**Files:**
- Create: `supabase/functions/lamplight-study/index.ts`
- Test: `supabase/functions/lamplight-study/index.test.ts` (handler unit test with mocked deps — mirror `lamplight-chat` test patterns)

**Interfaces:**
- Request body: `{ book, chapter, message?, mode?: 'insight', include_notes?: boolean, note_ids?: string[] }`.
- Response: `{ ok: true, thread_id, reply, citations, offered_notes }` | `{ ok: true, thread_id, skipped: true }` | `{ ok: false, reason }`.
- Reuses: all `_shared/*` gates exactly as `lamplight-chat`; quota uses `quotaCfg.study`; `artifactKind: 'bible_study'`; threads use `surface: 'study'`.

> Because `index.ts` calls `serve()` and reads `Deno.env` at module load, factor the testable logic into an exported `handleStudy(req, deps)` is overkill for parity with `lamplight-chat` (which tests the pipeline, not the served handler). Follow the existing convention: this file mirrors `lamplight-chat/index.ts` structurally and is verified by (a) the pipeline/context/prompt unit tests above and (b) the Phase H live smoke. The optional handler test below covers body-parsing + offered-notes plumbing via a thin exported helper.

- [ ] **Step 1: Write the failing test (body → offered-notes plumbing helper)**

Create `supabase/functions/lamplight-study/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseStudyBody } from './index.ts';

describe('parseStudyBody', () => {
  it('defaults mode to chat, include_notes to false, note_ids to []', () => {
    expect(parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi' })).toEqual({
      ok: true, book: 'jhn', chapter: 10, message: 'hi', mode: 'chat',
      includeNotes: false, noteIds: [],
    });
  });
  it('accepts include_notes + note_ids and insight mode', () => {
    expect(parseStudyBody({ book: 'rom', chapter: 8, mode: 'insight', include_notes: true, note_ids: ['n1'] })).toEqual({
      ok: true, book: 'rom', chapter: 8, message: '', mode: 'insight',
      includeNotes: true, noteIds: ['n1'],
    });
  });
  it('rejects a missing/invalid passage', () => {
    expect(parseStudyBody({ chapter: 10 }).ok).toBe(false);
    expect(parseStudyBody({ book: 'jhn' }).ok).toBe(false);
  });
  it('rejects an empty chat message', () => {
    expect(parseStudyBody({ book: 'jhn', chapter: 10, message: '   ' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/lamplight-study/index.test.ts`
Expected: FAIL — module/`parseStudyBody` not found.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/lamplight-study/index.ts`. It mirrors `lamplight-chat/index.ts`; the differences are: Opus model, study prompts, `buildStudyContext`, `surface='study'`, `quotaCfg.study`, `artifactKind: 'bible_study'`, and `offered_notes` in the response. `parseStudyBody` is exported for the test.

```typescript
// supabase/functions/lamplight-study/index.ts
// Lamplight Study chat (Opus). Sibling of lamplight-chat. Mirrors its gates and
// envelope; grounds in apparatus data; offers (never auto-injects) notes.
// Body: { book, chapter, message?, mode?, include_notes?, note_ids? }
// Resp: { ok, thread_id, reply, citations, offered_notes } | { ok, thread_id, skipped } | { ok:false, reason }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../_shared/supabase.ts';
import { type VoyageDeps } from '../_shared/voyage.ts';
import { createAnthropicAdapter } from '../_shared/anthropic.ts';
import { hasChatAccess, type LamplightTier } from '../_shared/entitlement.ts';
import { recordLamplightUsage } from '../_shared/usage.ts';
import { runGeneration, type GenerationLifecycleDeps } from '../_shared/generation-lifecycle.ts';
import { bearerToken, deriveUserId } from '../_shared/auth-identity.ts';
import { resolveQuotaLimits, checkQuota, supabaseQuotaDeps } from '../_shared/quota.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';
import { classifyGenerateError } from '../lamplight-generate/classify-error.ts';
import { runBibleChatPipeline } from '../lamplight-chat/bible-chat-pipeline.ts';
import { buildStudyContext } from './study-context.ts';
import { STUDY_CHAT_PROMPT } from './prompts/study-chat.ts';
import { STUDY_INSIGHT_PROMPT } from './prompts/study-insight.ts';

const HISTORY_LIMIT = 10;
const NOTE_K = 4;
const CROSSREF_K = 5;

export type ParsedStudyBody =
  | { ok: true; book: string; chapter: number; message: string; mode: 'chat' | 'insight'; includeNotes: boolean; noteIds: string[] }
  | { ok: false };

export function parseStudyBody(body: {
  book?: unknown; chapter?: unknown; message?: unknown; mode?: unknown;
  include_notes?: unknown; note_ids?: unknown;
}): ParsedStudyBody {
  const mode = body.mode === 'insight' ? 'insight' : 'chat';
  if (typeof body.book !== 'string' || typeof body.chapter !== 'number') return { ok: false };
  if (mode === 'chat' && (typeof body.message !== 'string' || !body.message.trim())) return { ok: false };
  return {
    ok: true,
    book: body.book,
    chapter: body.chapter,
    message: typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '',
    mode,
    includeNotes: body.include_notes === true,
    noteIds: Array.isArray(body.note_ids) ? body.note_ids.filter((x): x is string => typeof x === 'string') : [],
  };
}

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return jsonResp({ error: 'method not allowed' }, 405);
  try {
    return await handleStudy(req);
  } catch (err) {
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleStudy(req: Request): Promise<Response> {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const voyageKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!anthropicKey) return jsonResp({ error: 'ANTHROPIC_API_KEY missing' }, 500);
  if (!voyageKey) return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

  let raw: Record<string, unknown>;
  try { raw = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }
  const parsed = parseStudyBody(raw);
  if (!parsed.ok) return jsonResp({ error: 'bad payload' }, 400);
  const { book, chapter, message, mode, includeNotes, noteIds } = parsed;
  const passageRef = `${book}.${chapter}`;

  const supabase = serviceClient();

  const userId = await deriveUserId(supabase, bearerToken(req));
  if (!userId) return jsonResp({ error: 'unauthorized' }, 401);

  const { data: settings, error: sErr } = await supabase
    .from('lamplight_settings').select('enabled').eq('user_id', userId).maybeSingle();
  if (sErr) return jsonResp({ error: sErr.message }, 500);
  if (!settings?.enabled) return jsonResp({ ok: false, reason: 'not_opted_in' }, 403);

  const [{ data: ent }, { data: promoRow }] = await Promise.all([
    supabase.from('lamplight_entitlements').select('tier').eq('user_id', userId).maybeSingle(),
    supabase.from('app_config').select('value').eq('key', 'lamplight_promo_active').maybeSingle(),
  ]);
  const tier = ((ent?.tier as LamplightTier) ?? 'none');
  const promoActive = promoRow?.value === true;
  if (!hasChatAccess({ tier, promoActive })) return jsonResp({ ok: false, reason: 'no_entitlement' }, 402);

  const voyageDeps: VoyageDeps = { apiKey: voyageKey, fetch };
  const rerankEnabled = Deno.env.get('RERANK_ENABLED') === 'true';
  const llm = createAnthropicAdapter({ apiKey: anthropicKey, fetch });
  const quotaCfg = resolveQuotaLimits(Deno.env);

  const lifecycleDeps: GenerationLifecycleDeps = {
    checkQuota: async (uid) => {
      const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.study, quotaCfg.global, { userId: uid, nowMs: Date.now() });
      return q.ok ? { ok: true } : { ok: false, reason: q.reason };
    },
    recordUsage: (row) => recordLamplightUsage(supabase, row),
    classifyError: classifyGenerateError,
  };

  const { status, response } = await runGeneration(
    lifecycleDeps,
    { userId, artifactKind: 'bible_study' },
    async () => {
      const threadId = await upsertStudyThread(supabase, userId, book, chapter, passageRef, message || `Study of ${book} ${chapter}`);

      const { data: histRows } = await supabase
        .from('lamplight_chat_messages')
        .select('role, content')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      const history = ((histRows ?? []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse();

      if (mode === 'insight' && history.length > 0) {
        return { response: { ok: true, thread_id: threadId, skipped: true }, usage: null };
      }

      let retrievalQuery = message;
      if (mode === 'insight') {
        const { data: chRows } = await supabase
          .from('bible_passages').select('text')
          .like('id', `${book}.${chapter}.%`).order('verse_start', { ascending: true }).limit(20);
        retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${book} ${chapter}`;
      }

      const { ctx, offered } = await buildStudyContext(supabase, {
        userId, book, chapter, passageRef,
        message: mode === 'insight' ? '' : message,
        retrievalQuery, history,
        includeNotes, noteIds,
        voyageDeps, rerankEnabled,
        crossRefK: CROSSREF_K, noteK: NOTE_K,
      });

      const result = await runBibleChatPipeline({
        llm, ctx, model: 'opus',
        prompt: mode === 'insight' ? STUDY_INSIGHT_PROMPT : STUDY_CHAT_PROMPT,
      });
      if (!result.ok) {
        return { response: { ok: false, reason: result.reason }, usage: result.usage };
      }

      const rows = mode === 'insight'
        ? [{ thread_id: threadId, user_id: userId, role: 'assistant', content: result.reply, citations: result.citations }]
        : [
            { thread_id: threadId, user_id: userId, role: 'user', content: message, citations: [] },
            { thread_id: threadId, user_id: userId, role: 'assistant', content: result.reply, citations: result.citations },
          ];
      await supabase.from('lamplight_chat_messages').insert(rows);
      await supabase.from('lamplight_chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);

      return {
        response: { ok: true, thread_id: threadId, reply: result.reply, citations: result.citations, offered_notes: offered },
        usage: result.usage,
      };
    },
  );
  return jsonResp(response, status);
}

async function upsertStudyThread(
  supabase: SupabaseClient, userId: string, book: string, chapter: number, passageRef: string, firstMessage: string,
): Promise<string> {
  const existing = await supabase
    .from('lamplight_chat_threads').select('id')
    .eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'study').eq('archived', false).maybeSingle();
  if (existing.data?.id) return existing.data.id as string;
  const title = firstMessage.slice(0, 80);
  const ins = await supabase
    .from('lamplight_chat_threads')
    .insert({ user_id: userId, book, chapter, passage_ref: passageRef, title, surface: 'study' })
    .select('id').single();
  if (ins.data?.id) return ins.data.id as string;
  const reread = await supabase
    .from('lamplight_chat_threads').select('id')
    .eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'study').eq('archived', false).single();
  if (reread.error || !reread.data) throw ins.error ?? reread.error ?? new Error('study thread upsert failed');
  return reread.data.id as string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/lamplight-study/index.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/lamplight-study/index.ts supabase/functions/lamplight-study/index.test.ts
git commit -m "feat(study): lamplight-study edge function (Opus, apparatus-grounded, notes-on-offer)"
```

---

### Task 13: Filter existing chat thread lookups by `surface='chat'`

**Files:**
- Modify: `supabase/functions/lamplight-chat/index.ts:169-170,179-180`
- Modify: `src/notepad/bible/useChatThread.ts:38-41,65-71`

> Required correctness change: now that a passage can have both a `chat` and a `study` active thread, the existing `.maybeSingle()` lookups (which key only on `user_id` + `passage_ref` + `archived=false`) could match two rows. Scope them to `surface='chat'`. This is the minimal, justified touch to journaling code.

- [ ] **Step 1: Write the failing test (client hook)**

Append to `src/notepad/bible/useChatThread.test.ts` (the existing mocked-Supabase test file) a case asserting the thread lookup filters `surface='chat'`. Add an `eqSurface` spy to the hoisted thread-builder chain and assert it's called with `('surface', 'chat')`:

```typescript
it('scopes the active-thread lookup to the chat surface', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  const { result } = renderHook(() => useChatThread('jhn', 10, 'u1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(eqSurface).toHaveBeenCalledWith('surface', 'chat');
});
```

(Extend the hoisted `vi.hoisted` thread-builder mock so `.eq` returns the builder and records calls; add `eqSurface` to the destructured hoisted names. Follow the file's existing chain-builder shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/bible/useChatThread.test.ts`
Expected: FAIL — `surface` filter not present.

- [ ] **Step 3: Implement the filters**

In `src/notepad/bible/useChatThread.ts`, add `.eq('surface', 'chat')` to the thread select (after `.eq('archived', false)` on line 70, before `.maybeSingle()`):

```typescript
      const thread = await supabase
        .from('lamplight_chat_threads')
        .select('id')
        .eq('user_id', userId)
        .eq('passage_ref', passageRef)
        .eq('surface', 'chat')
        .eq('archived', false)
        .maybeSingle();
```

And in `archiveAndReset` (lines 36-41), add `.eq('surface', 'chat')`:

```typescript
    const { error: archiveErr } = await supabase
      .from('lamplight_chat_threads')
      .update({ archived: true })
      .eq('user_id', userId)
      .eq('passage_ref', passageRef)
      .eq('surface', 'chat')
      .eq('archived', false);
```

In `supabase/functions/lamplight-chat/index.ts`, add `.eq('surface', 'chat')` to both `upsertThread` lookups (lines 170 and 180) — before `.maybeSingle()` / `.single()`:

```typescript
  const existing = await supabase
    .from('lamplight_chat_threads').select('id')
    .eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'chat').eq('archived', false).maybeSingle();
```

```typescript
  const reread = await supabase
    .from('lamplight_chat_threads').select('id')
    .eq('user_id', userId).eq('passage_ref', passageRef).eq('surface', 'chat').eq('archived', false).single();
```

(The existing INSERT at line 173-176 needs no change — `surface` defaults to `'chat'`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/notepad/bible/useChatThread.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/lamplight-chat/index.ts src/notepad/bible/useChatThread.ts src/notepad/bible/useChatThread.test.ts
git commit -m "fix(study): scope existing Bible-chat thread lookups to surface='chat'"
```

---

## Phase D — Frontend data plumbing

### Task 14: Study chat client

**Files:**
- Create: `src/notepad/study/study-chat-client.ts`
- Test: `src/notepad/study/study-chat-client.test.ts`

**Interfaces:**
- Consumes: `InvokeFn`, `ChatCitation` from `../bible/lamplight-chat-client`.
- Produces: `OfferedNote = { id; title; snippet }`; `SendStudyResult = { ok: true; threadId; reply; citations; offeredNotes } | { ok: false; reason }`; `sendStudyMessage(invoke, { book, chapter, message, includeNotes?, noteIds? })`; `requestStudyInsight(invoke, { book, chapter })`.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/study-chat-client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sendStudyMessage, requestStudyInsight } from './study-chat-client';

describe('sendStudyMessage', () => {
  it('invokes lamplight-study and surfaces offered notes', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, thread_id: 't1', reply: 'Grace.', citations: [], offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] },
      error: null,
    });
    const out = await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi' });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', { body: { book: 'jhn', chapter: 10, message: 'hi', include_notes: false, note_ids: [] } });
    expect(out).toEqual({ ok: true, threadId: 't1', reply: 'Grace.', citations: [], offeredNotes: [{ id: 'n1', title: 'A', snippet: 's' }] });
  });
  it('passes include_notes + note_ids when bringing notes in', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', reply: 'r', citations: [], offered_notes: [] }, error: null });
    await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi', includeNotes: true, noteIds: ['n1'] });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', { body: { book: 'jhn', chapter: 10, message: 'hi', include_notes: true, note_ids: ['n1'] } });
  });
  it('maps a transport error to ok:false', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'network' } });
    expect(await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi' })).toEqual({ ok: false, reason: 'network' });
  });
  it('passes through a server ok:false reason', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: false, reason: 'quota_exceeded' }, error: null });
    expect(await sendStudyMessage(invoke, { book: 'jhn', chapter: 10, message: 'hi' })).toEqual({ ok: false, reason: 'quota_exceeded' });
  });
});

describe('requestStudyInsight', () => {
  it('sends insight mode and maps a skipped insight to ok:false', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, thread_id: 't', skipped: true }, error: null });
    const out = await requestStudyInsight(invoke, { book: 'rom', chapter: 8 });
    expect(invoke).toHaveBeenCalledWith('lamplight-study', { body: { book: 'rom', chapter: 8, mode: 'insight' } });
    expect(out).toEqual({ ok: false, reason: 'skipped' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/study-chat-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `src/notepad/study/study-chat-client.ts`:

```typescript
// src/notepad/study/study-chat-client.ts
import type { ChatCitation, InvokeFn } from '../bible/lamplight-chat-client';

export interface OfferedNote { id: string; title: string; snippet: string }

export interface SendStudyArgs {
  book: string; chapter: number; message: string;
  includeNotes?: boolean; noteIds?: string[];
}

export type SendStudyResult =
  | { ok: true; threadId: string; reply: string; citations: ChatCitation[]; offeredNotes: OfferedNote[] }
  | { ok: false; reason: string };

export async function sendStudyMessage(invoke: InvokeFn, args: SendStudyArgs): Promise<SendStudyResult> {
  const { data, error } = await invoke('lamplight-study', {
    body: {
      book: args.book, chapter: args.chapter, message: args.message,
      include_notes: args.includeNotes ?? false,
      note_ids: args.noteIds ?? [],
    },
  });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply ?? '', citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}

export interface RequestStudyInsightArgs { book: string; chapter: number }

export async function requestStudyInsight(invoke: InvokeFn, args: RequestStudyInsightArgs): Promise<SendStudyResult> {
  const { data, error } = await invoke('lamplight-study', { body: { book: args.book, chapter: args.chapter, mode: 'insight' } });
  if (error) return { ok: false, reason: error.message };
  const d = data as { ok?: boolean; reason?: string; skipped?: boolean; thread_id?: string; reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null;
  if (!d || d.ok !== true) return { ok: false, reason: d?.reason ?? 'unknown_error' };
  if (d.skipped || typeof d.reply !== 'string') return { ok: false, reason: 'skipped' };
  return { ok: true, threadId: d.thread_id ?? '', reply: d.reply, citations: d.citations ?? [], offeredNotes: d.offered_notes ?? [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/study-chat-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/study-chat-client.ts src/notepad/study/study-chat-client.test.ts
git commit -m "feat(study): study-chat-client (sendStudyMessage/requestStudyInsight + offeredNotes)"
```

---

### Task 15: `useStudyChatThread` hook (surface-scoped)

**Files:**
- Create: `src/notepad/study/useStudyChatThread.ts`
- Test: `src/notepad/study/useStudyChatThread.test.ts`

**Interfaces:**
- Produces: `useStudyChatThread(book, chapter, userId): UseStudyChatThreadResult` — same shape as `UseChatThreadResult`, scoped to `surface='study'`.

> This mirrors `src/notepad/bible/useChatThread.ts` exactly, with `.eq('surface', 'study')` added to the active-thread select and to `archiveAndReset`. Copy the hook source (the executor may be reading this task out of order — the full code is below).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/useStudyChatThread.test.ts` mirroring `useChatThread.test.ts` (hoisted Supabase chain mocks, `@vitest-environment jsdom`). Include the two baseline cases plus a surface-scoping assertion:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { from, selectThread, eqUser, eqPassage, eqSurface, eqArchived, maybeSingle, order, eqThreadId, selectMsg } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const order = vi.fn();
  const eqArchived = vi.fn(() => ({ maybeSingle }));
  const eqSurface = vi.fn(() => ({ eq: eqArchived }));
  const eqPassage = vi.fn(() => ({ eq: eqSurface }));
  const eqUser = vi.fn(() => ({ eq: eqPassage }));
  const selectThread = vi.fn(() => ({ eq: eqUser }));
  const eqThreadId = vi.fn(() => ({ order }));
  const selectMsg = vi.fn(() => ({ eq: eqThreadId }));
  const from = vi.fn();
  return { from, selectThread, eqUser, eqPassage, eqSurface, eqArchived, maybeSingle, order, eqThreadId, selectMsg };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
import { useStudyChatThread } from './useStudyChatThread';

beforeEach(() => {
  vi.clearAllMocks();
  from.mockImplementation((t: string) => (t === 'lamplight_chat_threads' ? { select: selectThread } : { select: selectMsg }));
  order.mockResolvedValue({ data: [], error: null });
});

it('returns [] and scopes the lookup to surface="study" when no thread exists', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  const { result } = renderHook(() => useStudyChatThread('jhn', 10, 'u1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.messages).toEqual([]);
  expect(eqSurface).toHaveBeenCalledWith('surface', 'study');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/useStudyChatThread.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/notepad/study/useStudyChatThread.ts` (copy of `useChatThread.ts` with `surface='study'`):

```typescript
// src/notepad/study/useStudyChatThread.ts
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ChatCitation } from '../bible/lamplight-chat-client';

export interface StudyThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ChatCitation[];
}

export interface UseStudyChatThreadResult {
  messages: StudyThreadMessage[];
  loading: boolean;
  error: string | null;
  append: (msgs: StudyThreadMessage[]) => void;
  reload: () => void;
  archiveAndReset: () => Promise<void>;
}

export function useStudyChatThread(book: string, chapter: number, userId: string | null): UseStudyChatThreadResult {
  const [messages, setMessages] = useState<StudyThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const passageRef = `${book}.${chapter}`;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const append = useCallback((msgs: StudyThreadMessage[]) => setMessages((prev) => [...prev, ...msgs]), []);

  const archiveAndReset = useCallback(async () => {
    if (!supabase || !userId) return;
    const { error: archiveErr } = await supabase
      .from('lamplight_chat_threads')
      .update({ archived: true })
      .eq('user_id', userId)
      .eq('passage_ref', passageRef)
      .eq('surface', 'study')
      .eq('archived', false);
    if (archiveErr) { setError(archiveErr.message); return; }
    setError(null);
    setMessages([]);
    setNonce((n) => n + 1);
  }, [userId, passageRef]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setMessages([]);

    if (!supabase || !userId) { setLoading(false); return; }

    (async () => {
      const thread = await supabase
        .from('lamplight_chat_threads')
        .select('id')
        .eq('user_id', userId)
        .eq('passage_ref', passageRef)
        .eq('surface', 'study')
        .eq('archived', false)
        .maybeSingle();
      if (cancelled) return;
      if (thread.error) { setError(thread.error.message); setLoading(false); return; }
      const threadId = (thread.data as { id?: string } | null)?.id;
      if (!threadId) { setMessages([]); setLoading(false); return; }

      const { data, error: mErr } = await supabase
        .from('lamplight_chat_messages')
        .select('id, role, content, citations')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (mErr) { setError(mErr.message); setMessages([]); }
      else setMessages((data ?? []) as StudyThreadMessage[]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [passageRef, userId, nonce]);

  return { messages, loading, error, append, reload, archiveAndReset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/useStudyChatThread.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/useStudyChatThread.ts src/notepad/study/useStudyChatThread.test.ts
git commit -m "feat(study): useStudyChatThread (surface-scoped thread hook)"
```

---

### Task 16: Apparatus query builders + `useApparatus`

**Files:**
- Create: `src/notepad/study/apparatus-queries.ts`
- Test: `src/notepad/study/apparatus-queries.test.ts`
- Create: `src/notepad/study/useApparatus.ts`
- Create: `src/notepad/study/useNotesOnOffer.ts`

**Interfaces:**
- Produces:
  - `crossesTestament(a, b)` (frontend copy keyed off `BIBLE_BOOKS`), `sameEraFilter(start, end)`, `groupSameAuthor(rows)` — pure, tested.
  - `BookApparatus`, `CrossRefView` types; `useApparatus(book, chapter): { book: BookApparatus | null; crossRefs: CrossRefView[]; loading: boolean; error: string | null }`.
  - `useNotesOnOffer(): { offered, setOffered, includedIds, includeNote, reset }`.

- [ ] **Step 1: Write the failing test for query builders**

Create `src/notepad/study/apparatus-queries.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { crossesTestament, groupSameAuthor } from './apparatus-queries';

describe('crossesTestament (frontend)', () => {
  it('detects OT<->NT spans by book abbrev', () => {
    expect(crossesTestament('isa', 'mat')).toBe(true);
    expect(crossesTestament('gen', 'exo')).toBe(false);
  });
});

describe('groupSameAuthor', () => {
  it('groups books that share an author, excluding the current book', () => {
    const rows = [
      { book: 'luk', author: 'Luke', full_name: 'Luke' },
      { book: 'act', author: 'Luke', full_name: 'Acts' },
      { book: 'rom', author: 'Paul', full_name: 'Romans' },
    ];
    expect(groupSameAuthor(rows, 'luk')).toEqual([{ book: 'act', author: 'Luke', full_name: 'Acts' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/apparatus-queries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the query builders**

Create `src/notepad/study/apparatus-queries.ts`:

```typescript
// src/notepad/study/apparatus-queries.ts
import { BIBLE_BOOKS } from '../bible/bible-books';

const TESTAMENT = new Map(BIBLE_BOOKS.map((b) => [b.abbrev, b.testament]));

export function crossesTestament(a: string, b: string): boolean {
  const ta = TESTAMENT.get(a);
  const tb = TESTAMENT.get(b);
  if (!ta || !tb) return false;
  return ta !== tb;
}

export interface AuthorRow { book: string; author: string; full_name: string }

export function groupSameAuthor(rows: AuthorRow[], currentBook: string): AuthorRow[] {
  const current = rows.find((r) => r.book === currentBook);
  if (!current) return [];
  return rows.filter((r) => r.book !== currentBook && r.author === current.author);
}

// Inclusive overlap predicate for "written around the same time".
export function sameEraOverlap(
  a: { start: number | null; end: number | null },
  b: { start: number | null; end: number | null },
): boolean {
  if (a.start === null || a.end === null || b.start === null || b.end === null) return false;
  return a.start <= b.end && b.start <= a.end;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notepad/study/apparatus-queries.test.ts`
Expected: PASS

- [ ] **Step 5: Implement the data hooks (no unit test — thin Supabase glue, covered by pane render tests in Phase G)**

Create `src/notepad/study/useApparatus.ts`:

```typescript
// src/notepad/study/useApparatus.ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { crossesTestament } from './apparatus-queries';

export interface BookApparatus {
  book: string; full_name: string; author: string; author_note: string;
  date_label: string; region: string; cultural_context: string; genre: string; summary: string;
}
export interface CrossRefView {
  to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number;
  votes: number; crossesTestament: boolean; text: string;
}

export function useApparatus(book: string, chapter: number) {
  const [bookCtx, setBookCtx] = useState<BookApparatus | null>(null);
  const [crossRefs, setCrossRefs] = useState<CrossRefView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(null); setBookCtx(null); setCrossRefs([]);
    if (!supabase) { setLoading(false); return; }

    (async () => {
      try {
        const { data: bRow } = await supabase
          .from('bible_books')
          .select('book, full_name, author, author_note, date_label, region, cultural_context, genre, summary')
          .eq('book', book).maybeSingle();
        if (!cancelled) setBookCtx((bRow as BookApparatus | null) ?? null);

        const { data: xRows } = await supabase
          .from('bible_cross_references')
          .select('to_book, to_chapter, to_verse_start, to_verse_end, votes')
          .eq('from_book', book).eq('from_chapter', chapter)
          .order('votes', { ascending: false }).limit(8);
        const xs = (xRows ?? []) as Array<{ to_book: string; to_chapter: number; to_verse_start: number; to_verse_end: number; votes: number }>;
        const views: CrossRefView[] = [];
        for (const x of xs) {
          const id = `${x.to_book}.${x.to_chapter}.${x.to_verse_start}`;
          const { data: tgt } = await supabase.from('bible_passages').select('text').eq('id', id).maybeSingle();
          views.push({ ...x, crossesTestament: crossesTestament(book, x.to_book), text: (tgt as { text?: string } | null)?.text ?? '' });
        }
        if (!cancelled) setCrossRefs(views);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed to load study context');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [book, chapter]);

  return { book: bookCtx, crossRefs, loading, error };
}
```

Create `src/notepad/study/useNotesOnOffer.ts`:

```typescript
// src/notepad/study/useNotesOnOffer.ts
import { useCallback, useState } from 'react';
import type { OfferedNote } from './study-chat-client';

export function useNotesOnOffer() {
  const [offered, setOffered] = useState<OfferedNote[]>([]);
  const [includedIds, setIncludedIds] = useState<string[]>([]);

  const includeNote = useCallback((id: string) => {
    setIncludedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const reset = useCallback(() => { setOffered([]); setIncludedIds([]); }, []);

  return { offered, setOffered, includedIds, includeNote, reset };
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/study/apparatus-queries.ts src/notepad/study/apparatus-queries.test.ts src/notepad/study/useApparatus.ts src/notepad/study/useNotesOnOffer.ts
git commit -m "feat(study): apparatus query builders + useApparatus + useNotesOnOffer"
```

---

## Phase E — Theming

### Task 17: `--lamplight-accent` var + study indigo override

**Files:**
- Modify: `src/index.css` (`:root`)
- Create: `src/notepad/study/study-theme.css`
- Modify: `src/notepad/bible/BibleReader.tsx:320`
- Modify: `src/components/sections/notepad/StudyWindow.tsx:40`

> The shared `BibleReader` (verse-number `#C49A78`) renders inside the Study reader, so pointing it at `var(--lamplight-accent)` makes the reader gold in journaling and indigo under `[data-mode="study"]`. `StudyWindow.tsx:40` (also `#C49A78`) becomes the var as a safe no-op (default gold preserved). **Do NOT** rewrite the `#b8843a` lamplight-tab gold — that is a distinct accent, journaling-only, and recoloring it would regress journaling visuals.

- [ ] **Step 1: Add the default var to `:root`**

In `src/index.css`, inside the existing `:root { … }` block (next to other custom properties like `--deep-umber`), add:

```css
  --lamplight-accent: #C49A78; /* scripture gold; overridden to indigo under [data-mode="study"] */
```

- [ ] **Step 2: Create the study theme override**

Create `src/notepad/study/study-theme.css`:

```css
/* Study Desk recolors from one scope: the indigo accent on the cream base. */
[data-mode='study'] {
  --lamplight-accent: #43508C; /* Twilight Indigo */
}
```

- [ ] **Step 3: Point the shared reader + study window at the var**

In `src/notepad/bible/BibleReader.tsx:320`, change `style={{ color: '#C49A78' }}` to:

```tsx
            <sup className="text-[9px] font-bold mr-1" style={{ color: 'var(--lamplight-accent)' }}>{v.verse}</sup>
```

In `src/components/sections/notepad/StudyWindow.tsx:40`, change `boxShadow: active ? 'inset 0 -2px 0 #C49A78' : 'none',` to:

```tsx
  boxShadow: active ? 'inset 0 -2px 0 var(--lamplight-accent)' : 'none',
```

- [ ] **Step 4: Typecheck + verify no visual regression to journaling**

Run: `npx tsc -b`
Expected: no NEW errors. (Visual: journaling still renders gold because the default var is `#C49A78`; the indigo only applies under the `data-mode="study"` scope added in Phase G.)

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/notepad/study/study-theme.css src/notepad/bible/BibleReader.tsx src/components/sections/notepad/StudyWindow.tsx
git commit -m "feat(study): --lamplight-accent var + indigo override for [data-mode=study]"
```

---

## Phase F — Routing & toggle

### Task 18: Export `NotepadWorkspace` from the section

**Files:**
- Modify: `src/components/sections/Notepad.tsx:321`

> The nested layout (Task 19) renders the journaling workspace as a route child, so the workspace component must be importable independently of the `<Notepad/>` wrapper (which currently owns `NotepadProvider`).

- [ ] **Step 1: Export the workspace**

In `src/components/sections/Notepad.tsx`, change the declaration at line 321 from `function NotepadWorkspace() {` to:

```tsx
export function NotepadWorkspace() {
```

(Leave `Notepad()` at lines 331-338 intact — it remains the standalone wrapper used anywhere outside the nested routes; the nested layout will not use it.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no NEW errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sections/Notepad.tsx
git commit -m "refactor(study): export NotepadWorkspace for nested layout routing"
```

---

### Task 19: Provider-hoisting layout routes

**Files:**
- Modify: `src/auth/username/NotepadRoutes.tsx`
- Modify: `src/App.tsx:226-271` (the two notepad routes)
- Test: `src/auth/username/NotepadRoutes.test.tsx` (create — verify the toggle navigates without remounting the provider)

**Interfaces:**
- Produces: `LocalNotepadLayout` and `VanityNotepadLayout` — run `useUsernameGate()`, and on a renderable gate state mount `<NotepadProvider adapter={adapter}><Outlet/></NotepadProvider>`.

- [ ] **Step 1: Write the failing test (provider mounts once across child navigation)**

Create `src/auth/username/NotepadRoutes.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';

// Count NotepadProvider mounts to prove the layout hoists it once.
const mountSpy = vi.fn();
vi.mock('@/notepad/context/NotepadProvider', () => ({
  NotepadProvider: ({ children }: { children: React.ReactNode }) => { mountSpy(); return <>{children}</>; },
}));
vi.mock('./useUsernameGate', () => ({ useUsernameGate: () => ({ kind: 'signed-out' }) }));
vi.mock('@/auth/useAuthSession', () => ({ useAuthSession: () => ({ adapter: undefined }) }));

import { LocalNotepadLayout } from './NotepadRoutes';

describe('LocalNotepadLayout', () => {
  it('mounts NotepadProvider once and renders the active child', () => {
    render(
      <MemoryRouter initialEntries={['/notepad/notes/study']}>
        <Routes>
          <Route path="/notepad/notes" element={<LocalNotepadLayout />}>
            <Route index element={<div>journal</div>} />
            <Route path="study" element={<div>study</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('study')).toBeTruthy();
    expect(mountSpy).toHaveBeenCalledTimes(1);
  });
});
```

> Adjust the mocked import paths (`useUsernameGate`, `useAuthSession`) to the actual modules used by `NotepadRoutes.tsx`/`Notepad.tsx` if they differ — confirm by reading the current imports before writing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/username/NotepadRoutes.test.tsx`
Expected: FAIL — `LocalNotepadLayout` not exported.

- [ ] **Step 3: Implement the layout components**

In `src/auth/username/NotepadRoutes.tsx`, add `Outlet` to the `react-router-dom` import and the `NotepadProvider` + `useAuthSession` imports (match the paths used in `Notepad.tsx`), then add the two layout components alongside the existing gate routes. The layouts replicate each existing gate's branch logic but render `<NotepadProvider adapter={adapter}><Outlet/></NotepadProvider>` on the renderable state instead of `<Notepad/>`:

```tsx
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { NotepadProvider } from '@/notepad/context/NotepadProvider';
import { useAuthSession } from '@/auth/useAuthSession';
// (existing imports: useUsernameGate, NotepadGateSpinner, UsernameClaim, normalizeUsername, …)

export function LocalNotepadLayout() {
  const gate = useUsernameGate();
  const { adapter } = useAuthSession();
  switch (gate.kind) {
    case 'loading':       return <NotepadGateSpinner />;
    case 'needs-username': return <UsernameClaim />;
    case 'ready':         return <Navigate to={`/notepad/u/${gate.username}`} replace />;
    case 'signed-out':
      return (
        <NotepadProvider adapter={adapter}>
          <Outlet />
        </NotepadProvider>
      );
  }
}

export function VanityNotepadLayout() {
  const gate = useUsernameGate();
  const { username: param } = useParams();
  const { adapter } = useAuthSession();
  switch (gate.kind) {
    case 'loading':       return <NotepadGateSpinner />;
    case 'signed-out':    return <Navigate to="/notepad/notes" replace />;
    case 'needs-username': return <UsernameClaim />;
    case 'ready':
      return normalizeUsername(param ?? '') === gate.username ? (
        <NotepadProvider adapter={adapter}>
          <Outlet />
        </NotepadProvider>
      ) : (
        <Navigate to={`/notepad/u/${gate.username}`} replace />
      );
  }
}
```

> Keep the existing `LegacyNotepadRoute`/`VanityNotepadRoute` exports for now (other code may import them); they are simply no longer referenced by the notepad routes after Task 20. Remove them only if a follow-up confirms no other importers.

- [ ] **Step 4: Convert the routes in `src/App.tsx`**

Replace the two flat notepad routes (lines ~241-242) with nested layout routes. Import `NotepadWorkspace` (lazy, matching the file's lazy-import convention) and `StudyWorkspace` and the two layouts:

```tsx
<Route path="/notepad/notes" element={<LocalNotepadLayout />}>
  <Route index element={<NotepadWorkspace />} />
  <Route path="study" element={<StudyWorkspace />} />
</Route>
<Route path="/notepad/u/:username" element={<VanityNotepadLayout />}>
  <Route index element={<NotepadWorkspace />} />
  <Route path="study" element={<StudyWorkspace />} />
</Route>
```

(`StudyWorkspace` is created in Task 21; until then, the route element will not typecheck. To keep this task independently green, add a temporary minimal `StudyWorkspace` placeholder in Task 21's file now, OR sequence Task 21 before wiring the study child. Recommended: create the `StudyWorkspace.tsx` shell from Task 21 Step 3 first, then wire here.)

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/auth/username/NotepadRoutes.test.tsx && npx tsc -b`
Expected: test PASS; no NEW tsc errors.

- [ ] **Step 6: Commit**

```bash
git add src/auth/username/NotepadRoutes.tsx src/auth/username/NotepadRoutes.test.tsx src/App.tsx
git commit -m "feat(study): hoist NotepadProvider into nested layout routes (journaling + study)"
```

---

### Task 20: `Journaling | Study` toggle

**Files:**
- Create: `src/notepad/study/StudyModeToggle.tsx`
- Test: `src/notepad/study/StudyModeToggle.test.tsx`
- Modify: `src/notepad/components/NotepadToolbar.tsx` (mount the toggle after the logo, ~line 98)

**Interfaces:**
- Produces: `StudyModeToggle` — reads `useLocation()`, renders a two-segment control; "Journaling" navigates to the parent index, "Study" navigates to the `study` child. URL is the single source of truth.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/StudyModeToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudyModeToggle } from './StudyModeToggle';

describe('StudyModeToggle', () => {
  it('marks Study active on a /study URL', () => {
    render(<MemoryRouter initialEntries={['/notepad/u/ann/study']}><StudyModeToggle /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /study/i }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /journaling/i }).getAttribute('aria-current')).toBeNull();
  });
  it('marks Journaling active on the base URL', () => {
    render(<MemoryRouter initialEntries={['/notepad/u/ann']}><StudyModeToggle /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /journaling/i }).getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/StudyModeToggle.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the toggle**

Create `src/notepad/study/StudyModeToggle.tsx`. It derives the parent base from the current path (strip a trailing `/study`) and links to base (Journaling) and `${base}/study` (Study):

```tsx
// src/notepad/study/StudyModeToggle.tsx
import { Link, useLocation } from 'react-router-dom';

export function StudyModeToggle() {
  const { pathname } = useLocation();
  const isStudy = pathname.endsWith('/study');
  const base = isStudy ? pathname.slice(0, -'/study'.length) : pathname.replace(/\/$/, '');
  const segStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    fontSize: 11,
    letterSpacing: '0.08em',
    fontFamily: 'Outfit, sans-serif',
    color: active ? 'var(--deep-umber)' : 'var(--silica)',
    background: active ? 'rgba(196,154,120,0.16)' : 'transparent',
    borderRadius: 6,
    textDecoration: 'none',
  });
  return (
    <div role="tablist" aria-label="Notepad mode" style={{ display: 'flex', gap: 2 }}>
      <Link to={base} aria-current={isStudy ? undefined : 'page'} style={segStyle(!isStudy)}>Journaling</Link>
      <Link to={`${base}/study`} aria-current={isStudy ? 'page' : undefined} style={segStyle(isStudy)}>Study</Link>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in the toolbar**

In `src/notepad/components/NotepadToolbar.tsx`, import the toggle and render `<StudyModeToggle />` immediately after the logo block (~line 98, before the search bar):

```tsx
import { StudyModeToggle } from '@/notepad/study/StudyModeToggle';
// … inside the toolbar row, after the logo:
<StudyModeToggle />
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/notepad/study/StudyModeToggle.test.tsx && npx tsc -b`
Expected: test PASS; no NEW tsc errors.

- [ ] **Step 6: Commit**

```bash
git add src/notepad/study/StudyModeToggle.tsx src/notepad/study/StudyModeToggle.test.tsx src/notepad/components/NotepadToolbar.tsx
git commit -m "feat(study): Journaling | Study header toggle"
```

---

## Phase G — Study Desk panes

### Task 21: `StudyWorkspace` shell (`data-mode="study"`)

**Files:**
- Create: `src/notepad/study/StudyWorkspace.tsx`
- Test: `src/notepad/study/StudyWorkspace.test.tsx`

**Interfaces:**
- Consumes: `useAuthSession` (for `userId`), `ApparatusRail`, `StudyReader`, `LamplightStudyPanel` (Tasks 22-24).
- Produces: `StudyWorkspace` — root `<div data-mode="study" className="study-workspace">` with three panes; holds the open-passage `{ book, chapter }` state shared by the panes; imports `./study-theme.css`.

> Build the shell first with placeholder pane imports so Task 19 can wire the route. Replace placeholders as Tasks 22-24 land. The render test asserts the `data-mode="study"` attribute (proves the indigo scope is active).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/StudyWorkspace.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./panes/ApparatusRail', () => ({ ApparatusRail: () => <div>rail</div> }));
vi.mock('./panes/StudyReader', () => ({ StudyReader: () => <div>reader</div> }));
vi.mock('./panes/LamplightStudyPanel', () => ({ LamplightStudyPanel: () => <div>panel</div> }));
vi.mock('@/auth/useAuthSession', () => ({ useAuthSession: () => ({ userId: 'u1' }) }));

import { StudyWorkspace } from './StudyWorkspace';

describe('StudyWorkspace', () => {
  it('renders three panes under data-mode="study"', () => {
    const { container } = render(<StudyWorkspace />);
    const root = container.querySelector('[data-mode="study"]');
    expect(root).toBeTruthy();
    expect(root?.textContent).toContain('rail');
    expect(root?.textContent).toContain('reader');
    expect(root?.textContent).toContain('panel');
  });
});
```

> Confirm `useAuthSession` exposes `userId` (or derive it from the session object the app actually uses); adjust the mock + import accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/StudyWorkspace.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shell**

Create `src/notepad/study/StudyWorkspace.tsx`:

```tsx
// src/notepad/study/StudyWorkspace.tsx
import { useState } from 'react';
import { useAuthSession } from '@/auth/useAuthSession';
import { ApparatusRail } from './panes/ApparatusRail';
import { StudyReader } from './panes/StudyReader';
import { LamplightStudyPanel } from './panes/LamplightStudyPanel';
import './study-theme.css';

export function StudyWorkspace() {
  const { userId } = useAuthSession();
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });

  return (
    <div data-mode="study" className="study-workspace" style={{ display: 'flex', height: '100%', background: 'var(--cream, #F4F1EA)' }}>
      <aside style={{ flex: '0 0 280px', borderRight: '1px solid var(--pale-stone)', overflow: 'auto' }}>
        <ApparatusRail book={passage.book} chapter={passage.chapter} />
      </aside>
      <main style={{ flex: '1 1 0%', overflow: 'auto' }}>
        <StudyReader
          book={passage.book}
          chapter={passage.chapter}
          onPassageChange={(ref) => setPassage({ book: ref.book, chapter: ref.chapter })}
        />
      </main>
      <aside style={{ flex: '0 0 360px', borderLeft: '1px solid var(--pale-stone)', overflow: 'auto' }}>
        <LamplightStudyPanel book={passage.book} chapter={passage.chapter} userId={userId ?? null} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/notepad/study/StudyWorkspace.test.tsx && npx tsc -b`
Expected: test PASS; tsc will error only on the not-yet-created pane modules — create them in Tasks 22-24 before the final `tsc -b`. (If sequencing strictly, add minimal placeholder pane files now and flesh them out next.)

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/StudyWorkspace.tsx src/notepad/study/StudyWorkspace.test.tsx
git commit -m "feat(study): StudyWorkspace three-pane shell (data-mode=study)"
```

---

### Task 22: `StudyReader` pane

**Files:**
- Create: `src/notepad/study/panes/StudyReader.tsx`
- Test: `src/notepad/study/panes/StudyReader.test.tsx`

**Interfaces:**
- Consumes: `BibleReader` (`src/notepad/bible/BibleReader.tsx`) and its `PassageRef` callback type.
- Produces: `StudyReader({ book, chapter, onPassageChange })` — wraps `BibleReader` (which inherits the indigo `--lamplight-accent` from the study scope).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/panes/StudyReader.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/notepad/bible/BibleReader', () => ({
  BibleReader: (props: { initialBook: string; initialChapter: number }) =>
    <div>reader {props.initialBook}:{props.initialChapter}</div>,
}));
import { StudyReader } from './StudyReader';

describe('StudyReader', () => {
  it('renders the BibleReader seeded with the open passage', () => {
    render(<StudyReader book="rom" chapter={8} onPassageChange={() => {}} />);
    expect(screen.getByText('reader rom:8')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/StudyReader.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pane**

Create `src/notepad/study/panes/StudyReader.tsx`:

```tsx
// src/notepad/study/panes/StudyReader.tsx
import { BibleReader } from '@/notepad/bible/BibleReader';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
}

export function StudyReader({ book, chapter, onPassageChange }: StudyReaderProps) {
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      onPassageChange={(ref) => onPassageChange({ book: ref.book, chapter: ref.chapter })}
    />
  );
}
```

> Confirm `BibleReader`'s `onPassageChange` payload field names (`PassageRef`) — the explorer reported `{ book, chapter }`-shaped. Adjust the destructure if the real type differs.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/notepad/study/panes/StudyReader.test.tsx && npx tsc -b`
Expected: test PASS; no NEW tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/panes/StudyReader.tsx src/notepad/study/panes/StudyReader.test.tsx
git commit -m "feat(study): StudyReader pane (wraps BibleReader in the indigo skin)"
```

---

### Task 23: `ApparatusRail` pane

**Files:**
- Create: `src/notepad/study/panes/ApparatusRail.tsx`
- Test: `src/notepad/study/panes/ApparatusRail.test.tsx`

**Interfaces:**
- Consumes: `useApparatus`.
- Produces: `ApparatusRail({ book, chapter })` — book context card + cross-references (OT↔NT surfaced specially); degrades quietly (hide a section that has no data; never throw).

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/panes/ApparatusRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useApparatus = vi.fn();
vi.mock('../useApparatus', () => ({ useApparatus: (b: string, c: number) => useApparatus(b, c) }));
import { ApparatusRail } from './ApparatusRail';

describe('ApparatusRail', () => {
  it('renders the book card and flags OT<->NT cross refs', () => {
    useApparatus.mockReturnValue({
      book: { full_name: 'Isaiah', author: 'Isaiah', author_note: 'authorship debated', date_label: '~700 BC', region: 'Judah', cultural_context: 'Assyrian crisis', genre: 'Prophecy', summary: 'Judgment and comfort.' },
      crossRefs: [{ to_book: 'mat', to_chapter: 1, to_verse_start: 23, to_verse_end: 23, votes: 50, crossesTestament: true, text: 'the virgin will conceive' }],
      loading: false, error: null,
    });
    render(<ApparatusRail book="isa" chapter={7} />);
    expect(screen.getByText('Isaiah')).toBeTruthy();
    expect(screen.getByText(/authorship debated/)).toBeTruthy();
    expect(screen.getByText(/OT ↔ NT/)).toBeTruthy();
  });
  it('hides the book card when metadata is absent (degrades quietly)', () => {
    useApparatus.mockReturnValue({ book: null, crossRefs: [], loading: false, error: null });
    const { container } = render(<ApparatusRail book="xyz" chapter={1} />);
    expect(container.textContent).not.toContain('undefined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pane**

Create `src/notepad/study/panes/ApparatusRail.tsx`:

```tsx
// src/notepad/study/panes/ApparatusRail.tsx
import { useApparatus, type CrossRefView } from '../useApparatus';
import { bookByAbbrev } from '@/notepad/bible/bible-books';

function refLabel(x: CrossRefView): string {
  const name = bookByAbbrev(x.to_book)?.name ?? x.to_book;
  const verses = x.to_verse_start === x.to_verse_end ? `${x.to_verse_start}` : `${x.to_verse_start}-${x.to_verse_end}`;
  return `${name} ${x.to_chapter}:${verses}`;
}

export interface ApparatusRailProps { book: string; chapter: number }

export function ApparatusRail({ book, chapter }: ApparatusRailProps) {
  const { book: ctx, crossRefs, loading, error } = useApparatus(book, chapter);

  if (loading) return <div style={{ padding: 16, color: 'var(--silica)' }}>Loading study context…</div>;
  if (error) return <div style={{ padding: 16, color: 'var(--silica)' }}>Couldn’t load study context. <button onClick={() => location.reload()}>Retry</button></div>;

  return (
    <div style={{ padding: 16, fontFamily: 'Outfit, sans-serif' }}>
      {ctx && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: 'var(--deep-umber)', margin: '0 0 8px' }}>{ctx.full_name}</h2>
          <dl style={{ fontSize: 12, color: 'var(--deep-umber)', lineHeight: 1.5 }}>
            <div><strong>Author:</strong> {ctx.author}{ctx.author_note ? ` — ${ctx.author_note}` : ''}</div>
            {ctx.date_label && <div><strong>Date:</strong> {ctx.date_label}</div>}
            {ctx.region && <div><strong>Region:</strong> {ctx.region}</div>}
            {ctx.genre && <div><strong>Genre:</strong> {ctx.genre}</div>}
            {ctx.cultural_context && <p style={{ margin: '8px 0 0' }}>{ctx.cultural_context}</p>}
            {ctx.summary && <p style={{ margin: '8px 0 0' }}>{ctx.summary}</p>}
          </dl>
        </section>
      )}

      {crossRefs.length > 0 && (
        <section>
          <h3 style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--silica)', margin: '0 0 8px' }}>CROSS-REFERENCES</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {crossRefs.map((x, i) => (
              <li key={i} style={{ marginBottom: 10, fontSize: 12 }}>
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

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/notepad/study/panes/ApparatusRail.test.tsx && npx tsc -b`
Expected: test PASS; no NEW tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/panes/ApparatusRail.tsx src/notepad/study/panes/ApparatusRail.test.tsx
git commit -m "feat(study): ApparatusRail pane (book card + cross-refs, OT<->NT flagged)"
```

---

### Task 24: `LamplightStudyPanel` pane (with notes-on-offer)

**Files:**
- Create: `src/notepad/study/panes/LamplightStudyPanel.tsx`
- Test: `src/notepad/study/panes/LamplightStudyPanel.test.tsx`

**Interfaces:**
- Consumes: `useStudyChatThread`, `useNotesOnOffer`, `sendStudyMessage`, `requestStudyInsight`, the app's Supabase `invoke` (functions client).
- Produces: `LamplightStudyPanel({ book, chapter, userId })` — message list + composer; renders the notes-on-offer affordance ("You have N notes touching this — bring them in?"); tapping it adds the id to the next request and re-sends.

- [ ] **Step 1: Write the failing test**

Create `src/notepad/study/panes/LamplightStudyPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const sendStudyMessage = vi.fn();
vi.mock('../study-chat-client', () => ({
  sendStudyMessage: (...a: unknown[]) => sendStudyMessage(...a),
  requestStudyInsight: vi.fn().mockResolvedValue({ ok: false, reason: 'skipped' }),
}));
vi.mock('../useStudyChatThread', () => ({
  useStudyChatThread: () => ({ messages: [], loading: false, error: null, append: vi.fn(), reload: vi.fn(), archiveAndReset: vi.fn() }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { LamplightStudyPanel } from './LamplightStudyPanel';

describe('LamplightStudyPanel notes-on-offer', () => {
  it('shows the offer after a reply returns offered notes', async () => {
    sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'r', citations: [], offeredNotes: [{ id: 'n1', title: 'A', snippet: 's' }] });
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    fireEvent.change(screen.getByРlaceholderText(/ask/i), { target: { value: 'what about shepherd?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeTruthy());
  });
});
```

> Note: the test references `getByPlaceholderText` (the typo above is illustrative — use the real Testing Library query `getByPlaceholderText`). Keep the placeholder text containing "Ask" and the send button labeled "Send" so the queries match.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pane**

Create `src/notepad/study/panes/LamplightStudyPanel.tsx`. Use the app's Supabase functions client as the `InvokeFn` (match how `LamplightChat.tsx` obtains `invoke` — it is passed in there; here, derive it from `supabase.functions.invoke`). Offer notes after each reply; tapping "bring them in" adds the id and re-sends the last user message with `includeNotes`.

```tsx
// src/notepad/study/panes/LamplightStudyPanel.tsx
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStudyChatThread } from '../useStudyChatThread';
import { useNotesOnOffer } from '../useNotesOnOffer';
import { sendStudyMessage, requestStudyInsight } from '../study-chat-client';
import type { InvokeFn } from '@/notepad/bible/lamplight-chat-client';

const invoke: InvokeFn = (name, options) =>
  supabase!.functions.invoke(name, { body: options.body }) as ReturnType<InvokeFn>;

export interface LamplightStudyPanelProps { book: string; chapter: number; userId: string | null }

export function LamplightStudyPanel({ book, chapter, userId }: LamplightStudyPanelProps) {
  const thread = useStudyChatThread(book, chapter, userId);
  const notes = useNotesOnOffer();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');

  const doSend = useCallback(async (message: string, includeIds: string[]) => {
    setSending(true); setError(null);
    if (!includeIds.length) {
      thread.append([{ id: `local-${Date.now()}`, role: 'user', content: message, citations: [] }]);
    }
    const res = await sendStudyMessage(invoke, {
      book, chapter, message,
      includeNotes: includeIds.length > 0,
      noteIds: includeIds,
    });
    setSending(false);
    if (!res.ok) { setError(res.reason); return; }
    thread.append([{ id: `a-${Date.now()}`, role: 'assistant', content: res.reply, citations: res.citations }]);
    notes.setOffered(res.offeredNotes);
  }, [book, chapter, thread, notes]);

  const send = useCallback(async () => {
    const m = draft.trim();
    if (!m) return;
    setDraft(''); setLastMessage(m); notes.reset();
    await doSend(m, []);
  }, [draft, doSend, notes]);

  const bringInNote = useCallback(async (id: string) => {
    notes.includeNote(id);
    await doSend(lastMessage, [...notes.includedIds, id]);
  }, [doSend, lastMessage, notes]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {thread.messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--silica)', marginBottom: 2 }}>{m.role === 'user' ? 'You' : 'Lamplight Study'}</div>
            <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        {notes.offered.length > 0 && (
          <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--lamplight-accent)', fontSize: 12 }}>
            <div style={{ marginBottom: 6, color: 'var(--deep-umber)' }}>
              You have {notes.offered.length} note{notes.offered.length === 1 ? '' : 's'} touching this — bring them in?
            </div>
            {notes.offered.map((o) => (
              <button key={o.id} onClick={() => bringInNote(o.id)}
                style={{ display: 'block', textAlign: 'left', width: '100%', marginBottom: 4, padding: '4px 8px', background: 'transparent', border: 'none', color: 'var(--lamplight-accent)', cursor: 'pointer' }}>
                + {o.title}
              </button>
            ))}
          </div>
        )}
        {error && <div style={{ color: '#b00', fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>
      <div style={{ borderTop: '1px solid var(--pale-stone)', padding: 12, display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask Lamplight Study about this passage…"
          style={{ flex: 1, fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--pale-stone)' }}
        />
        <button onClick={() => void send()} disabled={sending}
          style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: 'var(--lamplight-accent)', color: '#fff', cursor: 'pointer' }}>
          Send
        </button>
      </div>
    </div>
  );
}
```

> Confirm the actual Supabase functions-invoke signature the app uses (`supabase.functions.invoke(name, { body })` returns `{ data, error }`). If the app wraps invoke elsewhere (as `LamplightChat.tsx` receives `invoke` as a prop), prefer reusing that wrapper for parity instead of constructing `invoke` here.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx && npx tsc -b`
Expected: test PASS; no NEW tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/study/panes/LamplightStudyPanel.tsx src/notepad/study/panes/LamplightStudyPanel.test.tsx
git commit -m "feat(study): LamplightStudyPanel (Opus chat + notes-on-offer affordance)"
```

---

## Phase H — Integration verification, deploy, smoke

### Task 25: Baselines, deploy, and manual smoke

**Files:** none (verification + operational steps).

- [ ] **Step 1: Full test suite — zero new failures**

Run: `npm test`
Expected: the only failures are the known pre-existing red baseline (`Editor.toolbar-placement`, `garden-scene`). Every Study test passes. If any NEW file fails, fix it before proceeding.

- [ ] **Step 2: Typecheck the real build**

Run: `npx tsc -b`
Expected: only the 4 pre-existing `force-sphere.test.ts` errors. Zero new.

- [ ] **Step 3: Lint delta**

Run: `npm run lint` (or the project's lint command)
Expected: no NEW lint errors beyond the ~114 pre-existing. (Spot-check that no new error originates from a `src/notepad/study/**` or `supabase/functions/lamplight-study/**` path.)

- [ ] **Step 4: Apply migrations**

Run: `supabase db push`
Expected: `032`, `033`, `034` apply; `bible_books` has 66 rows; `lamplight_chat_threads.surface` exists; the active-passage unique index includes `surface`.

- [ ] **Step 5: Load cross-reference data**

Download `cross_references.txt` from OpenBible.info, then:

Run: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/ingest-cross-references.ts ./cross_references.txt`
Expected: batches upsert without an "Unmapped OSIS book token" error; `select count(*) from bible_cross_references;` is in the hundreds of thousands.

- [ ] **Step 6: Set the Study quota env knobs (optional; defaults apply otherwise)**

If tightening beyond defaults, set as edge-function secrets: `LAMPLIGHT_QUOTA_STUDY_NONE`, `LAMPLIGHT_QUOTA_STUDY_LITE`, `LAMPLIGHT_QUOTA_STUDY_PLUS`.

- [ ] **Step 7: Deploy the edge function (manual)**

Run: `supabase functions deploy lamplight-study --use-api`
Expected: deploy succeeds. (Reuses existing `ANTHROPIC_API_KEY` / `VOYAGE_AI_KEY` secrets.)

- [ ] **Step 8: Manual end-to-end smoke (human)**

- Navigate to `/notepad/u/<username>` → confirm the `Journaling | Study` toggle; click **Study** → URL becomes `/notepad/u/<username>/study`, the three-pane Study Desk renders in indigo, the notes brain does not remount (sidebar state preserved).
- Open a passage with known apparatus (e.g. Isaiah 7) → the rail shows the book card and at least one **OT ↔ NT** cross-reference; the reader verse numbers are indigo.
- Ask Lamplight Study a question → an Opus reply returns with citations; if you have semantically-relevant notes, the **"You have N notes touching this — bring them in?"** affordance appears; clicking it re-sends and the note is reflected in the reply.
- Toggle back to **Journaling** → the existing Bible-chat for the same passage is unaffected (separate `surface`), confirming no history intermixing.

- [ ] **Step 9: Final commit (if any docs/runbook notes were added)**

```bash
git add docs/superpowers/plans/2026-06-17-study-mode.md
git commit -m "docs(study): implementation plan for Study mode (Phase 1)"
```

---

## Self-Review (run before execution)

**1. Spec coverage** — every spec section maps to a task:
- Distinct space / own route / `NotepadProviderLayout` / signed-out parity → T18–T20.
- AI = Opus (`claude-opus-4-8`) + add to `MODEL_IDS` → T1; pipeline on Opus → T2 + T12.
- Study Desk three panes (rail · reader · panel) → T21–T24.
- Hybrid data: `bible_books` (66 rows, authorship uncertainty column) + `bible_cross_references` (votes, `crosses_testament`), rail = plain selects (no edge fn) → T4, T5, T16, T23.
- Notes-on-offer (Option C: compute always, inject only on `note_ids`/`include_notes`, return `offered_notes`, never auto-inject, fail-quiet) → T10, T11, T12, T14, T24.
- Accent = Twilight Indigo `#43508C` via `--lamplight-accent` + `[data-mode="study"]` → T17, T21.
- Backend `lamplight-study` reusing `_shared/*`, mirroring `lamplight-chat` → T8–T13.
- Tighter Study quota (new env knob, `study` scope) → T3, T12.
- Reuse `lamplight_chat_threads` with `surface` marker (migration 034) → T6, T13, T15.
- `study-chat-client.ts` mirroring `lamplight-chat-client.ts` → T14.
- Migrations 032/033/034 + idempotent OSIS→book ingest → T4–T7.
- Manual deploy + migration apply + zero-new-error baselines → T25.
- "To confirm at implementation" items resolved: Opus id = `claude-opus-4-8` (T1); `bible_passages.book` = lowercase OSIS, mapped in T7; Study quota defaults `3/10/30` (T3); companion accent vars limited to `--lamplight-accent` on the shared reader/study-window only, `#b8843a` deliberately left untouched (T17); pipeline reused via `model` param, not a variant (T2).

**2. Placeholder scan** — the only intentional "fill-in" is the `bible_books` seed body (T4) and the OSIS map completion (T7), both explicitly scoped to mechanical completion from `BIBLE_BOOKS`; every code task ships complete code. No "TODO/handle edge cases/add validation" placeholders.

**3. Type consistency** — `BibleChatContext.bookContext?: BookContext | null` defined in T2 and consumed in T8/T11; `OfferedNote` shape `{ id; title; snippet }` consistent across T10 (`OfferedNote`), T12 (response `offered_notes`), T14 (`offeredNotes`), T24; `surface='study'`/`'chat'` consistent across T6/T12/T13/T15; `model: 'opus'` consistent T1→T2→T12; quota `study` scope kind `'bible_study'` consistent T3→T12 (`artifactKind`).

**Known implementation-time confirmations to make before each touched file** (flagged inline in tasks): exact `useAuthSession` field for `userId` (T21/T24), the app's Supabase functions-invoke wrapper for parity with `LamplightChat.tsx` (T24), `BibleReader`'s `PassageRef` field names (T22), and the exact toolbar insertion point (T20). These are read-then-confirm, not open design questions.
