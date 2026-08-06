# Study Insights B2 — The Passage door, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Door 1 — Overview · In the Chapter · The Chapter's Shape · Reflection & Application — as a globally cached, explicitly generated, streamed artifact. Design: `docs/superpowers/specs/2026-08-06-study-insights-b2-design.md`.

**Architecture:** A new pipeline composing **study grounding** (`buildStudyContext`) with a **devotion-style multi-field emit** (four bounded fields, not one `reply` string). Cached rows are public-read and free; generation is Plus/promo-gated and deliberately *not* counted against the reader's quota. Sections stream.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions/Deno) · OpenAI Responses API via the existing `LLMAdapter` · React + TypeScript client · vitest for everything including the edge-fn logic modules.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Every generated field gets a word target AND a ceiling, with the ceiling ~1.45–1.5× above the target in characters.** Ceilings are DERIVED from targets by `ceilingFor()`, never hand-set beside them. This is not style. A ceiling with no target is what truncated study-chat replies at exactly 1400 characters, mid-word, with corrupted output at the boundary (`2026-08-06-study-baseline`). Bounds without targets are a bug waiting to be found by a reader.
- **Reuse the validator stack wholesale** — citation allowlist, banned phrases, `verifyArtifactScripture` (repair before reject), Layer C classifier. Library excerpts never widen `allowedVerseRefs`.
- **Door 1 keeps the standard contested-passage rejection.** It does NOT set `allowContestedRefs`. That exemption exists for a reader asking a direct question; Door 1 is descriptive, generated once, and served to everyone.
- **Cached reads are public and free.** No entitlement check on the read path — same contract as `bible_etymology_verse_insight`.
- **Omission is first-class.** A section with no warrant returns empty and renders nothing. No placeholder, no apology.
- **Completion gate MUST run `npx tsc -b`** (not just `eslint` + `vitest`) — a prod-build type error hides behind passing lint and tests.
- **TDD.** Write the failing test first; watch it fail; implement minimally; watch it pass; commit per task.
- **Branch:** `feat/study-insights-b2`, cut from `origin/main`.
- **Migration number: `060`.** Applied manually via the SQL Editor before deploy — `db push` is broken on this machine.
- **The door stays unregistered in the client until Task 9 is green.** Tasks 1–7 are server-only and independently verifiable; a reader must not reach a surface with no eval baseline.

---

## ⚠️ Read before starting

`streamBibleChat` is **not** the right seam despite what the design's first draft implied. It is thread-shaped: it upserts a `lamplight_chat_threads` row, persists user and assistant messages, and takes `mode: 'chat' | 'insight'`. B2 has no thread and no messages — it writes cache rows.

The reusable layer is one below: **`generateStreamingWithRetry`** (`_shared/generate-streaming.ts`), which already takes `textFields` and emits per-field deltas. B2 supplies its own SSE shell around it.

---

## File Structure

**New (server):**
- `supabase/migrations/060_passage_insight.sql` — table + RLS (Task 1).
- `supabase/functions/_shared/quota.ts` — a fourth scope; **modified**, see Task 2.
- `supabase/functions/lamplight-study/prompts/passage-insight.ts` — prompt + four-field tool (Task 3).
- `supabase/functions/lamplight-study/passage-insight-pipeline.ts` — grounding + emit + validate (Task 5).
- `supabase/functions/lamplight-study/passage-insight-cache.ts` — read/write, pure-testable (Task 6).
- `supabase/functions/lamplight-study/passage-insight-stream.ts` — **added in Task 7, not in the original plan:** the Node-testable orchestration (cache read → gate → stream → write) plus the request/cache-key contract. A Deno shell cannot be unit-tested; see the decisions below.
- `supabase/functions/passage-insight/index.ts` — edge-fn shell: dep wiring only (Task 7).

**New (client):**
- `src/notepad/study/insights/usePassageInsight.ts` — cached read + generate (Task 8).
- `src/notepad/study/insights/PassageDoor.tsx` — the four sections, two render paths (Task 8).

**New (scripts):**
- `scripts/refresh-passage-insights.ts` — targeted regeneration with `--dry-run` (Task 10).

**Modified:**
- `supabase/functions/lamplight-study/study-context.ts` — verse-scope anchors + neighbour text (Task 4).
- `src/notepad/study/insights/doors.tsx` — register the door (Task 9).
- `scripts/eval-lamplight.ts` + fixtures — `passage-insight` artifact kind (Task 9).

---

## Task 1 — Migration 060: the cache table

- [x] Write `060_passage_insight.sql`: the table from the design §3, public-read RLS, service-role write, and an index on `(scope, ref_id, door)` so a whole door loads in one query.
- [x] `check (scope in ('verse','chapter'))` and `check (door in ('passage'))` — B3 widens the door check when it adds `'deeper'`. A narrow check now is a cheap guard against a typo writing rows nobody reads.
- [x] **Applied 2026-08-06** by Myles via the SQL Editor. Verified from the repo with an anon-key select against `bible_passage_insight`: HTTP 200, `[]` — the table exists, public-read RLS is live, and no rows are warmed yet.

**Requirements:** `primary key (scope, ref_id, section)`. Store `prompt_version` and `model_used` per row — Task 10's targeted refresh is impossible without them.

## Task 2 — A quota scope that does not charge the user

- [x] Failing test: a scope with `perUser: null` skips the per-user check entirely and still enforces the global ceiling.
- [x] Failing test: an empty `kinds` array still throws. The existing invariant — *"a misconfigured scope must block, not pass"* — must survive this change.
- [x] Widen `QuotaScope.perUser` to `Record<Tier, number> | null`; `checkQuota` skips the user check when null.
- [x] Add a `passageInsight` scope with `kinds: ['passage_insight']`, `perUser: null`.
- [x] Failing test: `countGlobalUsage` counts the new kind, so a warmed-cache spree still trips the global ceiling.

**Requirements:** usage rows ARE still written — cost must stay visible on the admin dashboard. "Not quota-counted" means not counted against the *user*, never unbounded.

## Task 3 — Prompt + four-field tool

- [x] Failing test: the tool declares exactly four fields, each with `minLength` and `maxLength` matching design §1.
- [x] Failing test: each ceiling sits well above the top of its stated word target (asserted at >1.4×) — the headroom that keeps a ceiling a backstop rather than a target.
- [x] Failing test: the system prompt states a word target for every field by name. A field with a bound and no target is the truncation bug.
- [x] Failing test: `buildMessages` renders the study grounding blocks (passage, book context, cross-refs, library voices, lexicon) and, at verse scope, the neighbouring verses.
- [x] Implement, with `promptVersion: 'passage-insight-2026-08-XX-v1'`.

**Requirements:** the voice rules and citation rules are inherited from `STUDY_CHAT_PROMPT.system`'s established phrasing where they apply — do not rewrite them from scratch and let them drift. Do **not** set `allowContestedRefs`.

## Progress

**Tasks 1–7 complete, 2026-08-06.** Branch `feat/study-insights-b2`, draft PR #115. Gate at last push: 3,945 tests, `tsc -b` clean, lint at its 163-problem baseline.

| Task | State | Commit |
|---|---|---|
| 1 — migration 060 | **APPLIED 2026-08-06** | `2ac36bf9` |
| 2 — uncharged quota scope | done | `2ac36bf9` |
| 3 — prompt + four-field tool | done | `350aba75`, amended by Task 5 (citations) |
| 4 — verse-scope grounding | done | `8ed1cd3c` |
| 5 — the pipeline | done | `d01d56dc` |
| 6 — cache read/write | done | `e7d34c88` |
| 7 — edge function | done, **NOT DEPLOYED** | see below |
| 8 — client hook + door | **next** | — |

**Nothing has run live yet.** Migration 060 is applied and the corpus is empty (0 rows); the `passage-insight` function has never been deployed, so no door has been generated against a real model. Every claim about B2 so far rests on unit tests. Deploy is a prerequisite for Task 9's live eval sweep, not just for Task 11.

### Decisions made while implementing, that are not in the design

- **`ceilingFor()` derives ceilings from word targets** rather than hand-setting them. The design claimed a "1.6–2×" ratio; the real arithmetic on those bounds was ~1.25×. `CHARS_PER_WORD = 6.4` is **measured** (6.41 mean across the four replies in `docs/lamplight/evals/2026-08-06-contested-exempt/`), not assumed. Authoritative in `prompts/passage-insight.ts`.
- **`minLength: 0` on every section field.** A section with no warrant must return empty; requiring a character would force filler exactly where the model has nothing grounded to say.
- **Shared rules are composed, not paraphrased.** `STUDY_GROUNDING_RULES` and `renderStudyGrounding` are exported from `prompts/study-chat.ts` and used by both surfaces. Verified byte-identical after extraction (2,870 chars before and after), which is why `study-chat`'s `promptVersion` legitimately did not bump.
- **`BibleChatContext.focusVerses`** was added in Task 3 (the prompt renders it); **Task 4 is what populates it**.
- **Focus neighbours are counted in ROWS, not verse numbers.** `bible_passages` genuinely stores multi-verse rows (`psa 27:5-6`), so verse arithmetic would slice through one and ask for text that has no row. `FOCUS_NEIGHBOURS = 2` either side of the row containing the selection; clamping is then just array-slice clamping. `selectFocusVerses` in `study-context.ts` is the authority.
- **Verse scope narrows the library anchor, NOT `allowedVerseRefs`.** The whole chapter text is still supplied, so the whole chapter stays citable — *The Chapter's Shape* cites across the chapter constantly, and a narrowed allowlist would make that section unwritable. Design §2 only ever asked for the anchor.
- **A verse in no row of its chapter degrades to chapter grounding**, with a `console.warn`. Narrowing an anchor onto a verse that does not exist would blank the library rather than widen it; a bad `ref_id` should cost a warning, not the door.
- **⚠️ Task 5 added a `citations` array to the four-field tool — Task 3's "exactly four fields" no longer holds.** The plan and design both require the citation allowlist, but `validateChatReplyCitations` reads a *structured* array and the Task 3 tool had none, so the allowlist was enforcing nothing. Verse-only — `type: { enum: ['verse'] }` — because Door 1 is a public asset with no reader's notes in scope, unlike study chat. Door-level rather than per-section: the sections must stay plain strings for `textFields` per-field streaming (D3), and a door is cached and invalidated as a unit anyway.
  - **Correction, made in Task 6:** the Task 5 note also claimed `bible_passage_insight.sources` had nothing else to fill it. That was wrong — migration 060's own comment reads `-- library chunk provenance`, matching `lamplight_artifacts.source_library_chunks`. `sources` stores the library snapshot; **citations are validation-only in B2 and are not persisted.** If a reader-facing "verses this door leaned on" list is wanted later, that is a new column or a widened `sources` shape, not a reinterpretation of this one. The case for adding `citations` stands on the allowlist alone.
- **`promptVersion` stays at `v1`.** The tool and system prompt changed in Task 5, but `PASSAGE_INSIGHT_PROMPT` was unreachable from any generation path in the Task 3 commit, so no row can exist under a v1 that means anything else. v1 names the first prompt that can actually generate. Bump normally from here.
- **Section keys are read defensively.** `sectionsOf()` normalises a missing or non-string field to `''` rather than trusting the schema's `required`. Omission and emptiness are the same first-class answer, and the four-bound design's whole point is that a section can legitimately have nothing in it.
- **The atomic write is one multi-row upsert, not a transaction.** A single statement cannot half-land, which is what "either the whole door or nothing" needs; Supabase's JS client has no transaction API to reach for anyway. Both cache functions **throw** rather than returning a soft failure — a read that reported `null` on a transport error would send the reader to the generate path and re-bill a warm door, and a write that swallowed its error would let the terminal `done` beat tell the client a door is cached when no row landed.
- **Task 7 needed a fourth file the plan's File Structure does not list: `lamplight-study/passage-insight-stream.ts`.** Every Task 7 bullet is a *failing test*, and a Deno `index.ts` calling `serve()` at module scope cannot be imported by vitest. Split exactly as `daily-devotion-stream.ts` + `index.ts` and `etymology-insight/insight-body.ts` + `index.ts` already are: orchestration is Node-testable with injected deps, the shell is wiring. It lives beside the pipeline and cache so all four Door 1 modules sit together; `passage-insight/index.ts` imports across directories, which `lamplight-study/index.ts` already does.
- **The stream module takes the whole `QuotaConfig`, not a pre-bound `checkQuota` closure** (which is what `daily-devotion-stream.ts` does). Choosing the `passageInsight` scope IS decision D1; bound in the Deno shell it would be the one part of D1 no test could reach. Taking the config lets the test drive real `checkQuota` and assert that `countUserUsage` is never even *called*.
- **⚠️ `tsc -b` does not typecheck edge functions.** `tsconfig.app.json` includes only `src`, so the gate's type check covers none of `supabase/functions`. The Door 1 logic modules are at least exercised by vitest; the Deno shell is neither typechecked nor tested by the gate. Checked manually with a standalone `tsc --noEmit --allowImportingTsExtensions` run: the only errors in `passage-insight/index.ts` are the `deno.land` import and the `Deno` global, i.e. exactly what `lamplight-study/index.ts` produces. That is a one-off check, not a standing guard.
- **⚠️ B3 landmine: `door` is not in the primary key.** `primary key (scope, ref_id, section)` means `('chapter','psa.27','overview')` is unique across ALL doors, so if B3's Deeper door ever names a section the Passage door also names, the two collide and overwrite each other. B3's four sections (Hermeneutics, Theology, Read With Care, Historical Background) don't collide today, but the constraint is one careless section name away from silent data loss. Fix by widening the PK to include `door` when B3 lands.

## Task 4 — Verse-scope grounding

- [x] Failing test: with a verse scope, `libraryAnchors` narrows to that verse (plus resolved cross-ref targets), not the whole chapter.
- [x] Failing test: neighbouring verse text is supplied, clamped at chapter boundaries.
- [x] Failing test: chapter scope is byte-identical to today — this must not change study chat.
- [x] Extend `buildStudyContext` with an optional verse scope.

## Task 5 — The pipeline

- [x] Failing test: composes study grounding with the four-field emit and returns all four sections.
- [x] Failing test: runs the full validator stack — citations, content rules, Scripture verification with repair.
- [x] Failing test: a contested-passage violation fails the generation (Door 1 keeps the rejection).
- [x] Failing test: a section the model returns empty is preserved as empty, not defaulted to filler.
- [x] Failing test: on `validators_failed`, the result carries its violations — the lesson from #114, applied at birth rather than retrofitted.
- [x] Implement over `generateWithRetry` for the buffered path.

## Task 6 — Cache read/write

- [x] Failing test: a read returns rows regardless of `prompt_version` (D2 — serve stale, never block a reader).
- [x] Failing test: a read returns `null` when the door has no rows, distinguishable from a door whose sections are all legitimately empty.
- [x] Failing test: a write upserts all four sections atomically, stamping `prompt_version`, `model_used`, `created_by`.
- [x] Failing test: a partial write never lands — either the whole door or nothing.
- [x] Implement as a pure-ish module taking a Supabase client, so it is testable without the edge shell.
- [x] **Also:** refuses an all-empty door (the hole Task 5 left open, closed here).
- [x] Column names in both paths checked against the LIVE table, not just the fake — an anon select of every column the read selects and every column the write sends returns 200, as do all three read filters.

## Task 7 — Edge function

- [x] Failing test: a cache hit returns immediately with **no entitlement check and no model call**.
- [x] Failing test: a cache miss without Plus/promo returns the gate reason and generates nothing.
- [x] Failing test: a cache miss with Plus/promo streams sections and writes the cache on the terminal `done` beat.
- [x] Failing test: an interrupted stream writes nothing — the door stays uncached, mirroring how study chat declines to commit an interrupted reply.
- [x] Failing test: the global quota ceiling still gates generation; the per-user allowance does not.
- [x] Implement using `generateStreamingWithRetry` with `textFields` set to the four section names, inside a fresh SSE shell (**not** `streamBibleChat` — see the note above).
- [ ] **NOT DONE — `passage-insight` has never been deployed.** Nothing has run against a real model or written a real cache row. Task 11's live checks are the first time this executes.

## Task 8 — Client: hook + door

- [ ] Failing test: `usePassageInsight` reads the cache on open and never triggers generation on its own.
- [ ] Failing test: a cached door renders immediately — no spinner, no stream.
- [ ] Failing test: an uncached door renders *Study this passage*; pressing it streams sections in.
- [ ] Failing test: sections appear as they arrive rather than all at once on completion.
- [ ] Failing test: an empty section renders nothing at all — no heading, no placeholder.
- [ ] Failing test: signed-out or non-entitled readers see cached content but not the generate action.
- [ ] Implement.

## Task 9 — Eval coverage, then registration — in that order

- [ ] Add `'passage-insight'` to the harness `ArtifactKind` union and drive it live.
- [ ] Reuse the study-chat fixture shape; add a verse-grain fixture so both grains are exercised.
- [ ] **Grounding floors apply unchanged** — the check that would have caught the empty cross-reference table.
- [ ] New per-section assertions: every expected section is non-empty, and none ends mid-word (assert the final character is terminal punctuation).
- [ ] Run a live sweep; check the report into `docs/lamplight/evals/`.
- [ ] **Only once that baseline is green:** register the door in `doors.tsx` so readers can reach it.

**Requirements:** #114 exists because a surface shipped with no eval and a retrieval channel went dark for months. The ordering in this task is the whole point of it.

## Task 10 — Refresh script

- [ ] Failing test: selects rows whose `prompt_version` is behind current, filtered by scope/ref.
- [ ] Failing test: `--dry-run` reports row count and estimated cost, and writes nothing.
- [ ] Implement, mirroring the ingest scripts' reporting discipline. Carries the Node 20 `createIngestClient` treatment — every other ingest script needed it.

## Task 11 — Completion gate

- [ ] `npx tsc -b` clean · `eslint .` at its baseline · `vitest run` green.
- [ ] Live check on a Psalm (dense coverage), a non-Psalm OT chapter (thin), and a verse scope.
- [ ] Confirm a second reader gets the cached door instantly, with no generation and no entitlement prompt.
- [ ] Confirm an interrupted generation leaves the door uncached rather than half-written.
- [ ] Runbook note or design-doc update recording the applied migration date and the first warmed passages.

---

## What B2 deliberately does not do

- **No Lamplight handoff.** The seeded-prompt seam defers to B4 (design D4).
- **No Door 2.** Hermeneutics, Theology, Read With Care, Historical Background are B3.
- **No precompute sweep.** Warming is on-demand until real usage shows where readers concentrate.
- **No cache invalidation on prompt bump.** Serve stale, refresh deliberately (D2).

## Follow-ups this plan may surface

- If per-section streaming makes the four-field tool awkward under `generateWithRetry`'s stricter-retry, consider whether a failed section can be regenerated alone rather than the whole door. Do not build that speculatively.
- The `door` check constraint needs widening in B3; note it there rather than pre-widening now.
- ~~A door whose four sections all come back empty…~~ **Closed in Task 6:** `writePassageDoor` returns `{ written: false, reason: 'empty_door' }` and writes nothing. Task 7 must surface that on the `done` beat so the client knows the door is still uncached rather than reporting a successful generation.

---

*Prepared 2026-08-06. Design: `docs/superpowers/specs/2026-08-06-study-insights-b2-design.md`. Builds on #112 (B1), #113 (cross-references), #114 (eval + prompt hardening).*
