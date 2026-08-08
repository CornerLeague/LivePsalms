# Journey Thread 2a — the crisis layer, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before Lamplight gets more intimate with someone's journal, put a floor under it: a note written in crisis never becomes input to a generated reflection, and the reader meets a static, human-written response with real resources instead. Design: `docs/superpowers/specs/2026-08-07-journey-thread-design.md`.

**Architecture:** A two-stage detector (recall-tuned deterministic prefilter → a classifier whose only job is lament-vs-risk) writing to `note_distillates`, and a **gate at the point of use** — every path that puts note text in front of a model filters on the classification, failing closed when it is missing.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions/Deno) · the existing `lamplight_jobs` queue · `LLMAdapter` at the `fast` tier · vitest.

## Global Constraints

_Every task's requirements implicitly include this section._

- **The gate is at the point of USE.** The classification on the row is a cache. Every pipeline that reads notes asks; none assumes.
- **Unclassified fails CLOSED for generation, and NEVER for the user.** A pending note is invisible to the model; it saves, renders, syncs and searches exactly as now.
- **⚠️ Lament is not crisis.** This app exists for people writing their worst days. The likeliest failure is working too well. Every prompt change is measured against fixtures made of lament that must NOT trip.
- **The response copy is static, human-written and reviewed.** Never generated — a model that "sounds caring" is the failure mode, and generated copy cannot be reviewed before it is read.
- **Nothing is done to the note.** Not deleted, not hidden, not flagged back to the user as a problem with what they wrote.
- **TDD.** Failing test first; watch it fail; implement minimally; commit per task.
- **Branch:** `feat/crisis-layer`, cut from `origin/main`. Repo squash-merges.
- **Migration number: `062`.** Applied by hand via the SQL Editor before deploy — `db push` is broken on this machine.
- **Completion gate:** `npx tsc -b` clean · `npx vitest run` green (**4,268** at plan time) · `npx eslint .` at its **163-problem baseline**, not zero.
- **Do not trust numbers quoted in prose — check them against the code.** This initiative's own docs once asserted cross-references were loaded when the table held 0 rows, which quietly under-exercised all of Phase 1.

---

## ⚠️ Read before starting

**1. The gate has THREE sites, not one.** Note text reaches a model by three independent paths, and a filter in one covers none of the others:

| Path | Where |
|---|---|
| Today's Lamp + smoke test | `_shared/note-context.ts` → `retrieveNoteContext` (via `deps.fetchRecentNotes`) |
| Waymarks / monthly reflection | `lamplight-generate/monthly-reflection-context.ts` → `loadMonthNotes`, a direct `from('notes')` |
| Study chat | `lamplight-study/study-context.ts` ~:341, a direct `from('notes').in('id', noteIds)` |

The study path has a subtlety worth designing for rather than discovering: it **vector-searches first** (`searchUserNotesByQuery`, ~:335) and then fetches bodies by id. Filtering only at the body fetch means a crisis note can still occupy a slot in the top-`k` and silently displace a note that would have been shown. Filter before ranking, or over-fetch and filter down.

It also covers the user-initiated path for free: `selectOfferedNotes` (~:349) splits the same `relevant` array into `included` (sent to the model) and `offered` (shown to the reader as "bring them in?"). Filter `relevant` and a crisis note is neither included nor offered.

**2. ⚠️ THE BACKFILL MUST PRECEDE THE GATE, or every existing user loses Today's Lamp.**

The design says unclassified fails closed. Every note that exists today is unclassified. So the moment the gate turns on, every existing user's note context is empty — Today's Lamp short-circuits to `no_notes`, Waymarks to `no_notes`, study chat loses its note channel. Silently, and for everyone.

This is not a reason to fail open. It is a reason to **sequence**: the gate ships dark, the backfill runs to completion, and only then does the gate turn on. Task 7 is that ordering, and it is the one step in this plan where getting the order wrong is visible to every user at once.

**3. The response surface must not be reachable while the copy is a placeholder.** Same discipline the Insights doors used — a door stayed unregistered until its eval baseline was green, because a reader must not reach a surface with nothing behind it. Here: **a reader must not reach placeholder crisis copy.** The mechanism ships; the surface stays unreachable until Myles's reviewed copy lands (Task 8).

**4. `note_distillates` is created here with safety fields ONLY.** The design describes it as the home for 2b's distillate signals too. 2a creates the table and its safety columns; 2b widens it. One row per note, one place to look, one place to delete — and no rename later.

---

## Progress

**Tasks 1–6 done, plus the eval; Task 7's script written but unrunnable until migration 062 is applied.** Branch `feat/crisis-layer`. Gate: `tsc -b` clean, eslint at its 163 baseline, **4,318** tests (4,268 at plan time).

| Task | State | Note |
|---|---|---|
| 1 — migration 062 + gate predicate | done, **NEEDS MANUAL APPLY** | `note_distillates`, safety fields only, RLS mirroring `notes` |
| 2 — lament fixtures | done | 19 fixtures, 16 must-not-trip vs 3 risk |
| 3 — prefilter | done, **design changed** | see below |
| 4 — classifier | done | fails CLOSED, the inverse of the doctrinal one |
| — eval script | done, **measured** | `2026-08-08-crisis-v1-unmitigated`, 0 false positives / 16 |
| 5 — classification job | done | its own kind, its own retries |
| 6 — the three gate sites | done, **shipped dark** | deps optional and unset |
| 7 — backfill then flip | **done** | 062 applied; 38 notes classified; gate wired at all 3 sites |
| 8 — response surface | **BLOCKED ON MYLES** | copy + regional resources. Nothing renders yet |
| 9 — completion gate | **not started — needs the deploy** | see the warning below |

### Decisions made while implementing, that are not in the design

- **⚠️ THE PREFILTER CANNOT GATE THE CLASSIFIER, and the corpus proved it on the first run.** The plan had it gate — hits go to the model, misses skipped. Measured, it hits 2 of 3 true positives and misses `risk-preparation` **entirely**, because that entry contains no crisis phrase at all: affairs put in order, a possession given away, a sudden calm. Adding "preparation" phrases does not fix it — sorting paperwork is ordinary journalling. **Every note goes to the classifier**; the prefilter keeps only measurement and a deterministic fallback. The test asserts the limitation so nobody "fixes" it in the way that makes it worse.
- **The classifier fails CLOSED — the inverse of `makeDoctrinalClassifier`**, which fails open so generation never hinges on a second model call. Inheriting that would have been a silent hole. `failedClosed` is carried separately from the verdict so a model outage never reads as a spike in real risk.
- **⚠️ The uncertainty policy and the response copy are ONE DECISION IN TWO FILES.** On genuine uncertainty the classifier chooses `risk`, which is only tolerable because the response is an OFFER (confirm-then-resource). If Task 8's copy asserts something about the reader, this must invert. Recorded in both files; Task 8's author owns both.
- **A `failedClosed` verdict is never persisted**, by the job or the backfill. It would permanently withhold an ordinary note and inflate the risk rate at once. The note stays unclassified, which is already the safe state.
- **Site 3 filters before the bodies are fetched.** Study chat ranks first, so filtering after the fetch would let a withheld note keep its top-k slot and silently cost the reader a note that would have been shown.
- **`borderline` on a fixture, capped at two by test.** `burnout-unmitigated` returned risk 3/6 then 5/6 on identical calls while the canonical laments were 0/6 — the model is stable where it matters and genuinely undecided where the fixture was pre-labelled borderline. Borderline fixtures are now **sampled 6× and reported as a rate**, because one call at the line is not a measurement and a future "regression" there may be noise.
- **The v1 baseline was softer than it looked, and checking paid.** Five of eight lament fixtures handed the classifier a protective statement ("I am not planning anything"). Stripped variants were added; 0 false positives across 16 held anyway.

### The backfill, run 2026-08-07

Migration 062 applied by Myles. `--apply` classified **38 notes for ~$0.02**; `--verify` reports zero remaining unclassified, which is what made the gate safe to wire.

| | |
|---|---|
| ok | 37 |
| lament | 1 |
| risk | 0 |
| prefilter hits | 0 |
| classified by the model | 32 (6 empty notes short-circuited) |

⚠️ **n=38 says almost nothing, and the numbers must not be read as if it did.** Zero risk across 32 classifications is reassuring, not evidence; 2.6% lament on one small vault is a data point, not a base rate. Running it now bought a safe gate flip, not an answer to the question the slice exists to ask. That answer comes from real usage.

`store: false` was confirmed unconditional and test-pinned before 38 personal journal entries were sent to a model.

### ⚠️ THE GATE IS LIVE IN CODE, NOT IN PRODUCTION

The deps are wired at all three sites **on this branch**. `lamplight-generate` and `lamplight-study` have **not** been redeployed, so no reader is affected yet. A commit message saying "gate turned on" means the code path, not production.

The deploy is Task 9, and it is deliberately held until the copy lands so 2a ships whole — a deployed gate that withholds notes while showing the reader nothing would be the worst of both halves.

### Still to do

1. **Task 8's copy** — the reviewed response text and the regional resource list. ⚠️ It also decides the classifier's uncertainty policy: `risk`-on-uncertainty is only tolerable under confirm-then-resource phrasing. One decision, two files.
2. **Task 9** — deploy both functions, then the completion gate.
3. Then the PR.

---

## File Structure

**New (server):**
- `supabase/migrations/062_note_distillates.sql` — table + RLS mirroring `notes` (Task 1).
- `supabase/functions/_shared/crisis-terms.ts` — the recall-tuned prefilter list (Task 3).
- `supabase/functions/_shared/crisis-classifier.ts` — the lament/risk classifier, shaped after `makeDoctrinalClassifier` (Task 4).
- `supabase/functions/_shared/note-safety.ts` — `isWithheldFromGeneration()`, the one predicate all three gate sites call (Task 6).

**New (client):**
- `src/notepad/components/lamplight/CrisisResponse.tsx` — the static surface (Task 8, **unreachable until the copy is real**).

**New (scripts):**
- `scripts/backfill-note-safety.ts` — dry-run by default, mirroring the ingest scripts (Task 7).
- `scripts/eval-crisis.ts` fixtures under `docs/lamplight/evals/` — the lament corpus (Task 2).

**Modified:**
- `_shared/note-context.ts`, `lamplight-generate/monthly-reflection-context.ts`, `lamplight-study/study-context.ts` — the three gate sites (Task 6).
- `_shared/process-job.ts` + `embed-note/index.ts` — the new job kind (Task 5).
- The consent surface — the "not a crisis service" disclosure (Task 8).

---

## Task 1 — Migration 062: `note_distillates`, safety fields only

- [ ] Table keyed one row per note: `note_id` (PK, FK → `notes` on delete cascade), `user_id`, `safety_class`, `classified_at`, `classifier_version`, `prefilter_hit` (boolean, for measuring precision later).
- [ ] `safety_class` check: `('ok', 'lament', 'risk')` — **`lament` is recorded distinctly from `ok`**, so the false-positive rate is measurable rather than inferred.
- [ ] RLS mirroring `notes` exactly: owner-only select/insert/update/delete. Derived personal data inherits every protection the source has.
- [ ] Failing test: the gate predicate treats a missing row and `risk` identically, and `ok`/`lament` as generatable.
- [ ] Apply by hand via the SQL Editor; verify with an anon select returning `200 []`.

**Requirements:** `lament` must be its own class, not folded into `ok`. It is the number that tells us whether §1.3's fear is materialising, and a schema that cannot express it cannot measure it.

## Task 2 — The lament fixtures, BEFORE any classifier prompt

- [ ] Author journal-entry renderings of **Psalm 88, Psalm 42, Lamentations 3, Job 3** in a user's own voice — first person, undated, no verse citations.
- [ ] Add hard-case entries: grief after a death, a doubt spiral, burnout, a marriage in trouble.
- [ ] Add true-positive fixtures for the other side of the line, written soberly and minimally.
- [ ] Failing test: the fixture corpus loads and every entry carries an expected class.
- [ ] Check the corpus in under `docs/lamplight/evals/`.

**Requirements:** fixtures come **first** — `eval-harness-discipline`: build the fixture before changing a live prompt, because a green run is not a good reply. **If Psalm 88 in someone's own words trips the detector, the detector is wrong**, and this task is what makes that a test rather than a hope.

## Task 3 — The prefilter that decides nothing

- [ ] `crisis-terms.ts` alongside `BANNED_PHRASES` / `CONTESTED_PASSAGES` in the house's list home.
- [ ] Tuned for **recall**: it may over-trigger freely.
- [ ] Failing test: it fires on the true-positive fixtures.
- [ ] Failing test: **it is allowed to fire on lament fixtures too** — and doing so suppresses nothing on its own.
- [ ] Failing test: nothing downstream reads the prefilter's verdict as a decision.

**Requirements:** the prefilter exists to save classifier calls, not to make judgements. Its only power is to skip the classifier for text that is obviously neither.

## Task 4 — The classifier: lament vs risk

- [ ] Shape it after `makeDoctrinalClassifier` (`_shared/doctrinal-classifier.ts`) — same `fast` tier, same injected-`LLMAdapter` shape, same testability.
- [ ] Its **entire** job is the distinction. The system prompt says so, and says what lament is.
- [ ] Failing test: every lament fixture classifies as `lament`, not `risk`.
- [ ] Failing test: a transport error or malformed response classifies as **`risk`** — fail closed, since an unavailable classifier must not become an open door.
- [ ] Measure against the Task 2 corpus and check the report in.

## Task 5 — Classification on save, riding the existing queue

- [ ] A new `lamplight_jobs` kind. **Do not build a second queue** — `embed-note` already fires on exactly this event, per save from the browser and on the pg_cron sweep.
- [ ] Failing test: a note save enqueues the job; the sweep drains it; the row lands in `note_distillates`.
- [ ] Failing test: re-running for the same note is idempotent.
- [ ] Failing test: a failed job leaves the note **unclassified**, which the gate reads as withheld.

## Task 6 — The gate, at all three sites

- [ ] `note-safety.ts` exports one predicate. Three call sites, one rule.
- [ ] Failing test per site: an unclassified note is withheld; a `risk` note is withheld; `ok` and `lament` pass.
- [ ] **Study path:** filter before ranking (or over-fetch and filter down) so a withheld note cannot occupy a top-`k` slot and displace a shown one.
- [ ] Failing test: a withheld note is neither `included` nor `offered` by `selectOfferedNotes`.
- [ ] Failing test: **the user's own reading of their notes is untouched** — the gate is invisible outside generation.

**Requirements:** ship this **dark** — behind a flag, defaulting off. Task 7 turns it on.

## Task 7 — Backfill, THEN turn the gate on

- [ ] `scripts/backfill-note-safety.ts`, dry-run by default, reporting note count and estimated cost before spending anything.
- [ ] Run to completion. Verify zero unclassified notes remain.
- [ ] **Only then** flip the gate on.
- [ ] Failing test: the script is idempotent and resumable.

**Requirements:** ⚠️ this ordering is the one step whose reversal is visible to every user simultaneously — see *Read before starting* §2. A gate turned on over an unclassified corpus empties every AI surface at once.

## Task 8 — The response surface and the consent disclosure

- [ ] `CrisisResponse.tsx` renders from a **constant**, never a model.
- [ ] The copy ships as an obvious placeholder, and the surface is **unreachable** while it is one — the same ordering the Insights doors used.
- [ ] Failing test: the component renders the constant verbatim and makes no network call.
- [ ] Add the **"Lamplight is not a crisis service"** disclosure at consent, not buried in settings.
- [ ] ⚠️ **Blocked on Myles:** the reviewed copy, and the resource list — including which regions. A US-only helpline list is wrong for a global app, and a wrong number is worse than none.

## Task 9 — Completion gate

- [ ] `npx tsc -b` clean · `npx eslint .` at its 163 baseline · `npx vitest run` green.
- [ ] Migration 062 applied; backfill complete; gate on.
- [ ] Redeploy `lamplight-generate`, `lamplight-study`, `embed-note`.
- [ ] Report the **`lament` rate** from the backfill — the first real measurement of whether §1.3's fear is materialising.

---

## What 2a deliberately does not do

- **No distillate signals** — themes, posture, questions, scripture engaged are 2b.
- **No Journey Thread** — 2c.
- **No changes to what the model does with notes it may see.** 2a only decides which notes it sees.
- **No clinical claim.** This is a signposting layer. The disclosure says so.

## Follow-ups this plan may surface

- The `lament` rate may argue for tuning the prefilter's recall down, or for a third class.
- If the backfill's cost is material at scale, distillation (2b) should batch with it rather than re-reading every note twice.

---

*Prepared 2026-08-07. Design: `docs/superpowers/specs/2026-08-07-journey-thread-design.md`. Brainstorm: `2026-08-04-lamplight-depth-brainstorm.md` §5, §9, §13.12.*
