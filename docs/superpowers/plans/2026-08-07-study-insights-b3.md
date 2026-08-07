# Study Insights B3 — the *Deeper In* door, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Door 2 — How to Read This Passage · Historical & Cultural Setting · Theological Significance · Read With Care — through the same globally-cached, explicitly-generated, streamed machinery Door 1 uses, by making that machinery door-generic first. Design: `docs/superpowers/specs/2026-08-07-study-insights-b3-design.md`.

**Architecture:** B2's Door-1 pipeline becomes a door-generic engine parameterised by a door spec, along one line — **generic if it is mechanism, per-door if it is editorial** (design §1). One edge function, one table, one quota bucket, one cache contract; two doors. Door 2 adds two things Door 1 has not: a section-scoped content rule enforcing §9's Read With Care constraint, and a measured attribution requirement on its theology section.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions/Deno) · OpenAI Responses API via the existing `LLMAdapter` · React + TypeScript client · vitest for everything including the edge-fn logic modules.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Door 1 must be provably unchanged by the refactor.** Its SYSTEM string and serialized tool schema are byte-identical before and after, and `promptVersion` does not move. This is a test, not a review — see Task 2. If a byte moves, either the move is wrong or Door 1 needs a version bump and a fresh live baseline.
- **Every generated field gets a word target AND a ceiling, derived by `ceilingFor()`, never hand-set.** The lesson of the 1400-char mid-word truncation. `ceilingFor` moves modules in Task 2 but does not change.
- **Reuse the validator stack wholesale** — citation allowlist, banned phrases, `verifyArtifactScripture` (repair before reject), Layer C classifier. Library excerpts never widen `allowedVerseRefs`.
- **Door 2 keeps the standard contested-passage rejection.** It does NOT set `allowContestedRefs`. Settled (Myles, 2026-08-07); do not relitigate. Its consequence has a fixture — Task 7.
- **§9's Read With Care constraint is a hard rule.** Forbidden is any caution aimed at a tradition, denomination or group. Task 4 is how that stops being a style note.
- **Cached reads stay public and free.** No entitlement check on the read path, for either door.
- **Omission is first-class.** A section with no warrant returns empty and renders nothing. Door 2 will hit this more often than Door 1 did.
- **Completion gate MUST run `npx tsc -b`** as well as `eslint` and `vitest` — and note that `tsc -b` covers only `src`. Anything under `supabase/functions` needs a deliberate check (see *Read before starting*).
- **TDD.** Write the failing test first; watch it fail; implement minimally; watch it pass; commit per task.
- **Branch:** `feat/study-insights-b3`, cut from `feat/library-a1` — PR #117 was still open at plan time. Repo squash-merges; for a focused PR, branch off `origin/main` and cherry-pick rather than PR-ing a long-lived branch.
- **Migration number: `061`.** Applied manually via the SQL Editor before deploy — `db push` is broken on this machine.
- **Door 2 stays unregistered in `doors.tsx` until Task 10's live baseline is green.** Tasks 1–9 are server-side or unreferenced; a reader must not reach a surface with no eval baseline. This is #114's whole lesson.
- **Do not trust numbers quoted in prose — check them against the code.** That rule has already caught a "1.6–2×" ratio claim that survived three documents and a merged PR.

---

## ⚠️ Read before starting

**1. A defect was found and fixed while designing B3, and PR #117 still carries it.**

`supabase/functions/passage-insight/index.ts` referenced `DOOR_REGISTERS`, an identifier defined nowhere, on Door 1's generate path. Introduced by `a7572bc8` in the same hunk as the comment block explaining that Door 1 deliberately takes *no* register filter — a leftover from the measurement whose constant was deleted. Fixed on this branch in `867445b0` by removing the line (not by defining it as `[]`: `inRegister` reads `!args.registers || args.registers.includes(...)`, and an empty array is truthy, so `[]` would blank the library channel rather than leave it unfiltered).

**Why nothing caught it, which is the part that matters for B3:**

- `tsc -b` covers only `src` — `tsconfig.app.json` includes nothing under `supabase/functions`;
- the eval harness drives `runPassageInsightPipeline` directly and never loads the edge-fn shell;
- the deploy boot check (401 unauthenticated / 400 bad body) returns before `buildContext` runs;
- `bible_passage_insight` holds 0 rows, so no reader has ever reached the line.

B3 adds a `door` parameter to that same shell. **Every change to `supabase/functions/*/index.ts` in this plan is unguarded by the gate** and needs a deliberate `tsc --noEmit --allowImportingTsExtensions` pass, whose only acceptable errors are the `deno.land` import and the `Deno` global.

**2. The three B2 live checks have still never run.** `bible_passage_insight` holds 0 rows. End-to-end generate through the deployed function, a second reader getting the cached door instantly, and an interrupted generation leaving the door uncached are all unverified; `docs/runbooks/passage-insight.md` §6 is the procedure. B3 rides the same function, quota bucket and cache contract. **Run them before Door 2 registers** — Task 12.

**3. Migration 061 and the deploy must land together.** Widening the PK without moving `writePassageDoor`'s `onConflict` breaks Door 1's upsert (Postgres requires the conflict target to match a real unique constraint). The failure is loud rather than corrupting, and with 0 rows the window is harmless — but apply and deploy in the same sitting.

---

## File Structure

**New (server):**
- `supabase/migrations/061_passage_insight_door_key.sql` — PK widening + door check (Task 1).
- `supabase/functions/lamplight-study/prompts/insight-door.ts` — the shared mechanism: `InsightSection`, `CHARS_PER_WORD`, `ceilingFor`, section-tool construction, the three load-bearing tail sentences (Task 2).
- `supabase/functions/lamplight-study/prompts/deeper-insight.ts` — Door 2's spec and prose (Task 3).
- `supabase/functions/lamplight-study/insight-doors.ts` — the server door registry: id → prompt module, sections, `registers`, `libraryK` (Task 5).

**New (client):**
- `src/notepad/study/insights/insight-doors.ts` — the client registry: id → label, blurb, section keys + headings. The mirror of the server's section keys (Task 6).

**Modified (server):**
- `prompts/passage-insight.ts` — Door 1's spec only; mechanism moves out. **Exports and emitted bytes unchanged** (Task 2).
- `passage-insight-pipeline.ts` — takes a door spec instead of importing Door 1's constants (Task 2); gains per-section content rules (Task 4).
- `passage-insight-cache.ts` — sections become a parameter; `onConflict` widens (Tasks 1, 2).
- `passage-insight-stream.ts` — `door` joins the request contract and the cache calls (Task 5).
- `passage-insight/index.ts` — door lookup, per-door `registers` / `libraryK` (Tasks 5, 8).
- `_shared/voice.ts` — `TRADITION_TERMS` (Task 4).
- `_shared/validators.ts` — the `tradition_caution` stricter message (Task 4).

**Modified (client):**
- `passage-insight-stream-client.ts` — `door` in the POST body; section list comes from the registry (Task 6).
- `usePassageInsight.ts` → generic over `doorId` (Task 6).
- `PassageDoor.tsx` → generic section renderer (Task 6).
- `doors.tsx` — register Door 2 (Task 10, **not before**).

**Modified (scripts):**
- `scripts/eval-lamplight.ts` + fixtures — door dimension, `checkAttribution` (Task 7).
- `scripts/refresh-passage-insights.ts` — `--door` filter (Task 11).

---

## Task 1 — Migration 061: put `door` in the key

- [ ] Look up the door check constraint's **real** name first — an inline `check` in `create table` gets an auto-generated name. `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.bible_passage_insight'::regclass;`
- [ ] Write `061_passage_insight_door_key.sql`: drop and re-add the door check as `check (door in ('passage','deeper'))`; drop `bible_passage_insight_pkey` and add `primary key (scope, ref_id, door, section)`.
- [ ] Drop the now-redundant `bible_passage_insight_door` index — the new PK's index covers the `(scope, ref_id, door)` prefix.
- [ ] Failing test: `writePassageDoor` upserts with `onConflict: 'scope,ref_id,door,section'`.
- [ ] Apply by hand via the SQL Editor, then verify from the repo with an anon-key select (`200 []`), exactly as 060 was verified.
- [ ] Record the application date and the pre-existing row count in the runbook.

**Requirements:** the table holds **0 rows**, which is why this is free — no rewrite, no dedup, no backfill. It will never be cheaper. Do not defer it on the argument that B3's section keys don't collide with B2's; "no collision today" is not a constraint, and B2 wrote this landmine down precisely so B3 would close it.

## Task 2 — The generic seam, under a byte-identity gate

- [ ] **Failing test FIRST, before any extraction:** `PASSAGE_INSIGHT_PROMPT.system` and `JSON.stringify(PASSAGE_INSIGHT_PROMPT.tool)` equal checked-in snapshot strings, and `promptVersion === 'passage-insight-2026-08-06-v1'`. Capture the snapshots from the current code. **This test must pass before and after every commit in this task.**
- [ ] Move `InsightSection`, `CHARS_PER_WORD`, `ceilingFor` to `prompts/insight-door.ts`; re-export from `prompts/passage-insight.ts` so no downstream import breaks.
- [ ] Move the section-tool construction and the three tail sentences (length-and-finish · empty-is-legitimate · citations array) to `prompts/insight-door.ts` as shared pieces a door composes.
- [ ] Leave Door 1's system prose — preamble, contested sentence, section briefs — in `prompts/passage-insight.ts`, assembled there. **Do not build it from a template.** Design §1: sharing mechanism gets every safety property; sharing prose only gets fewer characters, and prompt prose is the thing this repo reviews line by line.
- [ ] Failing tests: the pipeline's six Door-1 constant imports become a parameter. `sectionsOf`, the flattener, per-section Scripture verification, `generateConfig`, and `textFields` all read the spec they are given.
- [ ] Failing test: `readPassageDoor` / `writePassageDoor` take the section list rather than importing Door 1's.
- [ ] Failing test: two different specs through the same pipeline produce two different section sets, with no leakage between them.

**Requirements:** Door 1 is live, registered, and has a checked-in live baseline. The byte-identity gate is what makes this refactor reviewable rather than trusted — the same discipline that let B2 extract `STUDY_GROUNDING_RULES` without bumping `study-chat`'s version. Commit the snapshot test on its own, first, so its history shows it existed before the extraction.

## Task 3 — Door 2's prompt module

- [ ] Failing test: the tool declares four fields — `hermeneutics`, `historical_setting`, `theology`, `read_with_care` — each with `minLength: 0` and a `maxLength` equal to `ceilingFor` of its word target.
- [ ] Failing test: every ceiling sits >1.4× above the top of its stated word target.
- [ ] Failing test: the system prompt states a word target for every field by name.
- [ ] Failing test: **no section key collides with Door 1's.** Belt and braces alongside Task 1's PK.
- [ ] Failing test: the prompt carries the contested-passage steering sentence and does **not** set `allowContestedRefs`.
- [ ] Implement with `promptVersion: 'deeper-insight-2026-08-XX-v1'`.

**Bounds (design §7 — a rendering of `ceilingFor`, authoritative in code):**

| Section | Target | Ceiling |
|---|---|---|
| `hermeneutics` | 110–180 | 1700 |
| `historical_setting` | 120–200 | 1900 |
| `theology` | 120–200 | 1900 |
| `read_with_care` | 70–130 | 1200 |

**Requirements:** voice and citation rules are **composed** from `STUDY_GROUNDING_RULES`, never paraphrased — the drift B2 avoided. *Read With Care* is deliberately the shortest section: it lists moves the passage does not support, and a long one is a prompt to invent the fourth and fifth.

## Task 4 — §9 becomes mechanical: per-section content rules

- [ ] Failing test: `applyContentRules` (or the pipeline's composition of it) can apply a rule set to **one section** rather than the flattened door.
- [ ] Add `TRADITION_TERMS` to `_shared/voice.ts` — modern tradition and denomination names, alongside `BANNED_PHRASES` / `CONTESTED_PASSAGES` / `GROWTH_BANNED_PHRASES`.
- [ ] Failing test: a `read_with_care` body naming a denomination raises `family: 'banned'`, `rule: 'tradition_caution'`.
- [ ] Failing test: the **same sentence in `theology` does not raise it** — that section is required to name whose reading it is giving. A door-wide check would forbid in one section exactly what another demands.
- [ ] Failing test: biblical-era groups (Pharisees, the circumcision party) do not trip it.
- [ ] Add a specific stricter-retry message for `tradition_caution` rather than reusing the generic `banned` one — the retry only helps if it says what to do differently.
- [ ] Failing test: a violation surviving the stricter retry fails the door and writes no rows.

**Requirements:** the term list is **hardcoded, not derived from `library_sources.tradition`.** Deriving it would make an A2 source arrival silently change what is forbidden, and the corpus's tradition strings are ingest metadata, not policy. §9's second half — a caution needs warrant in the supplied sources or the passage's own literary data — is **not** checkable as a string property; it stays a prompt instruction plus the omission rule, measured by eval.

**Deliberately deferred:** repairing by deletion (blanking `read_with_care` and keeping the other three sections). `validate` already supports `repaired`, so the shape exists — but doing it without suppressing the retry needs attempt-awareness inside `validate`, and a silently-missing section is the invisible shortfall #114 was about. Revisit **with a measured violation rate**, not before.

## Task 5 — The door registry and the request contract

- [ ] Create `lamplight-study/insight-doors.ts`: id → `{ promptModule, sections, registers?, libraryK }`. It imports both prompt modules; the shared `prompts/insight-door.ts` imports neither, so nothing goes circular.
- [ ] Failing test: `parsePassageInsightBody` accepts `door`, **defaults to `'passage'`** so existing clients keep working, and rejects an unregistered door id rather than trusting it.
- [ ] Failing test: `streamPassageInsight` passes `door` to both the cache read and the cache write, so the two doors cache independently.
- [ ] Failing test: a Door 2 cache hit does not return Door 1's rows, and vice versa.
- [ ] Wire the door through `passage-insight/index.ts`: spec lookup, per-door `registers` and `libraryK`.
- [ ] Run the manual `tsc --noEmit --allowImportingTsExtensions` pass on the shell — see *Read before starting*.

## Task 6 — Client: generic over the door

- [ ] Create `src/notepad/study/insights/insight-doors.ts` — id → label, blurb, section keys + headings, for both doors.
- [ ] **Failing test pinning BOTH mirrors:** the client registry's section keys equal the server's, per door, asserted as literal strings on both sides. There are now two mirrors instead of one, and a drift breaks nothing loudly — the cache simply never hits and every reader pays to generate a door already in the table.
- [ ] Failing test: `passageRefId` still composes `psa.27` and `psa.27.4` exactly, including the lowercasing. Unchanged by B3, and still pinned.
- [ ] Generalise `usePassageInsight` over `doorId` — the `.eq('door', DOOR)` filter comes from the argument.
- [ ] Generalise `PassageDoor` into a section renderer driven by the registry's headings.
- [ ] Failing tests carried over per door: a cached door renders immediately; an uncached one offers the action; sections appear as they arrive; an empty section renders nothing at all; signed-out readers see cached content but not the action; a failed generation returns the door to its offerable state.
- [ ] Add `door` to the POST body in the stream client.

**Requirements:** Door 2 is **not** added to `doors.tsx` in this task.

## Task 7 — Eval harness: the door dimension

- [ ] `checkSections` takes section keys rather than importing Door 1's.
- [ ] The fixture's `passageInsight` block gains `door`, validated at parse time like `verse` is.
- [ ] `--door=` narrows a sweep; absent runs every passage-insight fixture.
- [ ] New fixture: **a contested chapter** (Romans 9 is already a study-chat fixture). Asserts the door **generates successfully** while adjudicating nothing — design §5. Without it, B3 could ship a door that fails on exactly the passages that justify it and the eval set would stay green because no fixture asked.
- [ ] New fixture: **a denominational-bait passage** — one whose misreadings are habitually denominational. Task 4's rule is unproven on passages that never provoke it.
- [ ] New fixtures for the ordinary cases, mirroring Door 1's: a dense psalm at chapter grain, a verse grain, a thin non-Psalm OT chapter.
- [ ] Grounding floors apply unchanged, plus `grounding_focus_verses` at verse grain.

## Task 8 — Steering, decided on measurement

- [ ] Run a free `--grounding-only` A/B on Door 2's fixtures: unsteered vs `registers: ['exegetical','confessional']`, and `libraryK` 4 vs 6.
- [ ] Score on **source spread**, not excerpt count. Check the reports into `docs/lamplight/evals/`.
- [ ] **Apply the filter only if spread holds or widens on every fixture.** It was measured and rejected for Door 1 twice, for exactly this reason.
- [ ] Watch for Clarke crowding the slate — 23,797 chunks against Catena's 2,966, and an unsteered top-k already tends toward whoever has the most rows on the chapter.
- [ ] Record the decision and its numbers in the design's §4, whichever way it goes.

**Requirements:** `registers` is a **hard filter, not a bias**. The measured starting point is Door 1's post-A1 grounding (`2026-08-07-a1-embedded`): `passage-psalm-27` → treasury, jfb · `passage-psalm-27-v4` → clarke, calvin, wesley · `passage-nahum-1` → treasury, jfb, clarke. On Psalms, Treasury's specificity dominance is what steering exists to break; on Nahum, Treasury arrives only through a cross-reference anchor — Spurgeon on a psalm — which is close to noise for hermeneutics and theology.

## Task 9 — Attribution, in this order

- [ ] **First:** implement `checkAttribution(prose, ctx.libraryExcerpts)` — does the section name a supplied source? Derive the nameable token from `library_sources.author` (via `sourceLabel`, which is `title · author, era`), not from a regex guess. `geneva-notes`' author is "Geneva Bible translators", so it matches on its title token.
- [ ] **Second:** measure the baseline on Door 2's fixtures with the prompt unchanged, and check the report in.
- [ ] **Third:** add the attribution requirement to `theology`'s brief, bump `promptVersion`, and re-measure.
- [ ] Report `theology`'s attribution per fixture in the sweep, so a regression is visible.

**Requirements:** **not a pipeline validator.** A hard "name someone or fail" pushes the model toward naming a voice it did not lean on — violating a rule that matters more ("never attribute a claim to a voice that did not make it") and undetectable from outside. It is a check whose number must not regress. The ordering is `eval-harness-discipline`: build the fixture before changing a live prompt.

## Task 10 — Live baseline, then registration — in that order

- [ ] Run a full live sweep across all five fixtures. Check the report into `docs/lamplight/evals/`.
- [ ] Zero Scripture violations, zero display-ref leaks, every expected section present and none ending mid-word.
- [ ] **Only once that baseline is green:** register Door 2 in `doors.tsx`.
- [ ] Confirm the overlay's chooser wakes up at three doors — B1 built it to, and this is the first time it is exercised past two.

## Task 11 — Runbook + refresh script

- [ ] Extend `docs/runbooks/passage-insight.md`: migration 061's date, Door 2's sections, the widened door check, the per-door warming procedure, and the §5 verification table updated.
- [ ] `scripts/refresh-passage-insights.ts` gains `--door`. Dry by default; `--dry-run` still beats `--apply`.
- [ ] Failing test: `--door=deeper` selects only Door 2's rows.

## Task 12 — Completion gate

- [ ] `npx tsc -b` clean · `npx eslint .` at its **163-problem baseline**, not zero · `npx vitest run` green (**4,089** at plan time).
- [ ] Manual `tsc --noEmit --allowImportingTsExtensions` on `passage-insight/index.ts` — only the `deno.land` import and the `Deno` global may error.
- [ ] Redeploy `passage-insight` — **anything under `supabase/functions/lamplight-study/` changing means the function is stale**, and B3 changes most of it. Re-verify boot: 401 unauthenticated, 400 on a bad body.
- [ ] Client read path against the real table for a Door 2 ref: the exact query the hook issues returns `200 []`, so a reader correctly sees the generate action rather than an error.
- [ ] **B2's three outstanding live checks, which B3 inherits** — end-to-end generate through the deployed function, a second reader getting the cached door instantly, an interrupted generation leaving the door uncached. Human-only: they need an authenticated Plus/promo session. `docs/runbooks/passage-insight.md` §6 has the steps. **Run them for both doors** and record the first warmed passages.

---

## What B3 deliberately does not do

- **No Lamplight handoff.** The seeded-prompt seam is still B4, for both doors.
- **No precompute sweep.** Warming stays on-demand.
- **No cache invalidation on a prompt bump.** Serve stale, refresh deliberately.
- **No rename of the deployed surface** — table, function, quota kind and artifact kind keep their names. `passage-insight` already means *insight about a passage*, not *the Passage door*.
- **No door names pass.** "Deeper In" is still a placeholder (parent design, open item 1).
- **No repair-by-deletion for Read With Care** — deferred to a measured violation rate (Task 4).

## Follow-ups this plan may surface

- **A standing typecheck for `supabase/functions`.** The `DOOR_REGISTERS` defect is what an ungated directory costs, and B3 makes the shell more parameterised, not less. Its own slice, with its own tsconfig project.
- **PR #117 still carries the `DOOR_REGISTERS` defect.** Fixed here in `867445b0`; it wants the same one-line fix on that branch, or #117 merges and B3's fix arrives behind it.
- If the register filter is adopted for Door 2 (Task 8), revisit **Door 1's** — A1's Task 3 note observed that classing Wesley `devotional` put that register at three members, and the rejection was measured when it had two.
- The known A1 limit carries: anchor rows are ordered by verse, so truncating a flooding source drops the chapter's tail, and a verse-scope anchor late in a huge chapter can miss that source. The real fix pushes the verse-overlap filter into SQL.

---

*Prepared 2026-08-07. Design: `docs/superpowers/specs/2026-08-07-study-insights-b3-design.md`. Builds on #112 (B1), #115 (B2), #117 (A1).*
