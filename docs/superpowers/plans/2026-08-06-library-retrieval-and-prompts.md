# Library Retrieval Fusion + Prompts (Depth Overhaul slice 1c) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the corpus from slice 1b actually reach the model. Add two-channel retrieval (verse-anchor exact join + semantic, RRF-fused), wire it into **Study chat/insight** and **Today's Lamp**, apply the by-surface visibility decision (study names its voices in prose; the devotion draws substance silently), add the lexicon block that retires Phase-0's "no lexicon supplied" hedge, and persist library provenance on the devotion artifact.

**Design doc:** `docs/superpowers/specs/2026-08-04-lamplight-library-and-reasoning-design.md` (decisions 5, 6; §Retrieval, §Prompt contracts). **Depends on slice 1b** (`library_chunks` populated + embedded, `lamplight_artifacts.source_library_chunks` column present). Runs after 1a (`35e52c23`).

**Architecture:** One new pure-ish module `_shared/library-retrieval.ts` owning the fusion, injected into the two existing context builders (`lamplight-study/study-context.ts`, `_shared/note-context.ts`). Prompt modules gain render blocks. `BibleChatContext` gains **optional** fields so journaling chat — which gets no library in v1 (design decision 6) — is untouched by construction.

**Tech Stack:** Deno edge functions (no Deno globals in `_shared`), Supabase JS (PostgREST `.or()` filters), `voyage-context-3` embeddings + `rerank-2.5`, Vitest 4 (`globals: false`, node env).

## Global Constraints

- Branch `feat/library-retrieval-and-prompts`.
- **Graceful degradation is mandatory.** An empty or missing `library_chunks` table, a failed query, or a Voyage error must yield `[]` and let the turn proceed on today's grounding. Precedent: `retrieveRelatedPassages` (`study-context.ts:70-73`) wraps everything in try/catch and logs. The library must never be able to break a devotion or a chat reply.
- **LOAD-BEARING: library excerpts do NOT expand `allowedVerseRefs`.** A commentary chunk mentioning Isaiah 40:31 does not authorize citing Isaiah 40:31 — its *text* was never supplied, and the citation validator's whole job is that only supplied verse text can be cited. The model may discuss what a voice says; it may only *cite* verses already in the allowlist. Pin this with a test in Task 4.
- **No new migrations.** The verse-anchor channel uses a PostgREST `.or()` filter over `(book, chapter)` pairs plus a pure JS overlap filter — deliberately avoiding an RPC so this slice is code-only and reversible by revert.
- **Prompt versions must bump** on every prompt change (`study-chat-2026-08-04-v3` → `-v4`; `daily-devotion-2026-06-09-v3` → a new dated version). `prompt_version` is persisted per artifact and is how 1d's eval attributes quality.
- **Citations schema is frozen in v1** (design decision 5): `emit_chat_reply` keeps `type: 'note' | 'verse'`. Source attribution rides prose + provenance, not the citations array.
- Reflections (Waymarks) are **out of scope** — the library reaches them in a later slice, not here.
- Gates: `npx tsc -b` (exit 0) **and** `npx vitest run supabase/functions` **and** `npx eslint <touched files>`. Then the manual browser check in Task 8.
- Commit only when the user asks.

## File Structure

**New:** `supabase/functions/_shared/library-retrieval.ts` (+`.test.ts`)

**Modified:**
- `supabase/functions/lamplight-chat/bible-chat-pipeline.ts` — `BibleChatContext` gains optional `libraryExcerpts?` + `lexiconEntries?`
- `supabase/functions/lamplight-study/study-context.ts` (+`.test.ts`) — retrieve both, thread into ctx
- `supabase/functions/lamplight-study/prompts/study-chat.ts` (+`.test.ts`) — voices + lexicon blocks, naming rules, v4
- `supabase/functions/lamplight-study/prompts/study-insight.ts` (+`.test.ts`) — same blocks, k=2
- `supabase/functions/lamplight-study/index.ts` — pass `libraryK` per mode
- `supabase/functions/_shared/note-context.ts` (+`.test.ts`) — optional library retrieval in the shared seam
- `supabase/functions/lamplight-generate/index.ts` — wire library deps into the devotion builder
- `supabase/functions/lamplight-generate/prompts/daily-devotion.ts` (+`.test.ts`) — excerpts block, silent-substance rule, version bump
- `supabase/functions/lamplight-generate/daily-devotion-pipeline.ts` (+`.test.ts`) — persist `source_library_chunks`

---

### Task 1: Fusion primitives (pure, TDD)

**File:** `_shared/library-retrieval.ts` (+test)

- [x] **Step 1: failing tests for `overlapsRef`** — a chunk `(psa, 27, 1, 14)` overlaps anchor `psa 27:4`; a chapter-level chunk (`verse_start` null) overlaps any verse in that chapter; `(psa, 27, 1, 3)` does NOT overlap `psa 27:9`; a different book never overlaps; an anchor with no verse (chapter-level query) matches every chunk in the chapter.
- [x] **Step 2: failing tests for `fuseRRF`** — reciprocal-rank fusion with k=60 over two ranked lists; an item ranked #1 in both lists outranks an item ranked #1 in one and absent from the other; items are deduped by chunk id keeping the summed score; ties break deterministically by chunk id (so tests and cache keys are stable).
- [x] **Step 3:** run, expect FAIL. **Step 4: implement** both as exported pure functions. **Step 5:** green.

### Task 2: `searchLibrary` — two channels + rerank + degradation

**File:** `_shared/library-retrieval.ts` (+test)

- [x] **Step 1: failing tests** with injected fakes (no Supabase stub gymnastics — follow the `NoteContextDeps` pattern of injecting the I/O leaves):
  - the verse-anchor channel queries only the distinct `(book, chapter)` pairs from the supplied refs (assert the composed `.or()` filter string), then filters by overlap in JS
  - the semantic channel calls `match_library_chunks` with the supplied embedding, `p_limit` = pool size, and `p_registers` when given
  - results fuse via `fuseRRF` and cut to `k`
  - **`registers: ['devotional']` filters the semantic channel AND post-filters the anchor channel** (the anchor query can't express register without a join — assert devotional-only output when a lexical chunk overlaps the anchor)
  - **rerank runs only when `rerankEnabled`**, receives the chunk contents as documents, and reorders by its returned indices
  - **degradation:** a throwing anchor query, a throwing RPC, and a throwing rerank each yield `[]` (or the pre-rerank order for the last) with a `console.error`, never a rejected promise
  - an empty `library_chunks` (both channels empty) returns `[]` without calling rerank
- [x] **Step 2:** FAIL → **Step 3: implement**:
  ```ts
  export interface LibraryExcerpt {
    chunkId: string; sourceId: string;
    sourceLabel: string;      // 'Treasury of David · Spurgeon, 1869–85'
    heading: string; content: string; score: number;
  }
  export interface LibraryRetrievalDeps {
    fetchByChapters(pairs: Array<{ book: string; chapter: number }>): Promise<LibraryChunkRow[]>;
    matchSemantic(args: { embedding: number[]; limit: number; registers?: string[] }): Promise<LibraryChunkRow[]>;
    rerank(query: string, documents: string[], topK: number): Promise<Array<{ index: number; score: number }>>;
    loadSources(): Promise<Map<string, { label: string; register: string }>>;  // cached per invocation
  }
  export async function searchLibrary(
    deps: LibraryRetrievalDeps,
    args: { refs: RefAnchor[]; queryEmbedding: number[]; query: string; k: number; registers?: string[]; rerankEnabled: boolean },
  ): Promise<LibraryExcerpt[]>;
  ```
  `sourceLabel` is composed once from `library_sources` (title · author, era) so prompts never string-build it.
- [x] **Step 4:** green.

### Task 3: Lexicon block

**File:** `_shared/library-retrieval.ts` (+test)

- [x] **Step 1: failing tests for `fetchLexiconEntries`** — given a chapter's `bible_interlinear` rows, it takes the distinct non-null `strongs`, caps at N (default 12, ordered by frequency within the chapter so the chapter's *characteristic* words win, not merely the first verse's), and returns matching `library_chunks` where `strongs` is in that set; null-strongs particles are skipped; a chapter with no interlinear coverage returns `[]`.
- [x] **Step 2:** FAIL → **Step 3:** implement with injected deps. **Step 4:** green.

### Task 4: Study context wiring

**Files:** `lamplight-study/study-context.ts` (+test), `lamplight-chat/bible-chat-pipeline.ts`

- [x] **Step 1:** add to `BibleChatContext` (in `bible-chat-pipeline.ts`, where the type lives):
  ```ts
  libraryExcerpts?: LibraryExcerpt[];   // undefined on journaling chat (design decision 6)
  lexiconEntries?: LexiconEntry[];
  ```
  Optional so journaling chat compiles and behaves identically.
- [x] **Step 2: failing tests in `study-context.test.ts`** — `buildStudyContext` populates `libraryExcerpts` (reusing the embedding already computed for notes — **do not embed twice**, that seam already exists at `study-context.ts:142`); anchors are the open chapter **plus the resolved cross-ref targets** (so a commentary on a cross-referenced verse surfaces); `lexiconEntries` populated from the chapter's Strong's; **`allowedVerseRefs` is byte-identical with and without library excerpts** (the load-bearing constraint); a library failure degrades to `undefined`/`[]` with the rest of the context intact.
- [x] **Step 3:** FAIL → **Step 4:** implement, threading `libraryK` through `buildStudyContext`'s args. **Step 5:** green.
- [x] **Step 6:** `lamplight-study/index.ts` passes `libraryK` per mode: `chat: 4`, `insight: 2` (design §Retrieval budgets), alongside the existing `STUDY_EFFORT`/`STUDY_MAX_TOKENS` constants.

### Task 5: Study prompts

**Files:** `prompts/study-chat.ts` (+test), `prompts/study-insight.ts` (+test)

- [x] **Step 1: failing tests** — `buildMessages` renders a `Voices from the church's study:` block, each excerpt labeled `[<sourceLabel> · <heading>]`; renders a lexicon block; **omits both blocks entirely when the arrays are empty/undefined** (no empty headers — the journaling-chat prompt path must render identically to today); `promptVersion` is `study-chat-2026-08-06-v4`.
- [x] **Step 2:** FAIL → **Step 3: implement** the render helpers next to the existing `renderCrossRefs`/`renderRelatedPassages`, and add these system rules:
  - theological claims beyond the passage's plain sense come from the supplied voices or supplied passages — never from the model's own memory
  - **when leaning on a voice, name it in prose** ("Spurgeon reads this as…") — this is the by-surface visibility decision
  - when supplied voices disagree, say so plainly; disagreement honestly reported is a feature
  - never attribute a claim to a voice that did not make it, and never invent a source
  - the lexicon block may be cited as "the lexicon glosses this as…"; **replace** the Phase-0 line about no lexicon being supplied — but keep a conditional hedge for chapters where the block is empty
  - verse citations still come ONLY from the supplied refs (unchanged; restated so the new material can't be read as widening it)
- [x] **Step 4:** mirror into `study-insight.ts` (its system appends to the study system). **Step 5:** green.

### Task 6: Devotion context + prompt

**Files:** `_shared/note-context.ts` (+test), `lamplight-generate/index.ts`, `prompts/daily-devotion.ts` (+test)

- [x] **Step 1: failing tests in `note-context.test.ts`** — `retrieveNoteContext` gains an OPTIONAL `library` dep; when absent the function behaves byte-identically to today (assert against the existing expectations); when present it returns `libraryExcerpts` retrieved with `registers: ['devotional']`, `k: 2`, anchored on the retrieved passages' refs; the blank-notes short-circuit still spends nothing (**library is not queried when there are no notes**).
- [x] **Step 2:** FAIL → **Step 3:** implement. Keep the dep optional so the smoke-test caller (if still present) and any future caller opt in explicitly.
- [x] **Step 4: failing tests in `daily-devotion.test.ts`** — the user message renders a `Study excerpts (do not name these authors in the devotion):` block when present and omits it when empty; `promptVersion` bumped.
- [x] **Step 5:** FAIL → **Step 6: implement** the block plus the system rule: *draw substance from the supplied study excerpts — a detail of the passage's argument, imagery, or setting you would not otherwise reach — without quoting the old authors at length or naming them in the devotion; their names belong to the provenance panel.* Note the deliberate asymmetry with Study chat, and why, in a code comment.
- [x] **Step 7:** green.

### Task 7: Devotion provenance persistence

**File:** `daily-devotion-pipeline.ts` (+test)

- [x] **Step 1: failing test** — a successful generation inserts `source_library_chunks` as `[{chunk_id, source_id, heading}]` for exactly the excerpts supplied to the prompt; an empty/absent library yields `null` (not `[]`) so the panel can distinguish "no library" from "library ran, nothing used"; the existing `source_note_ids`/`source_verses` assertions still hold; the race-path re-read is unaffected.
- [x] **Step 2:** FAIL → **Step 3:** implement at the insert (`daily-devotion-pipeline.ts:189-203`). **Step 4:** green.
- [x] **Step 5:** confirm the streaming devotion path persists identically — it shares `devotionPostGeneration`, so one change should cover both; add an assertion rather than assuming (the Phase-0 tier drift is the cautionary tale).

### Task 8: Gates + live verification

- [x] **Step 1:** `npx tsc -b` exit 0; `npx vitest run supabase/functions` green; `npx eslint` clean on touched files.
- [x] **Step 2: cost check.** Study chat's prompt grows by roughly 1,200 tokens (4 excerpts + lexicon). At terra/sol input rates this is fractions of a cent per turn, but confirm against a real turn and note the delta — this is the first slice that materially grows a prompt.
- [ ] **Step 3: live check on a seeded local/staging DB** (needs 1b's ingest run):
  - open Psalm 27 in Study, ask a question, confirm the reply names a voice ("Spurgeon…") and that the cited refs all appear in the chapter/cross-refs/related set
  - open a chapter with no library coverage; confirm the reply is unchanged in quality and no empty blocks leak into the prompt (check the logged prompt if needed)
  - generate a Today's Lamp; confirm the body names no commentator and `source_library_chunks` is populated
- [x] **Step 4:** record the verification in the PR. The provenance panel and Sources screen that *render* this data are slice 1d — this slice only produces it.

## Open questions (resolve during execution, none blocking)

- Lexicon cap of 12 Strong's per chapter is a guess; tune once real prompts are inspected.
- Should the anchor channel include the *related passages* (semantic neighbours) as anchors, not just chapter + cross-refs? Default **no** in v1 — it multiplies anchors by 6 for modest gain; revisit with 1d eval data.
- If study-chat latency regresses noticeably with the larger prompt, the lexicon block is the first thing to make conditional (chat-only, insight-off).

---

## Completion record (2026-08-06)

**Slice 1c is code-complete, and its retrieval half is verified against the live
corpus.** The two checks that need a deployed function and a real model call are
still open (see "Not yet verified" below); everything else in the plan is done.

**Gates:** `npx tsc -b` exit 0 · `npx vitest run supabase/functions` **565 passed
/ 56 files** · `npx eslint` clean on all touched files. Full repo suite also green
(3,528 passed, 43 skipped).

### Live verification (fusion smoke, Psalm 27 whole-chapter anchor, four queries)

`scripts/library-fusion-smoke.ts` drives the real path — `makeLibraryDeps` →
`searchLibrary` → `fetchLexiconEntries` — not the raw RPC, so a pass here means
study chat and Today's Lamp will see the same excerpts.

- **All three sources surfaced**: `jfb`, `matthew-henry-concise`,
  `treasury-of-david`. This **closes the runbook §6b watch item** — MHCC does
  place once the anchor channel and block-level questions are in play, so it is
  earning its context budget. Matthew Henry *Complete* remains deferred.
- The composed `.or()` chapter filter is valid PostgREST; `match_library_chunks`
  accepts a raw `number[]` for `p_query_vector` (the edge-function form from
  `_shared/retrieval.ts`, not the string form the older ingest smoke uses).
- Register filtering holds: devotional-only returns no `jfb`; the unwritten
  `confessional`/`topical` registers return `[]` without throwing.
- **Lexicon: 12 entries, all resolved** (after the fix below).

### Prompt-size delta (measured, not estimated)

Rendered the real prompt modules with excerpts sized to the corpus's own recorded
averages (runbook §4: Treasury 228 tok/chunk, MHCC 225, JFB 136).

| Surface | User block | System | **Total/turn** |
|---|---|---|---|
| Study chat (k=4 + 12 lexicon) | +1,242 | +245 | **+1,487** |
| Study insight (k=2) | — | — | **+749** |
| Daily devotion (k=2, devotional) | +620 | +158 | **+778** |

Study chat's split: excerpts +993, lexicon +249. Higher than the plan's ~1,200
estimate because the average Treasury chunk is 228 tokens. The lexicon block
remains the cheapest thing to make conditional if latency regresses.

### Deviations from the plan

1. **The lexicon reads `bible_strongs` + `bible_interlinear` directly**, per the
   1b handoff — not `library_chunks` as Task 3 was written. There is no lexical
   library source; 1b dropped it as duplication.
2. **`makeLibraryDeps` lives in `_shared/library-retrieval.ts`**, not in
   `study-context.ts` as the file plan implied. Both study and the devotion need
   it, and the alternative was `lamplight-generate` importing `lamplight-study`.
3. **`libraryK` defaults to 0** — callers opt in. A kill-switch test proves 0
   issues no library queries at all.
4. **Anchor rows rank by semantic corroboration first, then specificity.** Not
   specified in the plan. With a whole chapter open every chunk overlaps, so
   specificity alone ranks by verse number and verse-1 commentary would consume
   a slot on every turn regardless of the question. Borrowing the semantic rank
   puts "on this passage AND about this question" at the head while chunks the
   embedding missed still ride along for recall.
5. **The ingest embedding prefix is stripped** from excerpt bodies. It duplicates
   `sourceLabel` + `heading`, and it carries a ref ("Psalm 27:4") that is *not*
   in `allowedVerseRefs` — leaving it dangles an uncitable ref in front of the
   model. Headings keep their `[2]` / `(1/2)` suffixes verbatim (load-bearing for
   idempotency and for provenance snapshots).
6. **`loadSources` failure fails closed to `[]`** rather than falling back to raw
   source ids: a devotion asking for devotional voices must not silently receive
   JFB because the registry read failed.
7. **`study-insight` bumped to `-2026-08-06-v2`** — not called for by name in the
   plan, but its system composes the study system and its `buildMessages`
   inherits the new blocks, so both changed.

### Bugs found only against real data

**The lexicon block was empty on every chapter** (found by the first live smoke
run, which returned `LEXICON (0 entries)` for Psalm 27). Two independent causes,
each of which alone produced a silently empty block:

1. **Key-space mismatch.** `bible_interlinear.strongs` stores raw STEPBible
   dStrong values — zero-padded, suffixed, prefix-chained (`H0430`, `H3068G`,
   `H9003/{H7225G}`) — while `bible_strongs.strongs` stores bare OpenScriptures
   keys (`H430`, `H7225`). Joined raw, nothing ever matched and every code was
   dropped by the "no entry beats a blank gloss" rule. The repo already knew
   this: `src/notepad/study/lexicon/normalizeStrongs.ts` exists for precisely
   this join, and `scripts/etymology/seed-etymology.ts` applies it when
   enumerating Psalms Strong's. Fixed by mirroring the normalizer into
   `_shared/strongs-key.ts` (edge functions cannot import `src/`), following the
   `_shared/bible-books.ts` convention. **Its test imports both copies and
   asserts byte-parity on real-data fixtures**, so drift cannot recur silently.
2. **The cap was applied before resolution.** Looking up only the top 12
   frequency-ranked codes spends every slot on STEP prefix codes (H9xxx — the
   article, conjunction, prepositions), which are among a Hebrew chapter's most
   frequent tokens and have no OpenScriptures entry. The lookup now takes 4× the
   cap and cuts to 12 from the codes that *resolved*. This would have survived
   the first fix.

Why the unit tests missed it: the `study-context.test.ts` interlinear fixture
used pre-normalized values (`H216`), which cannot exist in the real table. The
fixture now uses raw dStrong values.

### Not yet verified (needs a deployed function + a real model call)

- A study reply on Psalm 27 naming a voice in prose ("Spurgeon reads this as…")
  while citing only allowed refs.
- A generated Today's Lamp naming no commentator while persisting
  `source_library_chunks`.

Both are deterministic-prompt changes covered by unit tests, but neither has been
observed end-to-end. Worth doing before or alongside slice 1d's eval harness,
which is the tool built for exactly this.

### Carried forward

- Lexicon cap of 12 is still a guess (plan open question) — tune once real
  prompts are inspected.
- `LEXICON_WORD_CAP = 1000` truncates Psalm 119 (~1,700 interlinear words), so
  its frequency ranking is drawn from the first ~59% of the chapter. Acceptable
  for a prompt heuristic; page it like `seed-etymology.ts` if it ever matters.
- Anchoring on *related passages* as well as chapter + cross-refs remains **no**
  for v1; revisit with 1d eval data.
