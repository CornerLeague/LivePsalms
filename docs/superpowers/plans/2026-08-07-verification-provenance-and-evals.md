# Scripture Verification, Provenance & Eval Harness (Depth Overhaul slice 1d) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close Phase 1 with the trust floor. Three deliverables: (1) **deterministic Scripture verification with repair** on every artifact — the "never misquotes Scripture" guarantee enforced in code, not prompts; (2) the **provenance panel + Sources screen** that make grounding visible (backlog P2-2, plus the CC-BY attribution obligation from 1b); (3) the **live-model eval harness** — the repo has none, and no public verse-accuracy benchmark exists, so a small internal one is instantly ahead of the published state of the art.

**Design doc:** `docs/superpowers/specs/2026-08-04-lamplight-library-and-reasoning-design.md` (decisions 10, 11, 12; §Scripture verification, §Transparency, §Eval harness). Closes backlog **P2-2** and **P2-8**.

**Dependency note:** Tasks 1–3 (verification) and Task 7 (harness) need **nothing from 1b/1c** — they can land immediately after 1a. Tasks 4–6 (panel + Sources screen) render library provenance when present and degrade to notes/verses/model when the library hasn't shipped. **This slice is therefore safe to start before 1b/1c finish**; only the library rows in the panel stay empty until they do.

**Architecture:** Verification extends `_shared/verse-verify.ts` (already the canonical ref parser, already cross-runtime-mirrored with the client's `BOOK_TO_OSIS`). It runs as a post-generation pass inside each pipeline's existing validate seam, so repairs land before persistence and violations feed the stricter retry that already exists. The panel is a presentational component fed by widened adapter selects. The harness is a standalone script — never in CI (real models cost real money).

**Tech Stack:** Deno edge functions, Supabase JS, React 19 + Vitest 4 (component tests need the `// @vitest-environment jsdom` first-line pragma + top-level `afterEach(cleanup)`), `tsx` for the harness.

## Global Constraints

- Branch `feat/verification-provenance-evals`.
- **Repair before reject (design decision 10).** A quoted verse that fuzzy-matches canonical text is silently rewritten to the canonical rendering. Only an unresolvable ref or an unmatchable quote becomes a violation. Never show the user a misquote; never fail an artifact a repair could save.
- **Verification is enhancement, never a hard dependency** — the existing file header says so and the contract holds: a thrown lookup is caught, logged, and treated as "skipped". A `bible_passages` outage must not break generation.
- **No new migrations.** Everything needed is already persisted (`source_note_ids`, `source_verses`, `model_used`, `prompt_version`, and 1b's `source_library_chunks`).
- The eval harness **never runs in CI** and never lands API keys in the repo. It writes reports to `docs/lamplight/evals/<date>-<label>/`.
- Component tests: first line `// @vitest-environment jsdom`, `@testing-library/react`, top-level `afterEach(cleanup)`. Pure-logic tests stay in the default node env.
- Gates: `npx tsc -b` (exit 0) **and** `npx vitest run` **and** `npx eslint <touched files>`.
- Commit only when the user asks.

## File Structure

**New:**
- `supabase/functions/_shared/scripture-verify.ts` (+`.test.ts`) — quote extraction, normalization, similarity, `verifyArtifactScripture`
- `src/notepad/components/lamplight/LamplightProvenancePanel.tsx` (+`.test.tsx`)
- `src/auth/settings/SourcesSection.tsx` (+`.test.tsx`)
- `scripts/eval-lamplight.ts` (+`.test.ts`) and `scripts/eval-fixtures/*.json`
- `docs/lamplight/evals/README.md` — how to run, how to read a report

**Modified:**
- `supabase/functions/_shared/verse-verify.ts` — export the internals `scripture-verify.ts` needs (no behavior change)
- `lamplight-generate/daily-devotion-pipeline.ts` (+test), `lamplight-chat/bible-chat-pipeline.ts` (+test), `etymology-insight/insight-body.ts` (+test), `lamplight-generate/monthly-reflection-pipeline.ts` (+test)
- `src/notepad/storage/lamplight-adapter.ts` + `supabase-lamplight-adapter.ts` (+test) + `fake-lamplight-adapter.ts` — widen selects, carry provenance
- `src/notepad/components/lamplight/TodaysLampCard.tsx` (+test), `src/notepad/components/waymarks/WaymarksPeriodDetail.tsx` (+test) — mount the panel
- `src/auth/ProfilePage.tsx` — mount the Sources section

---

### Task 1: Verification primitives (pure, TDD)

**File:** `_shared/scripture-verify.ts` (+test)

- [x] **Step 1: failing tests for `extractQuotedSpans`** — finds a ≥6-word span inside straight quotes adjacent to a ref (`"..." (Psalm 23:1)` and `Psalm 23:1 says "..."`); handles curly quotes `“ ”`; ignores short quoted fragments (< 6 words — those are ordinary emphasis, not verse quotation); returns `{ quote, ref, start, end }` offsets so a repair can splice precisely; a span with no nearby ref is skipped (we cannot verify what we cannot resolve).
- [x] **Step 2: failing tests for `normalizeForMatch`** — lowercases, strips punctuation and smart quotes, collapses whitespace; leaves word order intact.
- [x] **Step 3: failing tests for `tokenOverlap`** — identical strings score 1; a one-word difference in a 20-word verse scores ≥ 0.9 (→ repairable); an unrelated sentence scores < 0.5 (→ violation); an empty canonical string scores 0 and never divides by zero.
- [x] **Step 4:** run, expect FAIL. **Step 5:** implement all three as exported pure functions. **Step 6:** green.

### Task 2: `verifyArtifactScripture` — resolve, repair, report

**File:** `_shared/scripture-verify.ts` (+test)

- [x] **Step 1: failing tests** (injected `verifyVerseRefs` fake — no Supabase stub):
  - a correct quote passes: `ok: true`, no violations, `repairedText` absent (or identical)
  - a near-miss quote (≥ 0.9 overlap) is **repaired** to canonical text; `ok: true`; the repair is reported in `repairs[]` so callers can log it
  - a wrong-verse quote (< 0.9) yields `ok: false` with `{ family: 'scripture', rule: 'quote_mismatch' }`
  - a ref that resolves to nothing yields `{ rule: 'unresolvable_ref' }` — this is the hallucinated-reference case ("2 Hezekiah 3:16")
  - **multiple repairs in one text splice correctly** (apply right-to-left by offset so earlier offsets stay valid — the classic bug)
  - a thrown lookup is caught and returns `ok: true` with zero violations (enhancement-never-dependency), logging once
  - text with no refs at all short-circuits without calling the lookup
- [x] **Step 2:** FAIL → **Step 3:** implement:
  ```ts
  export interface ScriptureVerifyResult {
    ok: boolean;
    repairedText?: string;
    repairs: Array<{ ref: string; from: string; to: string }>;
    violations: Array<{ family: 'scripture'; rule: 'unresolvable_ref' | 'quote_mismatch'; snippet: string }>;
  }
  export async function verifyArtifactScripture(
    deps: { verifyRefs: (refs: string[]) => Promise<VerseFlag[]> },
    args: { text: string; translation: string },
  ): Promise<ScriptureVerifyResult>;
  ```
- [x] **Step 4:** green.

### Task 3: Wire verification into the four surfaces

**Files:** `daily-devotion-pipeline.ts`, `bible-chat-pipeline.ts`, `insight-body.ts`, `monthly-reflection-pipeline.ts` (+ their tests)

- [x] **Step 1: daily devotion — failing test.** Verification runs over `scripture.text` + `reflection` prose; a near-miss anchor quote is repaired **in the persisted artifact** (assert the inserted `body`, not just the return); a wrong quote fails validation and feeds the stricter retry. Note the ordering: verification joins the existing `makeDailyDevotionValidate` chain **after** citation + content rules (cheapest gates first, and a citation failure makes verification moot).
- [x] **Step 2:** implement + green.
- [x] **Step 3: chat replies — failing test** for both surfaces (study + journaling share `makeBibleChatValidate`). Repairs apply to the reply before persistence.
- [x] **Step 4: streaming caveat.** The user has already *seen* the streamed text when a repair lands. Confirm what the client does with the `done` payload's `reply`: if it re-renders from the payload, emit the existing `refining` beat before `done` so the swap is explained; **if it does not re-render, that's the real fix** — make it, and pin it with a test. Do not ship a silent divergence between what was streamed and what was saved.
- [x] **Step 5: etymology insight — failing test.** Verification runs on the body before the shared-cache insert (it already has a content-rules gate there from Phase 0 — extend that block, don't add a second one). A violating body is never cached.
- [x] **Step 6: reflection markers — failing test.** Markers get **`unresolvable_ref` checks only** — the letter carries no verse-level citations by design (validator 2 forbids them), so there are no quotes to match. Do not run quote matching over the letter; it would false-positive on the reader's own remembered phrasing.
- [x] **Step 7:** all four green; full `npx vitest run supabase/functions`.

### Task 4: Adapter carries provenance

**Files:** `lamplight-adapter.ts`, `supabase-lamplight-adapter.ts` (+test), `fake-lamplight-adapter.ts`

- [x] **Step 1: failing adapter test** — the daily-devotion read (currently `.select('body')`, `supabase-lamplight-adapter.ts:128`) also returns `source_note_ids`, `source_verses`, `model_used`, `prompt_version`, `source_library_chunks`; the reflection read (currently `.select('period_key, title, body, created_at, saved_to_notes')`, ~line 494) likewise. Shape them into one `ArtifactProvenance` type shared by both.
- [x] **Step 2:** implement — widen the selects, map snake_case → camelCase **inside the adapter only** (house rule), extend the interface, and mirror in `FakeLamplightAdapter` with a `__seedProvenance` helper so component tests can drive the panel.
- [x] **Step 3:** green. **Note:** `source_note_ids` are ids, not titles — the panel needs note titles, so add a `resolveNoteTitles(ids)` adapter method (or reuse an existing note read) rather than rendering raw uuids at the user.

### Task 5: `LamplightProvenancePanel`

**File:** `src/notepad/components/lamplight/LamplightProvenancePanel.tsx` (+`.test.tsx`)

- [x] **Step 1: failing component tests** (jsdom pragma) — renders "Drawn from your notes" with resolved note **titles** (never uuids); renders the scripture refs; renders library sources as `<sourceLabel> — <heading>` when `sourceLibraryChunks` is present and **omits that section entirely when null** (the "library never ran" case must not render an empty header); renders model + prompt version in a de-emphasized footer; the whole panel is behind a disclosure that is **closed by default** (this is reassurance-on-demand, not clutter); the trigger has an accessible name.
- [x] **Step 2:** FAIL → **Step 3:** implement, matching the existing card's visual grammar (Cormorant Garamond for quoted material, uppercase tracking for labels — see `TodaysLampCard.tsx:79-157`). Copy: **"How this was written"**.
- [x] **Step 4:** mount on `TodaysLampCard` (a small icon by the header) and on `WaymarksPeriodDetail`. Test each mount renders it with real adapter data.
- [x] **Step 5:** green.

### Task 6: Sources screen (the CC-BY obligation)

**File:** `src/auth/settings/SourcesSection.tsx` (+`.test.tsx`)

- [x] **Step 1: failing test** — reads `library_sources` via the adapter, groups by license, renders each source's `title`, `author`, `era`, and its **verbatim `attribution` string** with any required link; an empty table renders a short "no sources yet" state rather than a broken heading (true until 1b runs).
- [x] **Step 2:** implement; mount in `ProfilePage` beside `LamplightSettingsSection` (follow that section's shape and props convention).
- [x] **Step 3:** green. **This is the license-compliance surface** — CC-BY for OpenBible and STEPBible requires visible credit. It is not optional polish.

### Task 7: Eval harness v1

**Files:** `scripts/eval-lamplight.ts` (+test), `scripts/eval-fixtures/*.json`, `docs/lamplight/evals/README.md`

- [x] **Step 1: build ~10 synthetic persona fixtures** — sparse month, grief month, ordinary month, doubt season, heavy-study month, contested-passage-heavy, no-first-name, long-vault, brand-new user, non-English name. Each: notes (with dates), highlights, and expected-property assertions. **Synthetic only** — never a real user's vault, and say so in the README.
- [x] **Step 2: failing tests for the pure scoring layer** — a report aggregates per-fixture results into pass/fail counts; a scripture violation anywhere marks the run failed; token/cost tallies sum correctly per artifact kind.
- [x] **Step 3:** implement the runner: `--artifact=reflection|devotion|study-chat`, `--live` (real key + real models) vs `--dry` (context assembly only, no spend), `--fixture=<name>` for one-off debugging.
- [x] **Step 4: per-run checks** — deterministic validators pass; `verifyArtifactScripture` reports **zero** violations; judge verdicts recorded; banned/contested/growth families clean; token + cost tally per artifact; **output snapshots written for human read-through** (the register question — "does this sound like Lamplight?" — is not machine-checkable, and the report should say so rather than implying a green run means good prose).
- [x] **Step 5:** write `docs/lamplight/evals/README.md`: how to run, what each check means, what a green run does and does **not** prove, and the standing gate — **run before any `prompt_version` bump, model id change, or effort change; attach the report to the PR.**
- [x] **Step 6:** run it once live against the current prompts and check in the baseline report. That baseline is what every later change is compared against.

### Task 8: Gates + close-out

- [x] **Step 1:** `npx tsc -b` exit 0; full `npx vitest run` green; `npx eslint` clean on touched files.
- [ ] **Step 2: browser verification** — open Today's Lamp, expand "How this was written", confirm note titles/refs/sources render and the panel is closed by default; open a Waymarks stone and confirm the same; open Profile and confirm the Sources section lists the corpus with credit lines.
- [x] **Step 3: update the backlog** — mark P2-2 (transparency panel) and P2-8 (inline verse-ref validation) closed in `docs/superpowers/lamplight-followups.md`, noting that P2-8 shipped with *repair* semantics rather than the flag-only behaviour it originally described.
- [x] **Step 4: close out Phase 1** — append a completion record to the Phase-1 design doc summarizing all four slices, and note in the brainstorm §14 that Phase 1 is done and Phase 2 (Journey Thread) is next to design.

## Open questions (resolve during execution, none blocking)

- The 0.9 token-overlap repair threshold is a starting point. If the baseline eval shows repairs firing on legitimately different translations (a user reading KJV while the allowlist is BSB), raise it or make it translation-aware.
- Should chat replies verify **before** the `done` beat (blocking, adds latency) or after (already shown, then corrected)? Default: before persistence but after streaming, with the `refining` beat covering the swap — revisit if the swap reads as jarring in practice.
- Does the provenance panel belong on study-chat replies too? Out of scope here (chat has no artifact row), but worth considering once the library is live in 1c.

---

## Completion record (2026-08-05)

**Slice 1d is code-complete.** Verification runs on four surfaces, the provenance
panel and Sources screen ship, and the eval harness produced a checked-in live
baseline. One plan step is deliberately unchecked (browser verification — see
"Not verified" below).

**Gates:** `npx tsc -b` exit 0 · full `npx vitest run` **3,657 passed / 43
skipped** · `npx eslint` clean on every new file. Two touched files carry
pre-existing lint errors (`TodaysLampCard.tsx` react-refresh, the adapter test's
chainable fake); verified against HEAD that this slice added none.

### Live baseline

`docs/lamplight/evals/2026-08-05-baseline/` — **10/10 fixtures passed, zero
scripture violations, $0.0718** (15,151 in / 3,460 out, `gpt-5.6-terra`), plus
ten snapshots. This is what every later prompt/model/effort change is compared
against.

### What the first live runs found

The harness earned its cost immediately. Four bugs, none of which any unit test
could have caught:

1. **Verification would have failed EVERY devotion in production.**
   `verifyVerseRefs` silently *skips* a ref it cannot parse; `parseRefToIds` only
   understood full book names; and `bible_passages.book` stores the OSIS code, so
   the devotion's own refs (`psa 34:18`) parsed to nothing. `verifyVerseField`
   read "no flag" as `unresolvable_ref` — turning *unverifiable* into *invalid*,
   exactly what "enhancement, never a dependency" forbids. Fixed twice over: the
   shared parser now accepts OSIS codes, and a missing flag now means "skipped",
   matched by ref rather than array position.
2. **A fixture used `phl.4.6`** for Philippians (`php`). Nothing errored — the
   verse just did not resolve, the allowlist quietly shrank, and the eval would
   have scored an artifact on less grounding than the fixture claimed.
   `validateFixtureRefs` now checks every id against the OSIS map offline, so
   `--dry` catches this class for free.
3. **Two fixtures had no candidate passages**, because highlights were the wrong
   proxy for them — production retrieves candidates semantically, so every user
   gets some. Added `candidateVerses` as its own field; `--dry` now rejects a
   fixture that expects an artifact with nothing to anchor on.
4. **`createClient` throws on Node 20** (no global WebSocket) — the 1b gotcha,
   re-hit because the harness did not use `createIngestClient`. Vitest cannot
   catch this class at all: `src/test-setup.ts` stubs a global WebSocket.

### Deviations from the plan

1. **The repair threshold is length-aware, not a flat 0.9.** Dice similarity
   depends on length: one wrong word scores 0.95 in a 20-token verse but **0.889
   in a 9-token one** — and Psalm 23:1, the plan's own example, is 9 tokens. A
   flat 0.9 would have *rejected* the commonest near-miss, inverting "repair
   before reject" on the exact case it was written for.
2. **Added a containment measure** alongside the plan's overlap. With one
   symmetric threshold, a deliberate half-verse excerpt is either silently
   rewritten into the whole verse or failed as a mismatch. Both are wrong.
3. **`validate` gained an explicit `repaired` return** rather than mutating
   `parsed` in place. A function named `validate` silently rewriting the artifact
   is a trap; the hand-off now lives in the type.
4. **The streaming path announces repairs.** Both clients re-render the reply
   from the `done` payload (`LamplightStudyPanel.tsx:162`,
   `LamplightChat.tsx:129`), so a repair reaches the screen — but a repair
   *passes* validation, and the existing `refining` beat only covers the retry
   path. It now fires when a repair lands and text was already on screen.
5. **Reflection markers get no verification.** The check cannot fire: markers
   carry no quotations and every marker verse is already constrained to an
   allowlist of DB-resolved refs. It would have been a per-generation round trip
   whose only failure mode is a false positive on someone's monthly letter.
6. **Provenance is read on demand**, not folded into
   `getDailyDevotion`/`getReflection`. The panel is closed by default, so
   widening those reads would load bibliography data on every render for
   something almost nobody opens — and would have rippled through the devotion
   controller's state shape.
7. **The hallucinated-book check is narrow by design** — it fires only on a
   *quoted* passage. A permissive scan over all prose would flag "Chapter 3:16"
   and fail good artifacts; the realistic hallucination (real book, wrong
   chapter) is caught by the lookup instead.
8. **Only `--artifact=devotion` runs live.** Reflection and study-chat are scored
   by the same layer but need context the fixtures do not yet describe.

### Not verified

- **Browser verification (Task 8 Step 2) was not completed.** The dev server runs
  clean and the app renders with no console errors introduced by this slice
  (confirmed against HEAD), but the panel and Sources section require an
  authenticated session with a generated artifact, which cannot be created
  without signing in. Both are covered by component tests against the fake
  adapter; neither has been seen in a browser.

### Findings for the product owner (not bugs in this slice)

1. **Devotions render raw OSIS refs.** `scripture.ref` reads `psa 23:4`, and in
   2 of 3 baseline snapshots the model repeated the form *in the reflection
   prose* ("The image in psa 16:6…"). Reflections avoid this via
   `osisRefToDisplay`; the devotion path never got the same treatment. Visible to
   every user, and it predates this slice.
2. **Psalm superscriptions land in the anchor text.** `psa 13:1` renders as "For
   the choirmaster. A Psalm of David. How long, O LORD?" — the BSB verse-1 row
   carries the heading.
3. **Register is drifting toward commentary.** All ten baseline devotions passed
   every deterministic check, but three read as study notes rather than a word
   for a morning: all three tell-fixtures open with the identical template
   (`Name — [note details], [abstract turn]`), two close with the same "Scripture
   holds X and Y" construction, and `ordinary-month` opens by listing the notes,
   which the prompt explicitly forbids. Exactly the class the README says a green
   run cannot prove — found by reading the snapshots.
