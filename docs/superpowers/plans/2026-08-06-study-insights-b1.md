# Study Insights B1 — Reference Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Insights overlay shell and its **Sources & Reference** door — book context, the church's voices on this passage, original languages, and cross-references that expand in place. Design: `docs/superpowers/specs/2026-08-06-study-insights-design.md` (Phase B1, §12).

**Architecture:** Pure client feature. Every section is class A (our own tables) or class B (`library_chunks` verse-range join) — both already public-read, so **no AI call, no migration, no edge function, and no entitlement gate.** The overlay is a portal over the Study workspace, cloning the focus/escape/scroll-lock handling `RegionMapFullscreen` already got right. Shared sections are *extracted and reused* by `ApparatusRail`, never forked.

**Tech Stack:** React + TypeScript + Vite · Supabase (Postgres + RLS, client PostgREST reads only) · vitest + @testing-library/react (jsdom).

## Global Constraints

_Every task's requirements implicitly include this section._

- **No AI in B1.** No edge-function change, no `bible_passage_insight` table, no generation. Doors 1 and 2 arrive in B2/B3.
- **Signed-out works.** `library_chunks`, `library_sources`, `bible_books`, `bible_cross_references`, `bible_passages` are all public-read (verified: migration `058_library.sql` lines 86–90). Nothing in B1 may gate on auth or entitlement.
- **Reuse, never fork.** `OriginalLanguagePanel`, `EtymologyPanel`, and the extracted `BookContextCard` are imported by *both* `ApparatusRail` and the Insights door. Two entry points, one implementation — this is the whole answer to the duplication risk (design §5).
- **Graceful degradation is the contract.** A chapter with no library coverage, a failed query, an empty result — all render *nothing*, never an error state and never a "no data available" placeholder. Section omission is first-class (design §9).
- **Translation-correct everywhere.** `bible_passages` PK is `(translation, id)`. Every read of that table filters on translation, sourced from `useBiblePrefs()`.
- **Completion gate MUST run `npx tsc -b`** (not just `eslint` + `vitest`) — a prod-build type error hides behind passing lint and tests. `build` = `tsc -b && vite build`; `test` = `vitest run`; `lint` = `eslint .`.
- **TDD.** Write the failing test first; watch it fail; implement minimally; watch it pass; commit per task.
- **Branch:** `feat/study-insights-b1`, cut from `origin/main` (the repo squash-merges; a focused PR beats PR-ing a long-lived feature branch).
- **No new theme token.** The Insights pill takes the Reflections *shape* (rounded outline, distinct from the flat tabs) with the existing `--lamplight-accent`, which every palette already defines and which `index.css:102` documents as "shared by the Study desk". Adding a 9th CTA token × 8 palettes is not worth it. **Flag point:** if Insights should read as its own colour rather than the Study desk's, say so and this becomes an 8-palette token addition.

---

## ⚠️ Task 1 is a verify-then-fix — confirm the finding before writing the fix

`useApparatus.ts:44` reads each cross-reference's text as:

```ts
await supabase.from('bible_passages').select('text').eq('id', id).maybeSingle()
```

No translation filter, but the PK is `(translation, id)` since migration `036`, and KJV + WEB have a full ingest runbook. **If those translations are loaded, this matches 3 rows, `maybeSingle()` returns a PGRST116 error, the error is discarded, and every cross-reference renders with empty text.** It also pins cross-refs to whichever translation wins, ignoring the reader's preference that `StudyReader` and the edge function both honour.

Confirm against the live database before fixing (`select translation, count(*) from bible_passages group by 1`). Fix regardless — B1's inline expansion reads the same table, and building expansion on an unfiltered query would spread the bug.

---

## File Structure

**New (all under `src/notepad/study/insights/`):**
- `library-voices-query.ts` — pure: verse-range overlap predicate + source-label formatting (Task 2).
- `useLibraryVoices.ts` — fetch chunks for a ref, filter, join `library_sources` (Task 3).
- `LibraryVoices.tsx` — the class-B attribution cards (Task 3).
- `useCrossRefDetail.ts` — expansion payload for one cross-ref (Task 5).
- `CrossReferenceList.tsx` — rows + inline expansion (Task 6).
- `InsightsOverlay.tsx` — portal shell, scope chip, door routing (Task 7).
- `ReferenceDoor.tsx` — Door 3 assembly (Task 8).
- `InsightsButton.tsx` — the entry pill (Task 9).

**New (shared):**
- `src/notepad/study/panes/BookContextCard.tsx` — extracted from `ApparatusRail` (Task 4).

**Modified:**
- `src/notepad/study/useApparatus.ts` — translation-correct cross-ref text (Task 1).
- `src/notepad/study/panes/ApparatusRail.tsx` — use `BookContextCard`; accept `translation` (Tasks 1, 4).
- `src/notepad/study/panes/StudySidePanel.tsx` — render `InsightsButton`, accept `onOpenInsights` (Task 9).
- `src/notepad/study/StudyWorkspace.tsx` — own overlay state, render `InsightsOverlay` (Task 9).
- `src/notepad/study/mobile/MobileStudyWorkspace.tsx` — same, plus mobile overlay behaviour (Task 10).

---

## Task 1 — Translation-correct cross-reference text

- [ ] Confirm the finding against the live DB (`select translation, count(*) from bible_passages group by 1`). Record the result in the task report — it decides whether this is a live bug or a latent one.
- [ ] Failing test in `useApparatus.test.ts` (create if absent): with rows for the same `id` in BSB and KJV, `useApparatus(book, chapter, 'KJV')` returns the **KJV** text for each cross-ref.
- [ ] Add a `translation` parameter to `useApparatus`; add `.eq('translation', translation)` to the cross-ref target query; include `translation` in the effect's dependency array.
- [ ] Thread `translation` from `useBiblePrefs()` at both `ApparatusRail` call sites (`StudyWorkspace`, `MobileStudyWorkspace`) — or read it inside `ApparatusRail` itself, which is fewer prop hops; either is fine, pick one and be consistent.
- [ ] Regression test: cross-ref rows still render text (guards the silent-empty-string failure mode).

**Requirements:** the N+1 loop over cross-refs stays as-is — 8 rows, not worth restructuring in this task.

## Task 2 — Library voices: the pure query module

- [ ] Failing tests for `overlapsVerseRange(chunk, anchor)` covering the semantics the server twin documents in `_shared/library-retrieval.ts`:
  - chunk with `verse_start === null` comments on the whole chapter → overlaps any verse in it;
  - anchor with no `verseStart` **is** the whole chapter → matches every chunk in it;
  - `verse_end === null` falls back to `verse_start`;
  - a chunk with `book === null` or `chapter === null` (confessional/topical/lexical) **never** overlaps;
  - book comparison is case-insensitive; chapter is exact.
- [ ] Failing test for `formatSourceLabel(source)` → `'The Treasury of David · Charles H. Spurgeon, 1869–1885'` from `library_sources` (`title`, `author`, `era`).
- [ ] Implement both as pure functions.
- [ ] **Parity comment** at the top of the file naming `supabase/functions/_shared/library-retrieval.ts#overlapsRef` as the server twin that must not drift — following the existing `normalizeStrongs` / `strongs-key.ts` precedent for client/server duplication.

**Requirements:** pure module, zero imports from `@/lib/supabase`. The server file is Deno-resident and outside `src/`; duplicating with parity tests is deliberate, not accidental.

## Task 3 — `useLibraryVoices` + `LibraryVoices`

- [ ] Failing hook test (stubbed supabase): given `{ book: 'psa', chapter: 27, verse: 4 }`, fetches `library_chunks` for that (book, chapter), filters with `overlapsVerseRange`, joins `library_sources`, and returns excerpts ordered deterministically (source `id`, then `verse_start`, then `heading` — stable ordering so the panel doesn't reshuffle between renders).
- [ ] Failing test: a query error, an empty table, and a chapter with no coverage each yield `[]` with **no error surfaced** (graceful-degradation contract).
- [ ] Implement the hook. One query with `.eq('book', …).eq('chapter', …)` plus the embedded `library_sources` select; filtering happens in JS via Task 2's predicate.
- [ ] Failing component test for `LibraryVoices`: renders one card per excerpt with source label, `heading`, and `content`; renders **nothing at all** (not an empty shell) for `[]`.
- [ ] Implement the component. Cards collapsed by default with the source label as the summary; expanding reveals the excerpt.

**Requirements:** headings keep their ingest suffixes verbatim (`"Psalm 130:5 [2]"`, `"(1/2)"`) — they are the corpus's own identity for the excerpt, per the server-side rendering note in `study-chat.ts`.

## Task 4 — Extract `BookContextCard`

- [ ] Failing test: renders `full_name` as heading and all eight `bible_books` fields, **including `author_note`** — the authorship hedge must survive (design §9). Assert `author_note` text is present when non-empty.
- [ ] Extract the block currently inlined at `ApparatusRail.tsx:42–54` into `BookContextCard.tsx`, props `{ ctx: BookApparatus }`.
- [ ] Replace the inline block in `ApparatusRail` with the component; existing `ApparatusRail` tests stay green unchanged (this is the proof the extraction is behaviour-preserving).

## Task 5 — `useCrossRefDetail`

- [ ] Failing test: for target `heb.11.6`, returns the target verse **plus a verse either side** (clamped at chapter boundaries), filtered by the active translation.
- [ ] Failing test: returns the target's one-line book context (`full_name`, `author`, `date_label`, `genre`) from `bible_books`.
- [ ] Failing test: returns voices on the target ref, reusing `useLibraryVoices`' query path.
- [ ] Failing test: the hook does **no work at all** until expansion is requested (lazy — 8 cross-refs must not fire 24 queries on panel open).
- [ ] Implement. Loading state renders as a quiet inline placeholder inside the expanded row, never a layout jump.

**Requirements:** context verses come from `bible_passages` filtered on `(translation, book, chapter)` with a verse-range window — do **not** reuse `useBiblePassages` (it fetches whole chapters; three verses is the need here).

## Task 6 — `CrossReferenceList` with inline expansion

- [ ] Failing test: renders one row per `CrossRefView` — ref label, verse text, `OT ↔ NT` badge when `crossesTestament`.
- [ ] Failing test: clicking a row expands it **in place** — target passage with surrounding context, target book-context line, and voices on that ref — with no navigation and no router interaction.
- [ ] Failing test: multiple rows may be open simultaneously; clicking an open row collapses it.
- [ ] Failing test: expansion state resets when `book`/`chapter` change.
- [ ] Failing test: **no generated "why they connect" anywhere** — assert the component renders no prose beyond the passage text, book-context line, and library excerpts. This test is the guard on the deferred Pillar D contract (design Scope/Out); it should fail loudly if someone later adds an explanation here instead of in the Pillar D slot.
- [ ] Implement, with the row as a `button` carrying `aria-expanded`.

## Task 7 — `InsightsOverlay` shell

- [ ] Failing test: renders into a portal, traps focus, closes on Escape and on the ✕ control, restores focus to the trigger on close, and locks body scroll while open. **Clone `RegionMapFullscreen`'s implementation** — including the `onCloseRef` trick that keeps the setup effect from re-running on a fresh inline `onClose` identity (that comment records a real bug already fixed once; do not re-introduce it).
- [ ] Failing test: header renders the passage label (`bookByAbbrev(book)?.name ?? book` + chapter) and, when a verse is selected, the scope chip showing `verse` with a control to widen to `chapter`.
- [ ] Failing test: scope defaults to `verse` when `selectedVerse` is set, `chapter` otherwise; widening to chapter is reversible while the selection stands.
- [ ] Failing test: **door routing** — given one door it renders that door's content directly; given two or more it renders a chooser. B1 passes one door, so the chooser is dormant until B2 without needing a re-layout then.
- [ ] Implement. Two-column reading layout at ≥1024px, single column below.

**Requirements:** the door list is data (`{ id, label, render }[]`), not a hardcoded switch — B2/B3 add entries, not branches.

## Task 8 — `ReferenceDoor` (Door 3)

- [ ] Failing test: composes, in order — `BookContextCard`, `LibraryVoices`, `OriginalLanguagePanel` + `EtymologyPanel`, `CrossReferenceList`.
- [ ] Failing test: at `chapter` scope the language panels receive `verseId = null` (they already handle it); at `verse` scope they receive `${book}.${chapter}.${verse}`.
- [ ] Failing test: a section with no content renders nothing — no heading, no placeholder (omission-is-first-class).
- [ ] Failing test: the voices header states the corpus's composition **read from `library_sources` at render time**, never a hardcoded tradition list (design §3.3 — this is the property that lets Phase A2 widen the section without a code change).
- [ ] Implement.

## Task 9 — `InsightsButton` + desktop wiring

- [ ] Failing test: `InsightsButton` renders as a pill (rounded, outlined, `--lamplight-accent`), visually distinct from the flat tab buttons, with an accessible label.
- [ ] Failing test: `StudySidePanel` renders the button in the tab row and calls `onOpenInsights` on click; omits it entirely when the prop is absent.
- [ ] Failing test: `StudyWorkspace` opens the overlay on that callback, passes `book`, `chapter`, `selectedVerse`, and closes it on the overlay's `onClose`.
- [ ] Implement. Overlay state lives in `StudyWorkspace` (not `StudySidePanel`) because the overlay covers the whole workspace.

## Task 10 — Mobile wiring

- [ ] Failing test: `MobileStudyWorkspace` opens the overlay, which covers the tab bar and offers a back affordance.
- [ ] Failing test: the Reader and Context panes stay mounted beneath, so closing Insights restores the reader's scroll position and the selected verse.
- [ ] Failing test: `selectedVerse` (already lifted in this workspace) reaches the overlay.
- [ ] Implement.

## Task 11 — Completion gate

- [ ] `npx tsc -b` clean.
- [ ] `eslint .` clean.
- [ ] `vitest run` green.
- [ ] Manual pass, **signed out**, on a Psalm (dense library coverage: Treasury + Henry + JFB) and on a non-Psalm OT chapter (thin: Henry + JFB only) — confirm the thin case degrades to fewer cards rather than to an error or an empty shell.
- [ ] Manual pass on a chapter with **zero** library coverage — the voices section must be absent entirely.
- [ ] Manual pass with the translation set to KJV — cross-reference text renders in KJV (the Task 1 fix, end to end).

---

## What B1 deliberately does not do

- No Door 1 / Door 2, no generated prose, no `bible_passage_insight` table, no edge-function change.
- No generated "why" on cross-references — the reader sees both passages and draws the line (design Scope/Out). Task 6 has a test guarding this.
- No removal or restructuring of `ApparatusRail`; it keeps working and now shares components with the door.
- No precompute, no caching layer — every read is live PostgREST against public tables.

## Follow-ups this plan may surface

- The `useApparatus` cross-ref loop is N+1 (8 sequential round-trips). Fine at this size; if Task 1's DB check shows it's slow in practice, spawn a separate task rather than widening this one.
- If Task 1 confirms the bug is **live**, cross-references have been rendering textless in production — worth checking whether anything else reads `bible_passages` without a translation filter (`grep -rn "from('bible_passages')" src/`).

---

*Prepared 2026-08-06. Design: `docs/superpowers/specs/2026-08-06-study-insights-design.md`. Brainstorm: `…-study-insights-brainstorm.md`.*
