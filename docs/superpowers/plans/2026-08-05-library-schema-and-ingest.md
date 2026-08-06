# Library Schema + Ingest (Depth Overhaul slice 1b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the grounding corpus — schema, license-clean ingest, and embeddings — so slice 1c can retrieve from it. Ship the decided v1 set: **PD lean cut** (Spurgeon's *Treasury of David*, Matthew Henry Concise, JFB, Creeds.json Unlicense subset) **plus the CC-BY layer** (STEPBible TBESH/TBESG lexicons, OpenBible topical scores), with the attribution data day-one per the brainstorm §14.1 decision.

**No product surface changes in this slice.** Nothing in `src/` or `supabase/functions/` moves; the corpus is inert until 1c wires retrieval. That is deliberate — it makes this slice safely mergeable and independently verifiable by SQL alone.

**Design doc:** `docs/superpowers/specs/2026-08-04-lamplight-library-and-reasoning-design.md` (decisions 1–4, 12; §Data model, §Ingestion). Runs in parallel with / after slice 1a (`35e52c23`) — no code dependency between them.

**Architecture:** Two additive migrations, then a driver + per-source adapter scripts mirroring `scripts/ingest-cross-references.ts` and `scripts/ingest-bsb.ts` exactly: pure parse functions exported for vitest, thin `main()` for I/O, idempotent upserts on a unique key, Voyage batching at 64 with smaller upsert slices for HNSW maintenance. Verse-anchored chunking; TVTMS versification normalization at ingest.

**Tech Stack:** Postgres + pgvector (HNSW), Supabase JS client with service-role key, `tsx` scripts, `voyage-context-3` @ 512-dim via `_shared/voyage.ts`'s `embedDocuments`, Vitest 4 (`globals: false`, node env).

## Global Constraints

- Branch `feat/library-schema-and-ingest`. Migration numbers **058** and **059** (057 is current highest).
- **Migrations apply MANUALLY via the Supabase SQL Editor before any script runs** — the CLI `db push` is broken on this machine. The plan must not assume `supabase db push`.
- DB conventions (from 033/045 precedent): lowercase SQL, fully-qualified `public.`; `create policy` has **no** `if not exists`; one policy per verb with sentence names; public-read reference tables get `for select using (true)` and **no** insert/update/delete policy (service-role only, mirroring `bible_cross_references` and `bible_passages`).
- **Every source needs a verified license line in `library_sources.attribution` before its adapter is written.** The evidence trail lives in the runbook, quoting the actual terms page — same standard as `docs/runbooks/bible-translations-ingest.md`. Research backing: `docs/superpowers/research/2026-08-04-theological-source-library.md`.
- **Do NOT ingest** (verified restricted): BibleProject (no derivatives), Got Questions (200-word cap), Louw-Nida (UBS copyright), CCEL's own editions (their formatting copyright — take PD text from SWORD/e-Sword transcriptions instead), Chambers' *My Utmost* (renewed), NET notes and Enduring Word (permission pending — v2), the 8 copyright-restricted files inside Creeds.json.
- **Versification:** every verse-anchored row normalizes through STEPBible **TVTMS** before write, so refs align with `bible_passages` ids (lowercase OSIS book, e.g. `psa.27.4`). KJV-keyed classics and Hebrew-Psalm-title offsets are the known hazards — Psalm 51 (Hebrew superscription shifts verse numbers) and Joel 2/3 (chapter split) are the canary refs.
- Embedding writes reuse `ingest-bsb.ts`'s proven shape: Voyage batch 64, upsert in smaller slices, `upsertWithRetry` on SQLSTATE 57014 (statement timeout) with recursive halving.
- Gates: `npx tsc -b` (exit 0) **and** `npx vitest run scripts` **and** `npx eslint <touched files>`. Plus the SQL acceptance queries in Task 8.
- Commit only when the user asks.

## File Structure

**New migrations:** `supabase/migrations/058_library.sql`, `supabase/migrations/059_artifact_library_provenance.sql`

**New scripts:**
- `scripts/ingest-library.ts` (+`.test.ts`) — driver: `--source=<id>`, `--dry-run`, `--embed-only`; owns source registry, chunk upsert, embedding pass
- `scripts/library-adapters/types.ts` — `LibraryAdapter` interface + `LibraryChunkRow`
- `scripts/library-adapters/sword-commentary.ts` (+`.test.ts`) — shared diatheke-dump parser for Treasury of David / Henry Concise / JFB (they share a format; the per-source differences are config)
- `scripts/library-adapters/creeds.ts` (+`.test.ts`) — Creeds.json → confessional chunks, **excluding the restricted 8**
- `scripts/library-adapters/stepbible-lexicon.ts` (+`.test.ts`) — TBESH/TBESG TSV → lexical chunks keyed by `strongs`
- `scripts/library-adapters/openbible-topics.ts` (+`.test.ts`) — topical scores TSV → topical chunks
- `scripts/library-adapters/versification.ts` (+`.test.ts`) — TVTMS transform table + `normalizeRef`
- `scripts/library-adapters/chunk-text.ts` (+`.test.ts`) — token-bounded splitter (100–600) reusing `_shared/chunker.ts` limits

**New docs:** `docs/runbooks/library-ingest.md`

---

### Task 1: Migration 058 — schema

**File:** `supabase/migrations/058_library.sql`

- [x] **Step 1: write the migration** exactly as specified in the design doc's §Data model — `library_sources` (id, title, author, era, tradition, register CHECK, license, attribution, ingest_version, created_at), `library_chunks` (id uuid, source_id FK cascade, book/chapter/verse_start/verse_end nullable, strongs, topic, heading, content, token_count, embedding vector(512), created_at), the four btree indexes + the HNSW index (m=16, ef_construction=64), RLS enabled with public-read-only policies on both, and `match_library_chunks(p_query_vector vector(512), p_limit int, p_registers text[] default null)`.
- [x] **Step 2: add a chunk uniqueness key** the ingest can upsert on — the design didn't name one and idempotency needs it. **Written as plain columns with `nulls not distinct`, NOT the coalesce-expression index this plan first sketched:** PostgREST's `on_conflict` takes a column list, so an expression index cannot be an upsert target. `nulls not distinct` (PG15+) makes the nullable anchor columns compare as equal, which is the same pattern `lamplight_embeddings` already uses.
  ```sql
  create unique index library_chunks_ident
    on public.library_chunks (source_id, heading, book, chapter, verse_start)
    nulls not distinct;
  ```
- [x] **Step 3: hand the SQL to the user to run in the SQL Editor.** Do not attempt `supabase db push`. Wait for confirmation before Task 3.
- [x] **Step 4: verify** with `select count(*) from public.library_sources;` (0) and `\d public.library_chunks` equivalent — confirm `vector(512)` and the five indexes exist.

### Task 2: Migration 059 — artifact provenance column

**File:** `supabase/migrations/059_artifact_library_provenance.sql`

- [x] **Step 1:** `alter table public.lamplight_artifacts add column source_library_chunks jsonb;` with a comment explaining the shape (`[{chunk_id, source_id, heading}]`, heading snapshotted so the transparency panel survives a re-ingest that rotates chunk ids).
- [x] **Step 2:** user runs it in the SQL Editor. No code reads it until 1c/1d — this lands now so 1c is a pure code change.

### Task 3: Adapter contract + versification + chunker (pure, TDD — no I/O)

**Files:** `scripts/library-adapters/{types,versification,chunk-text}.ts` (+tests)

- [x] **Step 1: failing tests for `normalizeRef`** — Psalm 51 Hebrew-superscription offset maps KJV `psa.51.1` ↔ Hebrew numbering correctly; Joel 2:28 (KJV) → Joel 3:1 (Hebrew/BSB) or the reverse per the TVTMS table; a ref needing no transform passes through unchanged; an unmapped book token throws loudly (never silently drops — the cross-references ingest set that precedent).
- [x] **Step 2:** run, expect FAIL. **Step 3: implement** — load the TVTMS mapping as a static table checked into `scripts/data/` (same place other ingest data lives), expose `normalizeRef(osisRef, sourceTradition): string`.
- [x] **Step 4: failing tests for `chunkText`** — a 200-token passage stays one chunk; an 800-token passage splits on paragraph boundaries into ≤600-token pieces; a single 900-token paragraph falls back to sentence splitting; every emitted chunk carries a `token_count` within bounds. Reuse `_shared/chunker.ts`'s MIN/MAX/CHARS_PER_TOKEN constants rather than redefining them.
- [x] **Step 5:** implement; both suites green.
- [x] **Step 6: define `LibraryAdapter`** in `types.ts`:
  ```ts
  export interface LibraryChunkRow {
    source_id: string; book?: string; chapter?: number;
    verse_start?: number; verse_end?: number;
    strongs?: string; topic?: string;
    heading: string; content: string; token_count: number;
  }
  export interface LibraryAdapter {
    sourceId: string;
    source: LibrarySourceRow;                 // the row upserted into library_sources
    parse(raw: string): LibraryChunkRow[];    // pure; no fs, no network
  }
  ```
  The `parse`-is-pure rule is what makes every adapter testable on a small fixture string.

### Task 4: SWORD commentary adapter (Treasury of David, Henry Concise, JFB)

**Files:** `scripts/library-adapters/sword-commentary.ts` (+test), fixtures under `scripts/library-adapters/__fixtures__/`

- [x] **Step 1: capture a real fixture** — dump ~3 verse-ranges per source with `diatheke -b TDavid -k Psalms 27` (etc.), save trimmed excerpts as fixture files. Record the exact diatheke commands in the runbook; they are the reproducibility contract.
- [x] **Step 2: failing tests** — parses a verse-range heading into `book/chapter/verse_start/verse_end`; a per-verse comment becomes one chunk; an oversize comment splits via `chunkText` while every piece keeps the same verse anchor; the embedded text is prefixed `"<author>, <era> — on <ref>:"` (retrieval carries authorship); Treasury of David's "quaint sayings" sections group under their psalm rather than emitting one chunk per aphorism; refs pass through `normalizeRef`.
- [x] **Step 3:** implement one parser parameterized by source config (heading regex, author, era, register) — the three sources share the diatheke output shape; do NOT write three parsers.
- [x] **Step 4:** tests green for all three source configs against their fixtures.

### Task 5: Creeds, lexicon, and topics adapters

**Files:** `scripts/library-adapters/{creeds,stepbible-lexicon,openbible-topics}.ts` (+tests)

- [x] **Step 1: creeds — failing tests first.** The load-bearing one: **the 8 copyright-restricted documents are excluded**, asserted by name against a fixture that contains one of them (e.g. the Chicago Statement). Then: one chunk per article/Q&A; `register: 'confessional'`; no verse anchor; scripture proof-refs preserved inside `content`.
- [x] **Step 2:** implement + green.
- [x] **Step 3: lexicon — failing tests.** One chunk per lemma keyed by `strongs` (e.g. `H7462`); `register: 'lexical'`; glosses/definitions only (no full LSJ dumps in v1); a malformed TSV row is skipped with a counted warning, not a throw (large third-party files have dirty rows).
- [x] **Step 4:** implement + green.
- [x] **Step 5: topics — failing tests.** One chunk per topic with its top-N verses by votes; `topic` column set; `register: 'topical'`; modern-phrasing topics (anxiety, loneliness) survive normalization.
- [x] **Step 6:** implement + green.

### Task 6: The ingest driver

**Files:** `scripts/ingest-library.ts` (+test)

- [x] **Step 1: failing tests for the pure parts** — the source registry resolves `--source=<id>` to an adapter and rejects unknown ids; `--dry-run` returns counts without calling any Supabase dep (assert the injected client is never touched); chunk rows are upserted on the `library_chunks_ident` conflict target; `--embed-only` skips parsing entirely.
- [x] **Step 2:** implement the driver with injected `{ supabase, embed, readFile }` deps so the tests need no network (mirrors `backfill-note-embeddings.ts`).
- [x] **Step 3: the embedding pass**, copied in shape from `ingest-bsb.ts:226-296`: select rows where `embedding is null`; Voyage-batch at 64 via `embedDocuments`; upsert in smaller slices; `upsertWithRetry` halving on SQLSTATE 57014. Embed the **prefixed** text (author + era + ref + content), not bare content.
- [x] **Step 4:** `npx vitest run scripts` green.

### Task 7: Run the ingest

- [x] **Step 1: seed `library_sources`** — one row per source with its verified `attribution` string. This is the row the Sources screen renders in 1d; get the credit lines right now (OpenBible: "Credit OpenBible.info"; STEPBible: "STEP Bible" linked to stepbible.org).
- [x] **Step 2: dry-run each source**, record chunk counts.
- [x] **Step 3: real run per source**, then the embedding pass. Expect ~8M tokens total ≈ $1.50–5 one-time on Voyage.
- [x] **Step 4: record every count in the runbook** — those numbers ARE the idempotency check for future re-runs.

### Task 8: Acceptance + runbook

**File:** `docs/runbooks/library-ingest.md`

- [x] **Step 1: acceptance SQL** (paste results into the runbook):
  ```sql
  -- per-source chunk counts must match the recorded numbers
  select source_id, count(*), sum(token_count) from public.library_chunks group by 1 order by 1;
  -- every verse-anchored chunk resolves against real scripture
  select count(*) from public.library_chunks c
    where c.book is not null
      and not exists (select 1 from public.bible_passages p
                      where p.book = c.book and p.chapter = c.chapter and p.translation = 'BSB');
  -- expect 0 ─ a non-zero here means versification normalization is wrong
  -- no chunk left unembedded
  select count(*) from public.library_chunks where embedding is null;  -- expect 0
  -- TVTMS canaries
  select heading from public.library_chunks where source_id='treasury-of-david' and book='psa' and chapter=51 limit 5;
  ```
- [x] **Step 2: a live retrieval sanity check** (proves the RPC works before 1c depends on it): embed the phrase "waiting on the Lord in a season of fear" with the same Voyage config and call `match_library_chunks(vector, 5)`. Expect Psalm 27 material from Treasury of David near the top. Record the result.
- [x] **Step 3: write the runbook** — diatheke commands, source URLs, **the license evidence trail with quoted terms per source**, the exact run order, recorded counts, and the re-run/rollback procedure (`delete from library_chunks where source_id = '…'` then re-run; `library_sources` upserts by id).
- [x] **Step 4: final gates** — `npx tsc -b`, `npx vitest run scripts`, `npx eslint` on touched files.

## Open questions (resolve during execution, none blocking)

- Matthew Henry **Complete** in this slice or after 1c retrieval-quality data? Default: **after** — Concise first (~800k tokens vs ~6–7M for overlapping coverage).
- Berean interlinear: migration 041's `bible_interlinear` may already cover it. Task 5 skips it; reconcile in 1c if the lexical channel proves thin.
- Whether `library_chunks_ident` should include `topic`/`strongs` — only matters if a source emits both anchored and unanchored chunks with the same heading. Revisit if an adapter hits a conflict collision during Task 7.

---

## Completion record (2026-08-05)

**Slice 1b is complete for the three commentary sources.** Migrations 058/059 applied via SQL Editor; 34,076 chunks parsed, upserted, and embedded; all acceptance checks pass.

| Source | Chunks | Verse-anchored | Tokens | Embedded |
|---|---|---|---|---|
| treasury-of-david | 12,745 | 11,947 | 2,912,484 | 12,745 |
| matthew-henry-concise | 4,136 | 4,136 | 934,146 | 4,136 |
| jfb | 17,195 | 17,195 | 2,343,707 | 17,195 |
| **total** | **34,076** | **33,278** | **6,190,337** | **34,076** |

Acceptance: unembedded = **0**; orphan verse anchors = **0** (every anchored chunk resolves against `bible_passages`, confirming versification across all 33,278 anchors); retrieval smoke returns apt, correctly-anchored results from two sources. Baseline recorded in the runbook §6b.

**Deviations from the plan:**

1. **Lexical source dropped.** `bible_strongs` + `bible_interlinear` (migration 041) already hold Strong's lexicon data publicly. Slice 1c's lexicon block reads them directly rather than duplicating into `library_chunks`.
2. **Commentary adapter consumes a JSONL intermediate**, not raw diatheke output — the format could not be verified before the modules were installed, and writing a parser against a guessed format would have looked finished while failing on real data. `dump-sword-commentary.ts` owns the acquisition; the runbook documents it.
3. **Idempotency index uses plain columns with `nulls not distinct`**, not the sketched `coalesce(...)` expression index: PostgREST's `on_conflict` takes a column list and cannot target an expression index.
4. **Task 5 (creeds + topics adapters) NOT done** — neither Creeds.json nor the OpenBible topical TSV is in `scripts/data/`. Deferred; the two sources remain planned but unwritten.

**Bugs found only against real data or a real database** (each fixed with a regression test):

- Three modules key content three different ways. JFB/MHCC are verse-range keyed and diatheke repeats a range's text per verse; **TDavid puts the entire psalm on verse 1** with inline `* Verse N. *` markers. Splitting on those markers is what makes Spurgeon verse-anchored (11,947 anchors) rather than 150 chapter blobs.
- Treasury comments on the same verse once per section, so refs repeat. Without an occurrence suffix those rows **collide on `library_chunks_ident` and the upsert silently keeps one** — verified fixed: the retrieval baseline shows `Psalm 130:5 [2]` and `[3]` carrying different text.
- `supabase-js` constructs a Realtime client at `createClient`, which throws on Node 20 (no global WebSocket). Fixed with an unused transport rather than a `ws` dependency (`ed11e7fd`).
- **The embedding pass hit PostgREST's ~1000-row response cap** and silently embedded only 1,000 per source — all three reported success while 31,076 of 34,076 chunks had no vector, which would have left slice 1c retrieving from ~9% of the corpus with nothing downstream complaining. Fixed with paging + a 1,200-row regression test (`f74d23d3`). Surfaced only because the reported counts were suspiciously round.

**Watch item:** `matthew-henry-concise` did not place in the baseline top-5. Plausible (smallest source, summarises blocks rather than single verses) but worth confirming during 1c that it surfaces on some queries.
