# Auto-Verse Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deliberate verse-insertion system to the notepad editor — type a reference to complete it inline (B), or open a `/verse` picker to search by reference/phrase/keyword (C) — each insertion becoming one two-state `scriptureRef` node that also feeds the existing reference graph.

**Architecture:** Hard logic lives in a framework-free `verse-search` module (routing, FTS, semantic, merge/dedupe/rank) injected with a data-access boundary so it unit-tests with no editor and no network. A single Tiptap inline-atom `scriptureRef` node owns two Suggestion configs (B predictive, C `/verse`) sharing one React dropdown and one `insertScriptureRef` command. Semantic search runs through a thin net-new edge function (Voyage key server-side). The graph becomes node-aware by extending one existing chokepoint (`parseReferencesFromContent`); no new sync wiring is needed because `NotepadActions.updateNote` already calls `referenceGraph.syncNote` on every content save.

**Tech Stack:** React 19 + Vite + TypeScript + Tiptap 3 (3.22.5) + `@tiptap/suggestion` (new) + Supabase (Postgres FTS + `match_bible_embeddings` pgvector RPC + Deno edge fn) + Vitest.

---

## Resolved open planning items (from the design spec)

These were the 4 open items in `docs/superpowers/specs/2026-06-15-auto-verse-completion-design.md`. Resolved against the code; baked into the tasks below.

1. **Query-embedding seam → net-new thin edge function.** No existing edge function exposes a raw "embed arbitrary query text → bible matches" endpoint to the browser (`lamplight-generate` emits generated artifacts; `lamplight-chat` is a chat turn; `embed-note` embeds *documents*, not queries). The reusable server-side primitive is `_shared/voyage.ts` `embedQuery(text, deps): Promise<number[]>` (`MODEL='voyage-context-3'`, `DIM=512`, `input_type:'query'`) plus the `match_bible_embeddings(p_query_vector vector(512), p_limit int)` RPC. Task 3 adds a thin `verse-search` edge function gluing those two, JWT-gated and CORS-enabled exactly like `embed-note`. The Voyage key stays server-side (`VOYAGE_AI_KEY`). **Consequence:** anonymous/offline users get FTS + reference only (semantic requires a signed-in JWT) — consistent with the spec's graceful-degrade stance and protects the Voyage budget.
2. **FTS column shape → stored generated `tsvector` column.** `bible_passages.text` is `text not null` (`009_bible_passages.sql:11`), no FTS today. Task 2 adds `text_tsv tsvector generated always as (to_tsvector('english', text)) stored` + a GIN index. Client queries it with `.textSearch('text_tsv', query, { type: 'websearch' })` filtered `translation = 'BSB'` (public-read RLS already present). Language `english`, single column `text`, stored (not expression index) so the GIN index is on a materialized column.
3. **Graph sync trigger → already wired; extend the parser only.** The spec guessed `onAfterSave`; that hook actually feeds Lamplight embeddings (`useLamplightEmbeddingTrigger`), not the graph. The graph sync runs through `NotepadActions.updateNote` → `await this.referenceGraph.syncNote(updated)` (`notepad-actions.ts:52-59`, fired whenever `updates.content !== undefined`) → `computeSyncForNote` (`reference-graph.ts:299`) → `parseReferencesFromContent` (`reference-parser.ts:337`). **So Task 11's node-aware extension to `parseReferencesFromContent` is sufficient — there is no new sync wiring to add.** It must emit the *same* `{ id, ref }` shape the prose path emits (`id = toCanonicalScriptureId(ref)`), so a verse typed in prose AND inserted as a node dedupe to one `ScriptureNode` via the existing `seen` set.
4. **Ranking heuristic → documented v1 blend** (Task 6). Per `VerseCandidate.score ∈ [0,1]`:
   - `reference` (parsed exact): `score = 1.0`, always pinned first.
   - `semantic`: `score = similarity` (RPC returns `1 - cosine_distance`, already 0..1).
   - `fts`: `score = 0.55` flat (solid lexical mid-confidence); DB return order preserved among ties via stable sort.
   - **Dedupe by `osis`:** merged `score = min(1, max(memberScores) + 0.15 * (memberCount - 1))` (corroboration boost); merged `source` by priority `reference > semantic > fts`; merged `text` from the first member with non-empty text.
   - **Final sort:** reference-pinned first, then `score` desc, stable.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/notepad/bible/verse-search-types.ts` | Shared types: `VerseCandidate`, raw row shapes, `VerseSearchDeps`. No logic. |
| `src/notepad/bible/verse-search.ts` | Framework-free: `routeQuery`, `normalizeFtsRow`, `normalizeSemanticRow`, `detectGrain`, `resolveCandidate`, `mergeCandidates`, `completeReference`, `createVerseSearch` (debounce + abort orchestration). Pure; deps injected. |
| `src/notepad/bible/verse-search.test.ts` | Unit tests for the above (no editor, no network, fake timers for debounce). |
| `src/notepad/bible/verse-search-client.ts` | Production `VerseSearchDeps` impl: FTS via `supabase.textSearch`, semantic via `functions.invoke('verse-search')`, pericope lookup, reuse `fetchVerseText`/`parseVerseRef`. |
| `src/notepad/bible/verse-search-client.test.ts` | Tests the client deps with a mocked `supabase`. |
| `src/notepad/extensions/scripture-ref-matchers.ts` | Pure B-path matcher: `findReferenceSuggestionMatch` (word-boundary book + chapter digit). |
| `src/notepad/extensions/scripture-ref-matchers.test.ts` | Unit tests for the matcher (fires on refs, not mid-prose). |
| `src/notepad/extensions/scripture-ref.ts` | The Tiptap inline-atom node: attrs, `parseHTML`/`renderHTML`, `insertScriptureRef` command, 2 Suggestion plugins, NodeView wiring. |
| `src/notepad/extensions/scripture-ref.editor.test.ts` | Headless-editor tests (jsdom): insert produces attrs, serialization round-trip + reject, toggle does not dirty doc. |
| `src/notepad/extensions/ScriptureRefView.tsx` | React NodeView: collapsed link ↔ expanded card, ephemeral collapse state, lazy-fill. |
| `src/notepad/extensions/ScriptureRefView.test.tsx` | RTL tests: render states, lazy-fill behavior. |
| `src/notepad/extensions/VerseSuggestList.tsx` | Shared dropdown for B & C: candidate rows + loading + offline states. |
| `src/notepad/extensions/VerseSuggestList.test.tsx` | RTL tests: rows render, select callback, offline + loading states. |
| `supabase/migrations/030_bible_passages_fts.sql` | FTS generated column + GIN index. |
| `supabase/functions/verse-search/index.ts` | Thin edge fn: embed query → `match_bible_embeddings` → return matches. |
| `supabase/functions/verse-search/deno.json` | Deno config (mirror `lamplight-chat/deno.json`). |

**Modified files**

| File | Change |
|---|---|
| `package.json` | Add `@tiptap/suggestion@^3.22.5`. |
| `src/notepad/graph/reference-parser.ts` | Add `walkNodes`; extend `parseReferencesFromContent` to be node-aware. |
| `src/notepad/graph/reference-parser.test.ts` | Add node-aware extraction tests (create file if absent). |
| `src/notepad/editor/use-note-editor.ts` | Register the `ScriptureRef` extension with its search deps. |

---

## Task 1: Add the `@tiptap/suggestion` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm it is not already installed**

Run: `grep '"@tiptap/suggestion"' package.json; echo "exit:$?"`
Expected: no match, `exit:1`.

- [ ] **Step 2: Install pinned to the existing Tiptap line**

Run: `npm install @tiptap/suggestion@^3.22.5 --save-exact=false`
Expected: adds `"@tiptap/suggestion": "^3.22.5"` to `dependencies`; install succeeds.

- [ ] **Step 3: Verify the package resolves and matches the Tiptap major**

Run: `node -e "console.log(require('@tiptap/suggestion/package.json').version)"`
Expected: a `3.x` version printed (e.g. `3.22.5`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(notepad): add @tiptap/suggestion for verse completion"
```

---

## Task 2: FTS migration on `bible_passages`

**Files:**
- Create: `supabase/migrations/030_bible_passages_fts.sql`

- [ ] **Step 1: Confirm 030 is the next free migration number**

Run: `ls supabase/migrations/ | sort | tail -3`
Expected: highest is `029_onboarding_progress.sql` (so `030_` is free). If a higher number exists, use the next free number and adjust the filename below.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/030_bible_passages_fts.sql`:

```sql
-- Full-text search over BSB verse text for the /verse keyword picker.
-- Stored generated column so the GIN index is on materialized tsvector data.
-- Language 'english' (BSB is English-only in v1). Public-read RLS already
-- present on bible_passages (009); FTS adds no new policy.

alter table public.bible_passages
  add column if not exists text_tsv tsvector
  generated always as (to_tsvector('english', text)) stored;

create index if not exists bible_passages_text_tsv
  on public.bible_passages using gin (text_tsv);
```

- [ ] **Step 3: Lint the SQL by eye against the existing 009 style**

Run: `sed -n '1,22p' supabase/migrations/009_bible_passages.sql`
Expected: confirms `bible_passages` table/column names match the migration above (`text` column exists, table is `public.bible_passages`).

- [ ] **Step 4: Commit (DB apply is manual — note it in the message)**

```bash
git add supabase/migrations/030_bible_passages_fts.sql
git commit -m "feat(db): add FTS tsvector column + GIN index to bible_passages

Apply manually: supabase migration is not in CI."
```

> **Manual deploy note (do NOT skip at ship time):** This migration must be applied manually to Supabase before the `/verse` keyword picker returns FTS results in any deployed environment.

---

## Task 3: `verse-search` edge function (semantic seam)

**Files:**
- Create: `supabase/functions/verse-search/index.ts`
- Create: `supabase/functions/verse-search/deno.json`

- [ ] **Step 1: Inspect the reusable shared helpers**

Run: `sed -n '1,45p' supabase/functions/_shared/voyage.ts && echo '---CORS---' && grep -n 'export' supabase/functions/_shared/cors.ts && echo '---SUPA---' && grep -n 'export' supabase/functions/_shared/supabase.ts`
Expected: confirms `embedQuery(text, deps)` exported from `voyage.ts`, `resolveAllowedOrigins`/`corsHeaders` from `cors.ts`, and a `serviceClient()` from `supabase.ts`.

- [ ] **Step 2: Copy the deno config from an existing function**

Run: `cat supabase/functions/lamplight-chat/deno.json`
Then create `supabase/functions/verse-search/deno.json` with the same contents (import map / compiler options as that file shows).

- [ ] **Step 3: Write the edge function**

Create `supabase/functions/verse-search/index.ts`:

```ts
// supabase/functions/verse-search/index.ts
//
// Thin semantic-search seam for the /verse picker. Embeds an arbitrary query
// (Voyage, server-side key) and returns bible_passage matches from the
// match_bible_embeddings pgvector RPC. No persistence, no LLM.
//
// Trust model: deployed WITH JWT verification (platform default; do NOT pass
// --no-verify-jwt). Only authenticated callers reach Voyage, which protects the
// embedding budget. Anonymous users fall back to FTS + reference in the client.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { embedQuery } from '../_shared/voyage.ts';
import { resolveAllowedOrigins, corsHeaders } from '../_shared/cors.ts';

const DEFAULT_LIMIT = 30;

serve(async (req) => {
  const cors = corsHeaders(req, resolveAllowedOrigins(Deno.env));
  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

  const apiKey = Deno.env.get('VOYAGE_AI_KEY');
  if (!apiKey) return jsonResp({ error: 'VOYAGE_AI_KEY missing' }, 500);

  let body: { query?: string; limit?: number };
  try { body = await req.json(); } catch { return jsonResp({ error: 'bad json' }, 400); }

  const query = (body.query ?? '').trim();
  if (!query) return jsonResp({ matches: [] });
  const limit = Math.min(Math.max(body.limit ?? DEFAULT_LIMIT, 1), 50);

  try {
    const vector = await embedQuery(query, { apiKey, fetch });
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc('match_bible_embeddings', {
      p_query_vector: vector,
      p_limit: limit,
    });
    if (error) return jsonResp({ error: error.message }, 500);

    const matches = ((data ?? []) as Array<{ source_id: string; chunk_text: string; similarity: number }>)
      .map((r) => ({ sourceId: r.source_id, text: r.chunk_text, similarity: r.similarity }));
    return jsonResp({ matches });
  } catch (err) {
    return jsonResp({ error: String(err) }, 500);
  }
});
```

- [ ] **Step 4: Type-check the function body in isolation (best-effort)**

Run: `deno check supabase/functions/verse-search/index.ts 2>&1 | head -20 || echo "deno not installed — skip (CI/edge runtime checks on deploy)"`
Expected: no type errors, or a clean skip if `deno` is absent locally (the repo deploys functions manually).

- [ ] **Step 5: Commit (deploy is manual — note it)**

```bash
git add supabase/functions/verse-search/index.ts supabase/functions/verse-search/deno.json
git commit -m "feat(edge): add verse-search function (embed query -> match_bible_embeddings)

Deploy manually: supabase functions deploy verse-search --use-api"
```

> **Manual deploy note:** Deploy with `supabase functions deploy verse-search --use-api` (JWT verification ON — do not pass `--no-verify-jwt`). Requires `VOYAGE_AI_KEY` set in the function secrets (already set for `embed-note`/`lamplight-*`).

---

## Task 4: `verse-search` types + query routing + row normalization

**Files:**
- Create: `src/notepad/bible/verse-search-types.ts`
- Create: `src/notepad/bible/verse-search.ts`
- Test: `src/notepad/bible/verse-search.test.ts`

- [ ] **Step 1: Write the shared types**

Create `src/notepad/bible/verse-search-types.ts`:

```ts
// Shared types for the framework-free verse-search module and its client deps.

export type VerseCandidate = {
  osis: string;            // bible_passages id key, e.g. "jhn.3.16" (range -> start verse id)
  book: string;            // canonical name, e.g. "John"
  chapter: number;
  verseStart: number;
  verseEnd: number | null; // null = single verse; set = range (pericope-resolved)
  text: string;
  translation: 'BSB';
  source: 'reference' | 'fts' | 'semantic';
  score: number;           // [0,1]
  label?: string;          // distinct display label for resolved passages, e.g. "John 3:1–21 · passage"
};

export type RawFtsRow = {
  id: string;              // "jhn.3.16"
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  text: string;
};

export type RawSemanticRow = {
  sourceId: string;        // "jhn.3.16" (verse) or "jhn.3" (pericope)
  text: string;
  similarity: number;      // 0..1
};

export type PericopeRange = {
  book: string;            // canonical name, e.g. "John"
  chapter: number;
  verseStart: number;      // min over the pericope
  verseEnd: number;        // max over the pericope
  text: string;            // joined pericope text (best-effort)
};

export interface VerseSearchDeps {
  ftsSearch: (query: string, opts: { signal?: AbortSignal }) => Promise<RawFtsRow[]>;
  semanticSearch: (query: string, opts: { signal?: AbortSignal }) => Promise<RawSemanticRow[]>;
  resolvePericope: (pericopeId: string, opts: { signal?: AbortSignal }) => Promise<PericopeRange | null>;
  fetchVerseText: (
    ref: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ text: string; translation: string; reference: string } | null>;
}
```

- [ ] **Step 2: Write the failing tests for routing + grain + normalization**

Create `src/notepad/bible/verse-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { routeQuery, detectGrain, normalizeFtsRow, osisForRef } from './verse-search';
import type { RawFtsRow } from './verse-search-types';

describe('routeQuery', () => {
  it('routes a parseable reference to kind=reference with parsed fields', () => {
    const r = routeQuery('John 3:16');
    expect(r.kind).toBe('reference');
    if (r.kind === 'reference') {
      expect(r.parsed.book).toBe('John');
      expect(r.parsed.chapter).toBe(3);
      expect(r.parsed.verseStart).toBe(16);
    }
  });

  it('routes free text to kind=keyword', () => {
    expect(routeQuery('love your enemies').kind).toBe('keyword');
  });
});

describe('detectGrain', () => {
  it('treats a 3-segment source id as a verse', () => {
    expect(detectGrain('jhn.3.16')).toBe('verse');
  });
  it('treats a 2-segment source id as a pericope', () => {
    expect(detectGrain('jhn.3')).toBe('pericope');
  });
});

describe('osisForRef', () => {
  it('builds the bible_passages key from a parsed ref', () => {
    expect(osisForRef('John', 3, 16)).toBe('jhn.3.16');
  });
});

describe('normalizeFtsRow', () => {
  it('maps a raw FTS row to a candidate with flat fts score', () => {
    const row: RawFtsRow = {
      id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      text: 'For God so loved the world...',
    };
    const c = normalizeFtsRow(row);
    expect(c.source).toBe('fts');
    expect(c.score).toBeCloseTo(0.55);
    expect(c.osis).toBe('jhn.3.16');
    expect(c.translation).toBe('BSB');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: FAIL — `verse-search.ts` does not export these yet.

- [ ] **Step 4: Implement routing + grain + normalization**

Create `src/notepad/bible/verse-search.ts`:

```ts
import { parseVerseRef, BOOK_TO_OSIS } from '../graph/reference-parser';
import type { RawFtsRow, VerseCandidate } from './verse-search-types';

const FTS_SCORE = 0.55;

// Inverse of BOOK_TO_OSIS for resolving "jhn" -> "John".
const OSIS_TO_BOOK: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_TO_OSIS).map(([book, osis]) => [osis, book]),
);

export function osisForRef(book: string, chapter: number, verse: number): string {
  const osisBook = BOOK_TO_OSIS[book];
  return `${osisBook}.${chapter}.${verse}`;
}

export function osisBookToCanonical(osisBook: string): string | null {
  return OSIS_TO_BOOK[osisBook] ?? null;
}

export type Route =
  | { kind: 'reference'; parsed: NonNullable<ReturnType<typeof parseVerseRef>> }
  | { kind: 'keyword' };

export function routeQuery(query: string): Route {
  const parsed = parseVerseRef(query);
  if (parsed) return { kind: 'reference', parsed };
  return { kind: 'keyword' };
}

export function detectGrain(sourceId: string): 'verse' | 'pericope' {
  return sourceId.split('.').length >= 3 ? 'verse' : 'pericope';
}

export function normalizeFtsRow(row: RawFtsRow): VerseCandidate {
  return {
    osis: row.id,
    book: row.book,
    chapter: row.chapter,
    verseStart: row.verseStart,
    verseEnd: row.verseEnd,
    text: row.text,
    translation: 'BSB',
    source: 'fts',
    score: FTS_SCORE,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: PASS (4 describe blocks green).

- [ ] **Step 6: Commit**

```bash
git add src/notepad/bible/verse-search-types.ts src/notepad/bible/verse-search.ts src/notepad/bible/verse-search.test.ts
git commit -m "feat(verse-search): query routing, grain detection, FTS normalization"
```

---

## Task 5: Semantic normalization + pericope resolution

**Files:**
- Modify: `src/notepad/bible/verse-search.ts`
- Test: `src/notepad/bible/verse-search.test.ts`

- [ ] **Step 1: Add failing tests for semantic normalization (verse + pericope)**

Append to `src/notepad/bible/verse-search.test.ts`:

```ts
import { normalizeSemanticRow } from './verse-search';
import type { RawSemanticRow, PericopeRange } from './verse-search-types';

describe('normalizeSemanticRow', () => {
  const noResolve = async () => null;

  it('maps a verse-grain row to a single-verse candidate (score = similarity)', async () => {
    const row: RawSemanticRow = { sourceId: 'jhn.3.16', text: 'For God so loved...', similarity: 0.82 };
    const c = await normalizeSemanticRow(row, { resolvePericope: noResolve, signal: undefined });
    expect(c).not.toBeNull();
    expect(c!.source).toBe('semantic');
    expect(c!.osis).toBe('jhn.3.16');
    expect(c!.book).toBe('John');
    expect(c!.chapter).toBe(3);
    expect(c!.verseStart).toBe(16);
    expect(c!.verseEnd).toBeNull();
    expect(c!.score).toBeCloseTo(0.82);
  });

  it('resolves a pericope-grain row to a ranged candidate with a distinct label', async () => {
    const range: PericopeRange = { book: 'John', chapter: 3, verseStart: 1, verseEnd: 21, text: 'pericope text' };
    const resolvePericope = async (id: string) => (id === 'jhn.3' ? range : null);
    const row: RawSemanticRow = { sourceId: 'jhn.3', text: 'ignored — replaced by pericope text', similarity: 0.7 };
    const c = await normalizeSemanticRow(row, { resolvePericope, signal: undefined });
    expect(c).not.toBeNull();
    expect(c!.osis).toBe('jhn.3.1');
    expect(c!.verseStart).toBe(1);
    expect(c!.verseEnd).toBe(21);
    expect(c!.label).toBe('John 3:1–21 · passage');
    expect(c!.score).toBeCloseTo(0.7);
  });

  it('drops a pericope row that cannot be resolved', async () => {
    const row: RawSemanticRow = { sourceId: 'jhn.3', text: 'x', similarity: 0.7 };
    const c = await normalizeSemanticRow(row, { resolvePericope: noResolve, signal: undefined });
    expect(c).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: FAIL — `normalizeSemanticRow` not exported.

- [ ] **Step 3: Implement semantic normalization + pericope resolution**

Append to `src/notepad/bible/verse-search.ts`:

```ts
import type { RawSemanticRow, PericopeRange } from './verse-search-types';

// Parse a verse-grain source id like "jhn.3.16" -> { osisBook, chapter, verse }.
function parseVerseSourceId(sourceId: string): { osisBook: string; chapter: number; verse: number } | null {
  const parts = sourceId.split('.');
  if (parts.length < 3) return null;
  const chapter = Number(parts[1]);
  const verse = Number(parts[2]);
  if (!Number.isFinite(chapter) || !Number.isFinite(verse)) return null;
  return { osisBook: parts[0], chapter, verse };
}

export async function normalizeSemanticRow(
  row: RawSemanticRow,
  opts: {
    resolvePericope: (id: string, o: { signal?: AbortSignal }) => Promise<PericopeRange | null>;
    signal?: AbortSignal;
  },
): Promise<VerseCandidate | null> {
  if (detectGrain(row.sourceId) === 'verse') {
    const parsed = parseVerseSourceId(row.sourceId);
    if (!parsed) return null;
    const book = osisBookToCanonical(parsed.osisBook);
    if (!book) return null;
    return {
      osis: row.sourceId,
      book,
      chapter: parsed.chapter,
      verseStart: parsed.verse,
      verseEnd: null,
      text: row.text,
      translation: 'BSB',
      source: 'semantic',
      score: row.similarity,
    };
  }

  // Pericope grain: resolve to a ranged candidate.
  const range = await opts.resolvePericope(row.sourceId, { signal: opts.signal });
  if (!range) return null;
  return {
    osis: osisForRef(range.book, range.chapter, range.verseStart),
    book: range.book,
    chapter: range.chapter,
    verseStart: range.verseStart,
    verseEnd: range.verseEnd,
    text: range.text || row.text,
    translation: 'BSB',
    source: 'semantic',
    score: row.similarity,
    label: `${range.book} ${range.chapter}:${range.verseStart}–${range.verseEnd} · passage`,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: PASS (semantic describe block green; earlier blocks still green).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/verse-search.ts src/notepad/bible/verse-search.test.ts
git commit -m "feat(verse-search): semantic normalization + pericope resolution"
```

---

## Task 6: Reference candidate + merge/dedupe/ranking

**Files:**
- Modify: `src/notepad/bible/verse-search.ts`
- Test: `src/notepad/bible/verse-search.test.ts`

- [ ] **Step 1: Add failing tests for referenceCandidate + mergeCandidates**

Append to `src/notepad/bible/verse-search.test.ts`:

```ts
import { referenceCandidate, mergeCandidates } from './verse-search';

describe('referenceCandidate', () => {
  it('builds a pinned reference candidate (score 1.0) from a parsed ref', () => {
    const c = referenceCandidate({ book: 'John', chapter: 3, verseStart: 16, verseEnd: null }, 'For God...');
    expect(c.source).toBe('reference');
    expect(c.score).toBe(1);
    expect(c.osis).toBe('jhn.3.16');
    expect(c.text).toBe('For God...');
  });
});

describe('mergeCandidates', () => {
  it('dedupes by osis, boosting corroborated verses and keeping non-empty text', () => {
    const fts = normalizeFtsRow({ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts text' });
    const sem: VerseCandidate = {
      osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      text: '', translation: 'BSB', source: 'semantic', score: 0.6,
    };
    const merged = mergeCandidates(null, [fts], [sem]);
    expect(merged).toHaveLength(1);
    // max(0.55, 0.6) + 0.15 = 0.75
    expect(merged[0].score).toBeCloseTo(0.75);
    // semantic > fts for source label
    expect(merged[0].source).toBe('semantic');
    // non-empty text preserved from fts
    expect(merged[0].text).toBe('fts text');
  });

  it('pins the reference candidate first regardless of score', () => {
    const ref = referenceCandidate({ book: 'Psalms', chapter: 23, verseStart: 1, verseEnd: null }, 'The LORD is my shepherd');
    const sem: VerseCandidate = {
      osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      text: 't', translation: 'BSB', source: 'semantic', score: 0.99,
    };
    const merged = mergeCandidates(ref, [], [sem]);
    expect(merged[0].osis).toBe('psa.23.1');
    expect(merged[1].osis).toBe('jhn.3.16');
  });

  it('orders non-reference candidates by score desc (stable)', () => {
    const a: VerseCandidate = { osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, text: 'a', translation: 'BSB', source: 'semantic', score: 0.9 };
    const b: VerseCandidate = { osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'b', translation: 'BSB', source: 'semantic', score: 0.4 };
    const merged = mergeCandidates(null, [], [b, a]);
    expect(merged.map((c) => c.osis)).toEqual(['rom.8.28', 'jhn.3.16']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: FAIL — `referenceCandidate` / `mergeCandidates` not exported.

- [ ] **Step 3: Implement referenceCandidate + mergeCandidates**

Append to `src/notepad/bible/verse-search.ts`:

```ts
const CORROBORATION_BOOST = 0.15;
const SOURCE_PRIORITY: Record<VerseCandidate['source'], number> = { reference: 3, semantic: 2, fts: 1 };

export function referenceCandidate(
  parsed: { book: string; chapter: number; verseStart: number; verseEnd: number | null },
  text: string,
): VerseCandidate {
  return {
    osis: osisForRef(parsed.book, parsed.chapter, parsed.verseStart),
    book: parsed.book,
    chapter: parsed.chapter,
    verseStart: parsed.verseStart,
    verseEnd: parsed.verseEnd,
    text,
    translation: 'BSB',
    source: 'reference',
    score: 1,
  };
}

export function mergeCandidates(
  reference: VerseCandidate | null,
  fts: VerseCandidate[],
  semantic: VerseCandidate[],
): VerseCandidate[] {
  const byOsis = new Map<string, VerseCandidate[]>();
  const all = [...(reference ? [reference] : []), ...semantic, ...fts];
  for (const c of all) {
    const group = byOsis.get(c.osis);
    if (group) group.push(c);
    else byOsis.set(c.osis, [c]);
  }

  const merged: VerseCandidate[] = [];
  for (const group of byOsis.values()) {
    if (group.length === 1) { merged.push(group[0]); continue; }
    const best = group.reduce((a, b) => (SOURCE_PRIORITY[b.source] > SOURCE_PRIORITY[a.source] ? b : a));
    const maxScore = Math.max(...group.map((g) => g.score));
    const text = group.find((g) => g.text.trim().length > 0)?.text ?? best.text;
    const label = group.find((g) => g.label)?.label;
    merged.push({
      ...best,
      text,
      label,
      score: best.source === 'reference' ? 1 : Math.min(1, maxScore + CORROBORATION_BOOST * (group.length - 1)),
    });
  }

  // Reference pinned first (in insertion order); rest by score desc, stable.
  const refs = merged.filter((c) => c.source === 'reference');
  const rest = merged.filter((c) => c.source !== 'reference')
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (y.c.score - x.c.score) || (x.i - y.i))
    .map((x) => x.c);
  return [...refs, ...rest];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: PASS (merge/dedupe/ranking green).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/verse-search.ts src/notepad/bible/verse-search.test.ts
git commit -m "feat(verse-search): reference candidate + merge/dedupe/ranking heuristic"
```

---

## Task 7: `completeReference` (B path) + `createVerseSearch` (debounce + abort, C path)

**Files:**
- Modify: `src/notepad/bible/verse-search.ts`
- Test: `src/notepad/bible/verse-search.test.ts`

- [ ] **Step 1: Add failing tests for completeReference and the debounced searcher**

Append to `src/notepad/bible/verse-search.test.ts`:

```ts
import { describe as describe2, it as it2, expect as expect2, vi, beforeEach, afterEach } from 'vitest';
import { completeReference, createVerseSearch } from './verse-search';
import type { VerseSearchDeps } from './verse-search-types';

function makeDeps(over: Partial<VerseSearchDeps> = {}): VerseSearchDeps {
  return {
    ftsSearch: vi.fn(async () => []),
    semanticSearch: vi.fn(async () => []),
    resolvePericope: vi.fn(async () => null),
    fetchVerseText: vi.fn(async () => ({ text: 'verse text', translation: 'BSB', reference: 'John 3:16' })),
    ...over,
  };
}

describe('completeReference', () => {
  it('returns a single reference candidate once the ref resolves', async () => {
    const deps = makeDeps();
    const c = await completeReference('John 3:16', deps, {});
    expect(c).not.toBeNull();
    expect(c!.source).toBe('reference');
    expect(c!.osis).toBe('jhn.3.16');
    expect(c!.text).toBe('verse text');
    expect(deps.fetchVerseText).toHaveBeenCalledOnce();
  });

  it('returns null for an incomplete reference', async () => {
    const deps = makeDeps();
    expect(await completeReference('John', deps, {})).toBeNull();
  });

  it('still returns a candidate (empty text) when fetch fails/offline', async () => {
    const deps = makeDeps({ fetchVerseText: vi.fn(async () => null) });
    const c = await completeReference('John 3:16', deps, {});
    expect(c).not.toBeNull();
    expect(c!.text).toBe('');
  });
});

describe('createVerseSearch debounce + abort', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs FTS immediately and semantic only after the trailing debounce (>=3 chars)', async () => {
    const ftsSearch = vi.fn(async () => [
      { id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts' },
    ]);
    const semanticSearch = vi.fn(async () => []);
    const deps = makeDeps({ ftsSearch, semanticSearch });
    const search = createVerseSearch(deps, { debounceMs: 250 });
    const emit = vi.fn();

    search.query('love', emit);
    await vi.advanceTimersByTimeAsync(0);
    expect(ftsSearch).toHaveBeenCalledOnce();         // instant
    expect(semanticSearch).not.toHaveBeenCalled();    // not yet
    expect(emit).toHaveBeenCalledWith(expect.any(Array), 'instant');

    await vi.advanceTimersByTimeAsync(250);
    expect(semanticSearch).toHaveBeenCalledOnce();     // trailing
    expect(emit).toHaveBeenCalledWith(expect.any(Array), 'complete');
  });

  it('does not run semantic for queries shorter than 3 chars', async () => {
    const semanticSearch = vi.fn(async () => []);
    const deps = makeDeps({ semanticSearch });
    const search = createVerseSearch(deps, { debounceMs: 250 });
    search.query('lo', vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    expect(semanticSearch).not.toHaveBeenCalled();
  });

  it('aborts the previous in-flight query when a new one starts', async () => {
    const deps = makeDeps();
    const search = createVerseSearch(deps, { debounceMs: 250 });
    search.query('first', vi.fn());
    const cancel = search.query('second', vi.fn());
    // The signal passed to the first ftsSearch call should be aborted.
    const firstSignal = (deps.ftsSearch as ReturnType<typeof vi.fn>).mock.calls[0][1].signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    cancel();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: FAIL — `completeReference` / `createVerseSearch` not exported.

- [ ] **Step 3: Implement completeReference + createVerseSearch**

Append to `src/notepad/bible/verse-search.ts`:

```ts
import type { VerseSearchDeps } from './verse-search-types';

const MIN_SEMANTIC_CHARS = 3;

export async function completeReference(
  partial: string,
  deps: VerseSearchDeps,
  opts: { signal?: AbortSignal },
): Promise<VerseCandidate | null> {
  const route = routeQuery(partial);
  if (route.kind !== 'reference') return null;
  const ref = `${route.parsed.book} ${route.parsed.chapter}:${route.parsed.verseStart}${route.parsed.verseEnd ? `-${route.parsed.verseEnd}` : ''}`;
  let text = '';
  try {
    const result = await deps.fetchVerseText(ref, { signal: opts.signal });
    if (result) text = result.text;
  } catch {
    // offline / abort — candidate still inserts with empty text (lazy-fill later)
  }
  return referenceCandidate(route.parsed, text);
}

export type EmitPhase = 'instant' | 'complete';

export function createVerseSearch(deps: VerseSearchDeps, opts: { debounceMs?: number } = {}) {
  const debounceMs = opts.debounceMs ?? 250;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (controller) { controller.abort(); controller = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function query(text: string, emit: (results: VerseCandidate[], phase: EmitPhase) => void): () => void {
    cancel();
    const ctrl = new AbortController();
    controller = ctrl;
    const signal = ctrl.signal;
    const trimmed = text.trim();
    const route = routeQuery(trimmed);

    // Reference pin (local parse; text fetched lazily by the node, not here).
    const pin = route.kind === 'reference' ? referenceCandidate(route.parsed, '') : null;

    // FTS — instant.
    (async () => {
      let ftsCands: VerseCandidate[] = [];
      try {
        const rows = await deps.ftsSearch(trimmed, { signal });
        ftsCands = rows.map(normalizeFtsRow);
      } catch { /* FTS error -> empty, picker stays usable */ }
      if (signal.aborted) return;
      emit(mergeCandidates(pin, ftsCands, []), 'instant');

      // Semantic — trailing debounce, only >= MIN_SEMANTIC_CHARS.
      if (trimmed.length < MIN_SEMANTIC_CHARS) return;
      timer = setTimeout(async () => {
        let semCands: VerseCandidate[] = [];
        try {
          const rows = await deps.semanticSearch(trimmed, { signal });
          const resolved = await Promise.all(
            rows.map((r) => normalizeSemanticRow(r, { resolvePericope: deps.resolvePericope, signal })),
          );
          semCands = resolved.filter((c): c is VerseCandidate => c !== null);
        } catch { /* semantic error/timeout -> degrade to FTS+reference */ }
        if (signal.aborted) return;
        emit(mergeCandidates(pin, ftsCands, semCands), 'complete');
      }, debounceMs);
    })();

    return cancel;
  }

  return { query, cancel };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/bible/verse-search.test.ts`
Expected: PASS (all describe blocks across Tasks 4–7 green).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/verse-search.ts src/notepad/bible/verse-search.test.ts
git commit -m "feat(verse-search): completeReference + debounced/abortable searcher"
```

---

## Task 8: `verse-search-client` (production deps)

**Files:**
- Create: `src/notepad/bible/verse-search-client.ts`
- Test: `src/notepad/bible/verse-search-client.test.ts`

- [ ] **Step 1: Write failing tests against a mocked supabase**

Create `src/notepad/bible/verse-search-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createBrowserVerseSearchDeps } from './verse-search-client';

function makeSupabaseStub(over: Record<string, unknown> = {}) {
  return {
    from: vi.fn(),
    functions: { invoke: vi.fn(async () => ({ data: { matches: [] }, error: null })) },
    ...over,
  };
}

describe('createBrowserVerseSearchDeps.ftsSearch', () => {
  it('queries text_tsv with websearch, BSB filter, and maps rows', async () => {
    const order = vi.fn(async () => ({
      data: [{ id: 'jhn.3.16', book: 'John', chapter: 3, verse_start: 16, verse_end: null, text: 'For God...' }],
      error: null,
    }));
    const limit = vi.fn(() => ({ order }));
    const textSearch = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ textSearch }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ from }) as never);

    const rows = await deps.ftsSearch('love', {});
    expect(from).toHaveBeenCalledWith('bible_passages');
    expect(eq).toHaveBeenCalledWith('translation', 'BSB');
    expect(textSearch).toHaveBeenCalledWith('text_tsv', 'love', { type: 'websearch' });
    expect(rows[0]).toMatchObject({ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null });
  });
});

describe('createBrowserVerseSearchDeps.semanticSearch', () => {
  it('invokes the verse-search edge fn and maps matches', async () => {
    const invoke = vi.fn(async () => ({
      data: { matches: [{ sourceId: 'jhn.3.16', text: 'x', similarity: 0.8 }] }, error: null,
    }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ functions: { invoke } }) as never);
    const rows = await deps.semanticSearch('love', {});
    expect(invoke).toHaveBeenCalledWith('verse-search', { body: { query: 'love' } });
    expect(rows[0]).toMatchObject({ sourceId: 'jhn.3.16', similarity: 0.8 });
  });

  it('returns [] when the edge fn errors (graceful degrade)', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: 'boom' } }));
    const deps = createBrowserVerseSearchDeps(makeSupabaseStub({ functions: { invoke } }) as never);
    expect(await deps.semanticSearch('love', {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/bible/verse-search-client.test.ts`
Expected: FAIL — `verse-search-client.ts` does not exist.

- [ ] **Step 3: Implement the production deps**

Create `src/notepad/bible/verse-search-client.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabase';
import { fetchVerseText } from '../graph/reference-parser';
import { osisBookToCanonical } from './verse-search';
import type { RawFtsRow, RawSemanticRow, PericopeRange, VerseSearchDeps } from './verse-search-types';

const FTS_LIMIT = 20;

export function createBrowserVerseSearchDeps(
  client: SupabaseClient | null = defaultSupabase,
): VerseSearchDeps {
  return {
    async ftsSearch(query, opts): Promise<RawFtsRow[]> {
      if (!client || !query.trim()) return [];
      let q = client
        .from('bible_passages')
        .select('id, book, chapter, verse_start, verse_end, text')
        .eq('translation', 'BSB')
        .textSearch('text_tsv', query, { type: 'websearch' })
        .limit(FTS_LIMIT)
        .order('id', { ascending: true });
      if (opts.signal) q = (q as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(opts.signal);
      const { data, error } = await q;
      if (error || !data) return [];
      return (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        book: r.book as string,
        chapter: r.chapter as number,
        verseStart: r.verse_start as number,
        verseEnd: (r.verse_end ?? null) as number | null,
        text: (r.text as string) ?? '',
      }));
    },

    async semanticSearch(query, _opts): Promise<RawSemanticRow[]> {
      if (!client || !query.trim()) return [];
      try {
        const { data, error } = await client.functions.invoke('verse-search', { body: { query } });
        if (error || !data) return [];
        const matches = (data as { matches?: RawSemanticRow[] }).matches ?? [];
        return matches.map((m) => ({ sourceId: m.sourceId, text: m.text, similarity: m.similarity }));
      } catch {
        return [];
      }
    },

    async resolvePericope(pericopeId, opts): Promise<PericopeRange | null> {
      if (!client) return null;
      const osisBook = pericopeId.split('.')[0];
      const book = osisBookToCanonical(osisBook);
      if (!book) return null;
      let q = client
        .from('bible_passages')
        .select('chapter, verse_start, verse_end, text')
        .eq('pericope_id', pericopeId)
        .eq('translation', 'BSB')
        .order('verse_start', { ascending: true });
      if (opts.signal) q = (q as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(opts.signal);
      const { data, error } = await q;
      if (error || !data || data.length === 0) return null;
      const rows = data as Array<{ chapter: number; verse_start: number; verse_end: number | null; text: string }>;
      const verseStart = Math.min(...rows.map((r) => r.verse_start));
      const verseEnd = Math.max(...rows.map((r) => r.verse_end ?? r.verse_start));
      const text = rows.map((r) => r.text ?? '').join(' ').trim();
      return { book, chapter: rows[0].chapter, verseStart, verseEnd, text };
    },

    fetchVerseText,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/bible/verse-search-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/bible/verse-search-client.ts src/notepad/bible/verse-search-client.test.ts
git commit -m "feat(verse-search): browser data-access deps (FTS, semantic edge fn, pericope)"
```

---

## Task 9: B-path matcher (`findReferenceSuggestionMatch`)

**Files:**
- Create: `src/notepad/extensions/scripture-ref-matchers.ts`
- Test: `src/notepad/extensions/scripture-ref-matchers.test.ts`

- [ ] **Step 1: Write failing tests for the matcher**

Create `src/notepad/extensions/scripture-ref-matchers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchReferenceBeforeCursor } from './scripture-ref-matchers';

describe('matchReferenceBeforeCursor', () => {
  it('matches a full reference at the end of text', () => {
    const m = matchReferenceBeforeCursor('I was reading John 3:16');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('John 3:16');
  });

  it('matches a book + chapter once a colon/verse digit appears', () => {
    const m = matchReferenceBeforeCursor('see Romans 8:2');
    expect(m).not.toBeNull();
    expect(m!.query).toBe('Romans 8:2');
  });

  it('does NOT fire on a book word with no chapter digits', () => {
    expect(matchReferenceBeforeCursor('I read a book about John')).toBeNull();
  });

  it('does NOT fire mid-word (book name embedded in another word)', () => {
    expect(matchReferenceBeforeCursor('mark Marksman 3:1'.slice(0, 8))).toBeNull();
  });

  it('reports the start index so the suggestion range is correct', () => {
    const text = 'abc John 3:16';
    const m = matchReferenceBeforeCursor(text);
    expect(m!.from).toBe(4);
    expect(m!.to).toBe(text.length);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/extensions/scripture-ref-matchers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the matcher**

Create `src/notepad/extensions/scripture-ref-matchers.ts`:

```ts
import { BOOK_PATTERNS } from '../graph/reference-parser';

// Word-boundary book name, a chapter number, a colon, and at least one verse
// digit — anchored to the END of the supplied text (text-before-cursor).
// Requiring the colon + verse digit is what keeps "I read a book" from firing.
const bookGroup = `(?:${BOOK_PATTERNS.join('|')})`;
const REF_AT_END = new RegExp(`(?:^|\\s)(${bookGroup}\\s+\\d{1,3}:\\d{1,3}(?:\\s*[-–]\\s*\\d{1,3})?)$`, 'i');

export type SuggestionTextMatch = { from: number; to: number; query: string };

/**
 * Returns the verse-reference match anchored at the end of `textBeforeCursor`,
 * with absolute-ish offsets relative to the supplied string, or null. The Node
 * adapts these offsets into ProseMirror doc positions in findSuggestionMatch.
 */
export function matchReferenceBeforeCursor(textBeforeCursor: string): SuggestionTextMatch | null {
  const m = REF_AT_END.exec(textBeforeCursor);
  if (!m) return null;
  const query = m[1];
  const to = textBeforeCursor.length;
  const from = to - query.length;
  return { from, to, query };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/extensions/scripture-ref-matchers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/scripture-ref-matchers.ts src/notepad/extensions/scripture-ref-matchers.test.ts
git commit -m "feat(scripture-ref): B-path word-boundary reference matcher"
```

---

## Task 10: `scriptureRef` node — attrs, serialization, insert command

**Files:**
- Create: `src/notepad/extensions/scripture-ref.ts`
- Test: `src/notepad/extensions/scripture-ref.editor.test.ts`

- [ ] **Step 1: Write failing headless-editor tests**

Create `src/notepad/extensions/scripture-ref.editor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScriptureRef } from './scripture-ref';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function makeEditor(content = '<p></p>') {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ScriptureRef.configure({ search: null })],
    content,
  });
}

const ATTRS = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  translation: 'BSB' as const, text: 'For God so loved the world',
};

describe('insertScriptureRef', () => {
  it('inserts a scriptureRef node with the given attrs', () => {
    editor = makeEditor();
    editor.commands.insertScriptureRef(ATTRS);
    const json = editor.getJSON();
    const node = findNode(json, 'scriptureRef');
    expect(node).toBeTruthy();
    expect(node!.attrs).toMatchObject(ATTRS);
  });
});

describe('serialization round-trip', () => {
  it('parses its own rendered HTML back into a node with all attrs', () => {
    editor = makeEditor();
    editor.commands.insertScriptureRef(ATTRS);
    const html = editor.getHTML();
    const second = makeEditor(html);
    const node = findNode(second.getJSON(), 'scriptureRef');
    second.destroy();
    expect(node!.attrs).toMatchObject({ osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16 });
  });

  it('rejects malformed input (missing data-osis) -> no scriptureRef node', () => {
    editor = makeEditor('<p><span data-scripture-ref data-book="John">John 3:16</span></p>');
    expect(findNode(editor.getJSON(), 'scriptureRef')).toBeNull();
  });
});

// Helper: depth-first search for the first node of a type.
function findNode(json: unknown, type: string): { type: string; attrs: Record<string, unknown> } | null {
  if (!json || typeof json !== 'object') return null;
  const n = json as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === type) return { type, attrs: n.attrs ?? {} };
  for (const child of n.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/extensions/scripture-ref.editor.test.ts`
Expected: FAIL — `scripture-ref.ts` does not exist.

- [ ] **Step 3: Implement the node (attrs + serialization + command; NodeView/suggestion added in later tasks)**

Create `src/notepad/extensions/scripture-ref.ts`:

```ts
import { Node, mergeAttributes } from '@tiptap/core';
import type { VerseSearchDeps } from '../bible/verse-search-types';

export interface ScriptureRefOptions {
  // null in tests / when search is unavailable; set in production wiring (Task 14).
  search: VerseSearchDeps | null;
}

export interface ScriptureRefAttrs {
  osis: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  translation: 'BSB';
  text: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    scriptureRef: {
      insertScriptureRef: (attrs: ScriptureRefAttrs) => ReturnType;
    };
  }
}

function num(value: string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const ScriptureRef = Node.create<ScriptureRefOptions>({
  name: 'scriptureRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { search: null };
  },

  addAttributes() {
    return {
      osis: { default: null, parseHTML: (el) => el.getAttribute('data-osis'), renderHTML: (a) => ({ 'data-osis': a.osis }) },
      book: { default: null, parseHTML: (el) => el.getAttribute('data-book'), renderHTML: (a) => ({ 'data-book': a.book }) },
      chapter: { default: null, parseHTML: (el) => num(el.getAttribute('data-chapter')), renderHTML: (a) => ({ 'data-chapter': String(a.chapter) }) },
      verseStart: { default: null, parseHTML: (el) => num(el.getAttribute('data-verse-start')), renderHTML: (a) => ({ 'data-verse-start': String(a.verseStart) }) },
      verseEnd: { default: null, parseHTML: (el) => num(el.getAttribute('data-verse-end')), renderHTML: (a) => (a.verseEnd == null ? {} : { 'data-verse-end': String(a.verseEnd) }) },
      translation: { default: 'BSB', parseHTML: (el) => el.getAttribute('data-translation') ?? 'BSB', renderHTML: (a) => ({ 'data-translation': a.translation }) },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-text') ?? '', renderHTML: (a) => ({ 'data-text': a.text }) },
    };
  },

  parseHTML() {
    return [{
      tag: 'span[data-scripture-ref]',
      // Reject malformed input: a node without a valid data-osis is not ours.
      getAttrs: (el) => (el instanceof HTMLElement && el.getAttribute('data-osis') ? null : false),
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as ScriptureRefAttrs;
    const range = a.verseEnd ? `${a.verseStart}–${a.verseEnd}` : `${a.verseStart}`;
    const label = `${a.book} ${a.chapter}:${range}`;
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-scripture-ref': '' }),
      label, // visible text is the reference label (aids HTML/clipboard extraction)
    ];
  },

  addCommands() {
    return {
      insertScriptureRef:
        (attrs) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    };
  },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/extensions/scripture-ref.editor.test.ts`
Expected: PASS (insert + round-trip + reject-malformed green).

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/scripture-ref.ts src/notepad/extensions/scripture-ref.editor.test.ts
git commit -m "feat(scripture-ref): inline-atom node with attrs, serialization, insert command"
```

---

## Task 11: `ScriptureRefView` NodeView (collapse state + lazy-fill)

**Files:**
- Create: `src/notepad/extensions/ScriptureRefView.tsx`
- Modify: `src/notepad/extensions/scripture-ref.ts` (wire `ReactNodeViewRenderer`)
- Test: `src/notepad/extensions/ScriptureRefView.test.tsx`
- Test: `src/notepad/extensions/scripture-ref.editor.test.ts` (add the collapse-no-dirty test)

- [ ] **Step 1: Write failing RTL tests for the view**

Create `src/notepad/extensions/ScriptureRefView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ScriptureRefCard } from './ScriptureRefView';

const baseAttrs = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  translation: 'BSB' as const, text: 'For God so loved the world',
};

describe('ScriptureRefCard', () => {
  it('renders collapsed by default as a reference label', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
    expect(screen.queryByText(/For God so loved/)).toBeNull();
  });

  it('expands to show verse text + BSB label on click', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByText(/John 3:16/));
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    expect(screen.getByText('BSB')).toBeTruthy();
  });

  it('lazy-fills empty text when online and writes it back', async () => {
    const updateText = vi.fn();
    const fetchVerseText = vi.fn(async () => ({ text: 'Backfilled verse', translation: 'BSB', reference: 'John 3:16' }));
    render(<ScriptureRefCard attrs={{ ...baseAttrs, text: '' }} online updateText={updateText} fetchVerseText={fetchVerseText} />);
    await waitFor(() => expect(fetchVerseText).toHaveBeenCalledOnce());
    expect(updateText).toHaveBeenCalledWith('Backfilled verse');
  });

  it('does not lazy-fill when offline', () => {
    const fetchVerseText = vi.fn();
    render(<ScriptureRefCard attrs={{ ...baseAttrs, text: '' }} online={false} updateText={vi.fn()} fetchVerseText={fetchVerseText} />);
    expect(fetchVerseText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx`
Expected: FAIL — `ScriptureRefView.tsx` does not exist.

- [ ] **Step 3: Implement the view (presentational `ScriptureRefCard` + the Tiptap NodeView wrapper)**

Create `src/notepad/extensions/ScriptureRefView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import type { ScriptureRefAttrs, ScriptureRefOptions } from './scripture-ref';

type FetchVerseText = (
  ref: string,
  opts?: { signal?: AbortSignal },
) => Promise<{ text: string; translation: string; reference: string } | null>;

export interface ScriptureRefCardProps {
  attrs: ScriptureRefAttrs;
  online: boolean;
  updateText: (text: string) => void;
  fetchVerseText: FetchVerseText;
}

function refLabel(a: ScriptureRefAttrs): string {
  const range = a.verseEnd ? `${a.verseStart}–${a.verseEnd}` : `${a.verseStart}`;
  return `${a.book} ${a.chapter}:${range}`;
}

// Presentational + behavior, independent of Tiptap for unit testing.
export function ScriptureRefCard({ attrs, online, updateText, fetchVerseText }: ScriptureRefCardProps) {
  // Ephemeral, local — never serialized. Default collapsed.
  const [collapsed, setCollapsed] = useState(true);
  const filledRef = useRef(false);

  useEffect(() => {
    if (filledRef.current) return;
    if (attrs.text.trim().length > 0) return;
    if (!online) return;
    filledRef.current = true;
    const ctrl = new AbortController();
    fetchVerseText(refLabel(attrs), { signal: ctrl.signal })
      .then((r) => { if (r?.text) updateText(r.text); })
      .catch(() => { /* offline/abort — stays empty, retries on remount */ });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.osis, online]);

  if (collapsed) {
    return (
      <button type="button" className="scripture-ref-link" onClick={() => setCollapsed(false)}>
        {'📖 '}{refLabel(attrs)}
      </button>
    );
  }

  return (
    <span className="scripture-ref-card">
      <span className="scripture-ref-card__text">{attrs.text || refLabel(attrs)}</span>
      <span className="scripture-ref-card__meta">{attrs.translation}</span>
      <button type="button" className="scripture-ref-card__collapse" onClick={() => setCollapsed(true)}>
        {'✕'}
      </button>
    </span>
  );
}

// Tiptap NodeView wrapper: bridges node attrs + options to ScriptureRefCard.
export function ScriptureRefNodeView(props: NodeViewProps) {
  const attrs = props.node.attrs as ScriptureRefAttrs;
  const options = props.extension.options as ScriptureRefOptions;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const fetchVerseText: FetchVerseText =
    options.search?.fetchVerseText ?? (async () => null);

  return (
    <NodeViewWrapper as="span" className="scripture-ref">
      <ScriptureRefCard
        attrs={attrs}
        online={online}
        fetchVerseText={fetchVerseText}
        updateText={(text) => props.updateAttributes({ text })}
      />
    </NodeViewWrapper>
  );
}
```

- [ ] **Step 4: Wire the NodeView into the node**

In `src/notepad/extensions/scripture-ref.ts`, add the import at the top:

```ts
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ScriptureRefNodeView } from './ScriptureRefView';
```

Then add this method to the `Node.create({...})` config (e.g. directly after `addCommands`):

```ts
  addNodeView() {
    return ReactNodeViewRenderer(ScriptureRefNodeView);
  },
```

- [ ] **Step 5: Add the collapse-does-not-dirty-doc test**

Append to `src/notepad/extensions/scripture-ref.editor.test.ts`:

```ts
describe('collapse state is ephemeral', () => {
  it('node JSON has no collapsed/view-state attr (toggle cannot dirty the doc)', () => {
    editor = makeEditor();
    editor.commands.insertScriptureRef(ATTRS);
    const node = findNode(editor.getJSON(), 'scriptureRef')!;
    expect(node.attrs).not.toHaveProperty('collapsed');
    expect(Object.keys(node.attrs).sort()).toEqual(
      ['book', 'chapter', 'osis', 'text', 'translation', 'verseEnd', 'verseStart'],
    );
  });
});
```

- [ ] **Step 6: Run both test files to verify pass**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx src/notepad/extensions/scripture-ref.editor.test.ts`
Expected: PASS (view states + lazy-fill + ephemeral-collapse green).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/extensions/ScriptureRefView.tsx src/notepad/extensions/scripture-ref.ts src/notepad/extensions/ScriptureRefView.test.tsx src/notepad/extensions/scripture-ref.editor.test.ts
git commit -m "feat(scripture-ref): React NodeView with ephemeral collapse + lazy-fill"
```

---

## Task 12: `VerseSuggestList` shared dropdown

**Files:**
- Create: `src/notepad/extensions/VerseSuggestList.tsx`
- Test: `src/notepad/extensions/VerseSuggestList.test.tsx`

- [ ] **Step 1: Write failing RTL tests**

Create `src/notepad/extensions/VerseSuggestList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VerseSuggestList } from './VerseSuggestList';
import type { VerseCandidate } from '../bible/verse-search-types';

const cand: VerseCandidate = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  text: 'For God so loved the world', translation: 'BSB', source: 'fts', score: 0.55,
};

describe('VerseSuggestList', () => {
  it('renders a row per candidate and fires onSelect on click', () => {
    const onSelect = vi.fn();
    render(<VerseSuggestList items={[cand]} selectedIndex={0} onSelect={onSelect} loading={false} offline={false} />);
    fireEvent.click(screen.getByText(/John 3:16/));
    expect(onSelect).toHaveBeenCalledWith(cand);
  });

  it('shows the passage label for ranged candidates', () => {
    const passage: VerseCandidate = { ...cand, osis: 'jhn.3.1', verseStart: 1, verseEnd: 21, label: 'John 3:1–21 · passage' };
    render(<VerseSuggestList items={[passage]} selectedIndex={0} onSelect={vi.fn()} loading={false} offline={false} />);
    expect(screen.getByText('John 3:1–21 · passage')).toBeTruthy();
  });

  it('renders the offline "needs connection" state', () => {
    render(<VerseSuggestList items={[]} selectedIndex={0} onSelect={vi.fn()} loading={false} offline />);
    expect(screen.getByText(/needs connection/i)).toBeTruthy();
  });

  it('renders a loading hint while semantic is pending', () => {
    render(<VerseSuggestList items={[cand]} selectedIndex={0} onSelect={vi.fn()} loading offline={false} />);
    expect(screen.getByText(/searching/i)).toBeTruthy();
  });

  it('renders a keep-typing hint when empty and not loading/offline', () => {
    render(<VerseSuggestList items={[]} selectedIndex={0} onSelect={vi.fn()} loading={false} offline={false} />);
    expect(screen.getByText(/keep typing/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/extensions/VerseSuggestList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dropdown**

Create `src/notepad/extensions/VerseSuggestList.tsx`:

```tsx
import type { VerseCandidate } from '../bible/verse-search-types';

export interface VerseSuggestListProps {
  items: VerseCandidate[];
  selectedIndex: number;
  onSelect: (item: VerseCandidate) => void;
  loading: boolean;
  offline: boolean;
}

function rowLabel(c: VerseCandidate): string {
  if (c.label) return c.label;
  const range = c.verseEnd ? `${c.verseStart}–${c.verseEnd}` : `${c.verseStart}`;
  return `${c.book} ${c.chapter}:${range}`;
}

export function VerseSuggestList({ items, selectedIndex, onSelect, loading, offline }: VerseSuggestListProps) {
  if (offline) {
    return <div className="verse-suggest verse-suggest--empty">Verse search needs connection</div>;
  }
  return (
    <div className="verse-suggest" role="listbox">
      {items.map((c, i) => (
        <button
          key={c.osis}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          className={`verse-suggest__row${i === selectedIndex ? ' is-selected' : ''}`}
          onClick={() => onSelect(c)}
        >
          <span className="verse-suggest__ref">{rowLabel(c)}</span>
          {c.text ? <span className="verse-suggest__text">{c.text}</span> : null}
        </button>
      ))}
      {loading ? <div className="verse-suggest__hint">Searching…</div> : null}
      {!loading && items.length === 0 ? <div className="verse-suggest__hint">Keep typing…</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/notepad/extensions/VerseSuggestList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notepad/extensions/VerseSuggestList.tsx src/notepad/extensions/VerseSuggestList.test.tsx
git commit -m "feat(scripture-ref): shared VerseSuggestList dropdown (loading/offline states)"
```

---

## Task 13: Wire the two Suggestion plugins into the node

**Files:**
- Modify: `src/notepad/extensions/scripture-ref.ts`
- Test: `src/notepad/extensions/scripture-ref.editor.test.ts`

This task adds `addProseMirrorPlugins()` returning two `Suggestion` plugins. B uses `findSuggestionMatch` (the Task 9 matcher); C uses `char: '/'` with the keyword `verse`. Both render `VerseSuggestList` via a small DOM renderer and call `insertScriptureRef`. The rendering glue is exercised manually (live smoke); the test here asserts the plugins are registered and B's `items` resolves a candidate via injected deps.

- [ ] **Step 1: Add a failing test that B resolves a candidate through injected deps**

Append to `src/notepad/extensions/scripture-ref.editor.test.ts`:

```ts
import { buildReferenceItems, buildKeywordItems } from './scripture-ref';
import type { VerseSearchDeps } from '../bible/verse-search-types';

function fakeDeps(): VerseSearchDeps {
  return {
    ftsSearch: async () => [{ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts' }],
    semanticSearch: async () => [],
    resolvePericope: async () => null,
    fetchVerseText: async () => ({ text: 'For God so loved', translation: 'BSB', reference: 'John 3:16' }),
  };
}

describe('suggestion item builders', () => {
  it('buildReferenceItems resolves the typed reference to one candidate', async () => {
    const items = await buildReferenceItems('John 3:16', fakeDeps(), new AbortController().signal);
    expect(items).toHaveLength(1);
    expect(items[0].osis).toBe('jhn.3.16');
    expect(items[0].text).toBe('For God so loved');
  });

  it('buildKeywordItems returns FTS candidates instantly (no deps -> empty)', async () => {
    const items = await buildKeywordItems('love', fakeDeps(), new AbortController().signal);
    expect(items[0].osis).toBe('jhn.3.16');
  });

  it('builders return [] when search deps are null', async () => {
    expect(await buildReferenceItems('John 3:16', null, new AbortController().signal)).toEqual([]);
    expect(await buildKeywordItems('love', null, new AbortController().signal)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/extensions/scripture-ref.editor.test.ts`
Expected: FAIL — `buildReferenceItems` / `buildKeywordItems` not exported.

- [ ] **Step 3: Implement the item builders + the two Suggestion plugins**

In `src/notepad/extensions/scripture-ref.ts`, add imports at the top:

```ts
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { matchReferenceBeforeCursor } from './scripture-ref-matchers';
import { completeReference, createVerseSearch } from '../bible/verse-search';
import type { VerseCandidate } from '../bible/verse-search-types';
import { renderVerseSuggestList } from './verse-suggest-renderer';
```

Add the exported builders (above the `Node.create` call):

```ts
export async function buildReferenceItems(
  query: string,
  search: VerseSearchDeps | null,
  signal: AbortSignal,
): Promise<VerseCandidate[]> {
  if (!search) return [];
  const c = await completeReference(query, search, { signal });
  return c ? [c] : [];
}

export async function buildKeywordItems(
  query: string,
  search: VerseSearchDeps | null,
  signal: AbortSignal,
): Promise<VerseCandidate[]> {
  if (!search) return [];
  // Instant FTS slice for the synchronous `items` contract; the live picker
  // upgrades with semantic results via createVerseSearch in the renderer.
  const rows = await search.ftsSearch(query, { signal });
  const { normalizeFtsRow, mergeCandidates, routeQuery, referenceCandidate } = await import('../bible/verse-search');
  const route = routeQuery(query);
  const pin = route.kind === 'reference' ? referenceCandidate(route.parsed, '') : null;
  return mergeCandidates(pin, rows.map(normalizeFtsRow), []);
}

const PREDICTIVE_KEY = new PluginKey('scriptureRefPredictive');
const VERSE_PICKER_KEY = new PluginKey('scriptureRefPicker');

function sharedSuggestion(
  editor: ScriptureRefOptions['search'] extends never ? never : unknown,
): void { void editor; } // placeholder removed below
```

Then add `addProseMirrorPlugins` to the `Node.create({...})` config:

```ts
  addProseMirrorPlugins() {
    const search = this.options.search;
    const self = this;

    const insertFromCandidate = (props: { editor: typeof self.editor; range: { from: number; to: number } }, c: VerseCandidate) => {
      props.editor
        .chain()
        .focus()
        .deleteRange(props.range)
        .insertScriptureRef({
          osis: c.osis, book: c.book, chapter: c.chapter, verseStart: c.verseStart,
          verseEnd: c.verseEnd, translation: 'BSB', text: c.text,
        })
        .run();
    };

    const base = {
      editor: this.editor,
      command: ({ editor, range, props }: { editor: typeof self.editor; range: { from: number; to: number }; props: VerseCandidate }) =>
        insertFromCandidate({ editor, range }, props),
      render: () => renderVerseSuggestList(),
    };

    // B — predictive reference (no trigger char; book-pattern matcher).
    const predictive: Partial<SuggestionOptions<VerseCandidate>> = {
      ...base,
      pluginKey: PREDICTIVE_KEY,
      char: '',
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchReferenceBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
      items: ({ query }) => buildReferenceItems(query, search, new AbortController().signal),
    };

    // C — /verse keyword picker.
    const picker: Partial<SuggestionOptions<VerseCandidate>> = {
      ...base,
      pluginKey: VERSE_PICKER_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      items: ({ query }) => {
        const stripped = query.replace(/^verse\s*/i, '');
        if (!/^verse/i.test(query)) return [];
        return buildKeywordItems(stripped, search, new AbortController().signal);
      },
    };

    return [
      Suggestion({ ...predictive, editor: this.editor } as SuggestionOptions<VerseCandidate>),
      Suggestion({ ...picker, editor: this.editor } as SuggestionOptions<VerseCandidate>),
    ];
  },
```

Remove the `sharedSuggestion` placeholder you added (it was a scaffold marker — delete those 3 lines). Also delete the unused `createVerseSearch` import if the renderer (next step) owns the live upgrade; keep it only if used.

- [ ] **Step 4: Create the suggestion renderer glue**

Create `src/notepad/extensions/verse-suggest-renderer.tsx`:

```tsx
import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps } from '@tiptap/suggestion';
import { VerseSuggestList } from './VerseSuggestList';
import type { VerseCandidate } from '../bible/verse-search-types';

// Minimal DOM renderer for both Suggestion configs. Positioning uses fixed
// coordinates from clientRect; styling lives in CSS (.verse-suggest).
export function renderVerseSuggestList() {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let current: SuggestionProps<VerseCandidate> | null = null;

  const paint = () => {
    if (!root || !current) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    root.render(
      <VerseSuggestList
        items={current.items}
        selectedIndex={selectedIndex}
        loading={false}
        offline={!online && current.items.length === 0}
        onSelect={(c) => current?.command(c)}
      />,
    );
  };

  const place = (props: SuggestionProps<VerseCandidate>) => {
    const rect = props.clientRect?.();
    if (el && rect) {
      el.style.position = 'fixed';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom}px`;
      el.style.zIndex = '50';
    }
  };

  return {
    onStart: (props: SuggestionProps<VerseCandidate>) => {
      current = props; selectedIndex = 0;
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      place(props); paint();
    },
    onUpdate: (props: SuggestionProps<VerseCandidate>) => {
      current = props;
      if (selectedIndex >= props.items.length) selectedIndex = 0;
      place(props); paint();
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (!current) return false;
      const n = current.items.length;
      if (props.event.key === 'ArrowDown') { selectedIndex = (selectedIndex + 1) % n; paint(); return true; }
      if (props.event.key === 'ArrowUp') { selectedIndex = (selectedIndex - 1 + n) % n; paint(); return true; }
      if (props.event.key === 'Enter') { const c = current.items[selectedIndex]; if (c) current.command(c); return true; }
      if (props.event.key === 'Escape') { return true; }
      return false;
    },
    onExit: () => {
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}
```

- [ ] **Step 5: Run the node test file to verify pass**

Run: `npx vitest run src/notepad/extensions/scripture-ref.editor.test.ts`
Expected: PASS (builders green; existing node tests still green).

- [ ] **Step 6: Typecheck the touched extension files**

Run: `npx tsc -b 2>&1 | grep -E "scripture-ref|verse-suggest|VerseSuggest|ScriptureRefView" || echo "no new type errors in touched files"`
Expected: `no new type errors in touched files` (pre-existing repo tsc errors elsewhere are out of scope — see baseline note). Fix any error that names a file you created/modified in Tasks 9–13.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/extensions/scripture-ref.ts src/notepad/extensions/scripture-ref.editor.test.ts src/notepad/extensions/verse-suggest-renderer.tsx
git commit -m "feat(scripture-ref): two Suggestion plugins (predictive + /verse) sharing one dropdown"
```

---

## Task 14: Node-aware graph extractor

**Files:**
- Modify: `src/notepad/graph/reference-parser.ts`
- Test: `src/notepad/graph/reference-parser.test.ts` (create if absent)

- [ ] **Step 1: Check whether the parser test file exists**

Run: `ls src/notepad/graph/reference-parser.test.ts 2>/dev/null && echo EXISTS || echo CREATE`
Expected: `EXISTS` (append to it) or `CREATE` (create a new file with the imports below).

- [ ] **Step 2: Write failing tests for node-aware extraction + prose/node dedupe**

Append to (or create) `src/notepad/graph/reference-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseReferencesFromContent, walkNodes } from './reference-parser';

function docWithScriptureRef() {
  return JSON.stringify({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Meditating on ' },
        { type: 'scriptureRef', attrs: { osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, translation: 'BSB', text: 'For God...' } },
      ],
    }],
  });
}

describe('walkNodes', () => {
  it('collects nodes of the given type', () => {
    const found = walkNodes(JSON.parse(docWithScriptureRef()), 'scriptureRef');
    expect(found).toHaveLength(1);
    expect((found[0].attrs as { osis: string }).osis).toBe('jhn.3.16');
  });
});

describe('parseReferencesFromContent — node-aware', () => {
  it('emits a scripture edge + ref from a scriptureRef node', () => {
    const { edges, scriptureRefs } = parseReferencesFromContent('note1', docWithScriptureRef());
    expect(scriptureRefs.map((s) => s.id)).toContain('scripture:jhn-3-16');
    expect(edges.some((e) => e.type === 'scripture_reference' && e.target === 'scripture:jhn-3-16')).toBe(true);
  });

  it('dedupes a verse that appears both in prose and as a node (counts once)', () => {
    const doc = JSON.parse(docWithScriptureRef());
    doc.content[0].content.push({ type: 'text', text: ' see John 3:16 again' });
    const { scriptureRefs } = parseReferencesFromContent('note1', JSON.stringify(doc));
    const johns = scriptureRefs.filter((s) => s.id === 'scripture:jhn-3-16');
    expect(johns).toHaveLength(1);
  });
});
```

> Note: the canonical id for "John 3:16" via `toCanonicalScriptureId` is `scripture:jhn-3-16` (the matcher uses `BOOK_ABBREVS`, whose shortest entry for John is `Jn` → `jn`... confirm at Step 4). If the produced id differs, update the expected string in this test to match `toCanonicalScriptureId('John 3:16')` exactly — the dedupe assertion (counts once) is the real invariant.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/notepad/graph/reference-parser.test.ts`
Expected: FAIL — `walkNodes` not exported; node not extracted.

- [ ] **Step 4: Confirm the canonical id the node must emit**

Run: `node -e "const {toCanonicalScriptureId}=require('./src/notepad/graph/reference-parser.ts')" 2>/dev/null || npx vitest run -t 'walkNodes' src/notepad/graph/reference-parser.test.ts`
Simpler: add a temporary `console.log(toCanonicalScriptureId('John 3:16'))` in a scratch test, or trust the implementation below which routes node refs through the *same* `toCanonicalScriptureId` used by prose — guaranteeing dedupe regardless of the exact string. Update the Step 2 expected id only if the explicit-id assertions fail.

- [ ] **Step 5: Implement `walkNodes` + node-aware extraction**

In `src/notepad/graph/reference-parser.ts`, add `walkNodes` next to `walkMarks` (after the `walkMarks` function, ~line 254):

```ts
export function walkNodes(doc: unknown, nodeType: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === nodeType) found.push(n);
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(doc);
  return found;
}
```

Then, inside `parseReferencesFromContent`, after the prose `VERSE_REGEX` loop (after the `while` block ends, before `void noteId;`), add the node-aware pass:

```ts
  // Node-aware: deliberate scriptureRef inserts carry a canonical ref in attrs.
  // An atom node has no text child, so extractPlainText never sees it — walk
  // nodes explicitly. Route through the SAME canonicalizer as prose so a verse
  // typed in prose AND inserted as a node dedupe to one ScriptureNode.
  const scriptureNodes = walkNodes(doc, 'scriptureRef');
  for (const node of scriptureNodes) {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (!attrs) continue;
    const book = attrs.book as string | undefined;
    const chapter = attrs.chapter as number | undefined;
    const verseStart = attrs.verseStart as number | undefined;
    if (!book || chapter == null || verseStart == null) continue;
    const verseEnd = (attrs.verseEnd ?? null) as number | null;
    const ref = `${book} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ''}`;
    const scriptureId = toCanonicalScriptureId(ref);
    const key = `scripture_reference:${scriptureId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ target: scriptureId, type: 'scripture_reference', weight: 0.95 });
    scriptureRefs.push({ id: scriptureId, ref });
  }
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/notepad/graph/reference-parser.test.ts`
Expected: PASS (walkNodes + node extraction + prose/node dedupe green). If the explicit-id assertion fails, update the expected string per Step 2's note; the dedupe test must pass as-is.

- [ ] **Step 7: Run the graph test suite to confirm no regression**

Run: `npx vitest run src/notepad/graph/`
Expected: existing graph tests stay green (node-aware change is additive; prose path untouched).

- [ ] **Step 8: Commit**

```bash
git add src/notepad/graph/reference-parser.ts src/notepad/graph/reference-parser.test.ts
git commit -m "feat(graph): node-aware scriptureRef extraction in parseReferencesFromContent"
```

---

## Task 15: Register `ScriptureRef` in the editor

**Files:**
- Modify: `src/notepad/editor/use-note-editor.ts`

- [ ] **Step 1: Add the imports**

In `src/notepad/editor/use-note-editor.ts`, add after the existing extension imports (after line 8):

```ts
import { ScriptureRef } from '../extensions/scripture-ref';
import { createBrowserVerseSearchDeps } from '../bible/verse-search-client';
```

- [ ] **Step 2: Register the extension with its search deps**

In the `extensions: [...]` array (lines 56–63), add `ScriptureRef` after `BibleVerse`:

```ts
      BibleVerse,
      ScriptureRef.configure({ search: createBrowserVerseSearchDeps() }),
```

- [ ] **Step 3: Verify the editor still constructs (headless smoke)**

Add a temporary check or run the existing editor tests:

Run: `npx vitest run src/notepad/editor/`
Expected: PASS — editor constructs with the new extension; existing editor tests stay green.

- [ ] **Step 4: Typecheck the build**

Run: `npx tsc -b 2>&1 | grep -E "use-note-editor|scripture-ref|verse-search" || echo "no new type errors in touched files"`
Expected: `no new type errors in touched files`.

- [ ] **Step 5: Run the full new+touched test surface**

Run: `npx vitest run src/notepad/bible/ src/notepad/extensions/scripture-ref.editor.test.ts src/notepad/extensions/scripture-ref-matchers.test.ts src/notepad/extensions/ScriptureRefView.test.tsx src/notepad/extensions/VerseSuggestList.test.tsx src/notepad/graph/reference-parser.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Confirm zero NEW lint errors on touched files**

Run: `npx eslint src/notepad/bible/verse-search.ts src/notepad/bible/verse-search-client.ts src/notepad/extensions/scripture-ref.ts src/notepad/extensions/ScriptureRefView.tsx src/notepad/extensions/VerseSuggestList.tsx src/notepad/extensions/scripture-ref-matchers.ts src/notepad/extensions/verse-suggest-renderer.tsx src/notepad/editor/use-note-editor.ts src/notepad/graph/reference-parser.ts`
Expected: clean (or only pre-existing warnings unrelated to this work — success is zero NEW errors on these files).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/editor/use-note-editor.ts
git commit -m "feat(notepad): register ScriptureRef verse-completion extension in the editor"
```

---

## Manual smoke tests (out of automated scope)

Run these in the live app after deploying migration 030 and the `verse-search` function:

1. **Predictive (B):** Type `John 3:16` in a note → dropdown shows the resolved verse → Enter inserts a collapsed `📖 John 3:16` link. Type `I read a book about love` → no dropdown fires.
2. **Picker (C):** Type `/verse love your enemies` → FTS rows appear instantly, semantic rows merge in after the pause → selecting inserts a node.
3. **Pericope hit:** A `/verse` query that returns a whole-pericope hit shows a `… · passage` row and inserts a ranged node.
4. **Collapse/expand:** Click a collapsed link → expands to verse card with `BSB` label → click collapse → reload note → starts collapsed (ephemeral state confirmed).
5. **Offline:** Go offline → `/verse` keyword shows "needs connection"; typing `John 3:16` still inserts (collapsed, empty text). Go back online → expand the node → text backfills (lazy-fill).
6. **Graph:** Insert a verse node, save, open the Backlinks/Info panel → the verse counts as a scripture reference (and a verse both typed and inserted counts once).

---

## Self-Review

**Spec coverage** (against `2026-06-15-auto-verse-completion-design.md`):
- B predictive + C `/verse`, shared dropdown, one insertion command → Tasks 9–13, 15. ✅
- Unified two-state node (collapsed link ↔ expanded card), ephemeral collapse → Tasks 10–11. ✅
- Hybrid search (route, FTS instant, semantic debounced, merge/dedupe by osis) → Tasks 4–8. ✅
- Pericope include & resolve → Task 5 (+ client Task 8). ✅
- BSB-only, `translation` labeled field → node attrs (Task 10), candidate type (Task 4). ✅
- Offline + lazy-fill → Task 11 (NodeView), Task 8 (graceful client), error matrix honored. ✅
- Graph node-aware extractor → Task 14 (+ resolved: no new sync wiring). ✅
- New dep `@tiptap/suggestion` → Task 1. New backend (FTS migration + edge fn) → Tasks 2–3. ✅
- Testing strategy items 1–5 → Tasks 4–8 (search), 9/13 (matchers/suggestion), 10–11 (node/view), 12 (list), 14 (graph). ✅
- 4 open planning items → resolved at the top, encoded in Tasks 3 (seam), 2 (FTS), 14 (graph trigger), 6 (ranking). ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The one deliberate flexibility (canonical-id string in Task 14) is bounded by a concrete fallback (the dedupe invariant) and a verification step.

**Type consistency:** `VerseCandidate`, `RawFtsRow`, `RawSemanticRow`, `PericopeRange`, `VerseSearchDeps` defined once in `verse-search-types.ts` (Task 4) and imported everywhere. `ScriptureRefAttrs` defined in `scripture-ref.ts` (Task 10), reused by the view (Task 11). Function names consistent across tasks: `routeQuery`, `normalizeFtsRow`, `normalizeSemanticRow`, `referenceCandidate`, `mergeCandidates`, `completeReference`, `createVerseSearch`, `buildReferenceItems`, `buildKeywordItems`, `walkNodes`, `osisForRef`, `osisBookToCanonical`.

**Baseline discipline:** Success = these changes add ZERO new test/lint/tsc failures and the touched-file subset is green — NOT a repo-wide green gate (repo ships ~100 lint errors + known red tests). Stage only this feature's files per commit.
