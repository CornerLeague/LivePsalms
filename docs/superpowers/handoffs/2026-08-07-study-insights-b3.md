# Handoff: Study Insights B3 — Door 2, *Deeper In*

**Date:** 2026-08-07
**Status:** READY TO DESIGN. B3's dependency (Phase A1, corpus breadth) is complete and verified. **There is no B3 design or plan yet — writing the design is the first task**, following the shape of `2026-08-06-study-insights-b2-design.md`.
**Branch:** ⚠️ **Do not branch off `main` yet.** See *Branching* below — A1's code is in PR #117, unmerged.

## Read these first, in this order

1. **Parent design:** `docs/superpowers/specs/2026-08-06-study-insights-design.md` — decision 3 defines Door 2's four sections; **§9 governs "Read With Care"** and is the constraint that most shapes this slice.
2. **B2's design + plan:** `docs/superpowers/specs/2026-08-06-study-insights-b2-design.md` and `docs/superpowers/plans/2026-08-06-study-insights-b2.md`. B2 built Door 1; **B3 is largely "the second door through the same machinery"**, and B2's plan carries a decision log with corrections worth reading before repeating them.
3. **B2's runbook:** `docs/runbooks/passage-insight.md` — operational state, and §5's table of what is and is not verified.
4. **A1's plan:** `docs/superpowers/plans/2026-08-07-library-a1.md` — what the corpus can now support, and its watch item, which lands directly on Door 2.

## What Door 2 is

Four sections (parent design, decision 3):

**How to Read This Passage** (hermeneutics) · **Historical & Cultural Setting** · **Theological Significance** · **Read With Care**

## Decisions already made — do not relitigate

- **Door 2 KEEPS the blanket contested-passage rejection**, like Door 1 (Myles, 2026-08-07). It does **not** take study chat's `allowContestedRefs` exemption. Rationale: it is descriptive, generated once, and served to everyone from a shared cache — the same risk posture that decided Door 1.
- **A1 came first**, deliberately, so Door 2 has breadth to be deep about. That is now done.
- Everything in the parent design's decision log (global shared cache, explicit generate, two grains, public-read rows, omission first-class) applies unchanged.
- **§9's "Read With Care" constraint is a hard rule, not a style note:** permitted are interpretive moves — context-stripping, etymology-as-meaning, genre errors, anachronism. **Forbidden is any caution aimed at a tradition, denomination or group.** A caution with no warrant in the supplied sources or the passage's own literary data is omitted.

## What already exists that B3 reuses

B2 built the whole pipeline. **The main architectural question for B3's design is how much of it becomes door-generic**, because these are currently hardcoded to Door 1:

| Module | Door-1 coupling |
|---|---|
| `lamplight-study/prompts/passage-insight.ts` | `PASSAGE_INSIGHT_SECTIONS`, the four-field tool, `ceilingFor()` |
| `lamplight-study/passage-insight-pipeline.ts` | imports those sections directly |
| `lamplight-study/passage-insight-cache.ts` | `PASSAGE_DOOR = 'passage'` |
| `lamplight-study/passage-insight-stream.ts` | same |
| `passage-insight/index.ts` | edge-fn shell |
| `src/notepad/study/insights/` | `PassageDoor.tsx`, `usePassageInsight.ts`, `passage-insight-stream-client.ts` (mirrors the section list), `doors.tsx` |
| `scripts/eval-lamplight.ts` | `passage-insight` artifact kind, `checkSections`, three fixtures |

Generalising is likely the right call, but it is a design decision with a real alternative (duplicate-then-diverge), so **make it deliberately in the design rather than by drift**.

## ⚠️ Landmines

- **`door` is NOT in the primary key.** Migration 060 has `primary key (scope, ref_id, section)`, so `('chapter','psa.27','overview')` is unique across **all** doors. B3's four section names do not collide with B2's today, but the constraint is one careless name away from two doors silently overwriting each other. **Either widen the PK in the B3 migration or treat non-collision as a load-bearing invariant with a test.**
- **The `door` check constraint is narrow on purpose:** `check (door in ('passage'))`. B3 must widen it to include `'deeper'`. Migration `061`. **Applied by hand via the SQL Editor** — `db push` is broken on this machine (see `supabase-migration-workflow` memory).
- **`tsc -b` does not typecheck `supabase/functions` at all** — `tsconfig.app.json` includes only `src`. The Deno shells are neither typechecked nor tested by the gate. B2 checked its shell once by hand; that is not a standing guard.

## The watch item that lands squarely on Door 2

**Retrieval breadth is not yet attribution breadth.** A1's completion sweep measured, per study-chat reply:

| fixture | grounded on | named in prose |
|---|---|---|
| `study-hebrews-11` | 4 sources | Calvin, Geneva, Jamieson |
| `study-romans-9` | 3 sources | Wesley |
| `study-genesis-1` | 3 sources | **none** |
| `study-psalm-27` | 2 sources | **none** |

`STUDY_GROUNDING_RULES` says *"the reader is owed the source of a reading"*, and two of four replies named nobody despite being grounded on several sources.

**Door 2's *Theological Significance* depends on named attribution more than any surface built so far** — a theological reading with no named voice is exactly the anonymous verdict that rule exists to prevent. Treat this as a first-class B3 concern, not a follow-up. A prompt change here needs its own eval evidence.

## Use these, which B2 could not

- **Register steering** — `buildStudyContext` now takes `registers` (a **hard filter**, not a bias). Parent design §7 wants Door 2 biased to `exegetical` + `confessional`. That is now viable: `exegetical` has four members and `confessional` has one (Geneva).
  **But measure before applying.** The same filter was measured and *rejected* for Door 1 twice, because it collapsed grounding to a single voice. See A1's plan, Task 2.
- **`displayRefs: true`** — must be set, or the model prints OSIS codes (`psa 27:4`, `2ti 2:19`) at readers. Every reader-facing surface now sets it.

## Corpus state

**111,637 chunks, 8 sources, fully embedded.**

| source | register | tradition | chunks |
|---|---|---|---|
| `adam-clarke` | exegetical | Methodist (Wesleyan) | 23,797 |
| `calvin-commentaries` | exegetical | Reformed (Continental) | 19,129 |
| `jfb` | exegetical | Church of Scotland / Anglican | 17,195 |
| `wesley-notes` | devotional | Methodist (Wesleyan) | 16,968 |
| `geneva-notes` | **confessional** | Reformed (English Puritan) | 14,701 |
| `treasury-of-david` | devotional | Baptist (Reformed) | 12,745 |
| `matthew-henry-concise` | devotional | Nonconformist (Presbyterian) | 4,136 |
| `catena-aurea` | exegetical | Patristic (Catholic compilation) | 2,966 |

**Coverage caveats that will bite Door 2:** `catena-aurea` is **Gospels only** (4/66 books) and `calvin-commentaries` is a partial canon (48/66). `treasury-of-david` is **Psalms only** and reaches other books solely through cross-reference anchors — which is how a Nahum query ends up grounded on Spurgeon-on-a-psalm.

## Not verified — inherited from B2, still true

`bible_passage_insight` holds **0 rows**. Three B2 checks have never run live; all need an authenticated Plus/promo session, and `docs/runbooks/passage-insight.md` §6 has the steps:

- End-to-end generate through the deployed `passage-insight` function, writing real cache rows
- A second reader getting the cached door instantly, with no generation and no entitlement prompt
- An interrupted generation leaving the door uncached rather than half-written

**Worth doing before B3 ships**, since B3 rides the same machinery and would inherit any breakage.

## Branching

**PR #117 (`feat/library-a1`) is open and unmerged.** It carries A1's code — register steering, the per-source anchor fan-out, the `allSettled` fix, the adapters. The *corpus itself* is already live in the database, but the code is not on `main`.

So either:
- **wait for #117 to merge**, then branch off `main`; or
- branch off `feat/library-a1`.

Branching off `main` before #117 merges gives a B3 without register steering, and with the anchor-channel bug where one slow source loses all eight.

Repo squash-merges; for a focused PR, branch off `origin/main` and cherry-pick rather than PR-ing a long-lived branch.

## Gate

`npx tsc -b` clean · `npx vitest run` green (**4,089** at handoff) · `npx eslint .` at its **163-problem baseline**, not zero.

**Do not trust numbers quoted in prose** — check them against the code. That rule has already caught a "1.6–2×" ratio claim that survived three documents and a merged PR before the code disproved it.

---

## Cold-start prompt

> Start Study Insights B3 — Insights Door 2, *Deeper In*.
>
> Read `docs/superpowers/handoffs/2026-08-07-study-insights-b3.md` first, then the docs it lists in order.
>
> There is no B3 design or plan yet — write the design first, in the shape of `docs/superpowers/specs/2026-08-06-study-insights-b2-design.md`. The main architectural question is how much of B2's Door-1 machinery becomes door-generic; decide it deliberately.
>
> Do not relitigate: Door 2 keeps the contested-passage rejection, and §9's Read With Care constraint is a hard rule.
>
> Branch off `feat/library-a1` unless PR #117 has merged, in which case branch off `main`.
>
> Gate: `npx tsc -b`, `vitest run`, `eslint .` (baseline 163 problems, not zero).
