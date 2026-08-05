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

- [ ] **Step 1: failing tests for `extractQuotedSpans`** — finds a ≥6-word span inside straight quotes adjacent to a ref (`"..." (Psalm 23:1)` and `Psalm 23:1 says "..."`); handles curly quotes `“ ”`; ignores short quoted fragments (< 6 words — those are ordinary emphasis, not verse quotation); returns `{ quote, ref, start, end }` offsets so a repair can splice precisely; a span with no nearby ref is skipped (we cannot verify what we cannot resolve).
- [ ] **Step 2: failing tests for `normalizeForMatch`** — lowercases, strips punctuation and smart quotes, collapses whitespace; leaves word order intact.
- [ ] **Step 3: failing tests for `tokenOverlap`** — identical strings score 1; a one-word difference in a 20-word verse scores ≥ 0.9 (→ repairable); an unrelated sentence scores < 0.5 (→ violation); an empty canonical string scores 0 and never divides by zero.
- [ ] **Step 4:** run, expect FAIL. **Step 5:** implement all three as exported pure functions. **Step 6:** green.

### Task 2: `verifyArtifactScripture` — resolve, repair, report

**File:** `_shared/scripture-verify.ts` (+test)

- [ ] **Step 1: failing tests** (injected `verifyVerseRefs` fake — no Supabase stub):
  - a correct quote passes: `ok: true`, no violations, `repairedText` absent (or identical)
  - a near-miss quote (≥ 0.9 overlap) is **repaired** to canonical text; `ok: true`; the repair is reported in `repairs[]` so callers can log it
  - a wrong-verse quote (< 0.9) yields `ok: false` with `{ family: 'scripture', rule: 'quote_mismatch' }`
  - a ref that resolves to nothing yields `{ rule: 'unresolvable_ref' }` — this is the hallucinated-reference case ("2 Hezekiah 3:16")
  - **multiple repairs in one text splice correctly** (apply right-to-left by offset so earlier offsets stay valid — the classic bug)
  - a thrown lookup is caught and returns `ok: true` with zero violations (enhancement-never-dependency), logging once
  - text with no refs at all short-circuits without calling the lookup
- [ ] **Step 2:** FAIL → **Step 3:** implement:
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
- [ ] **Step 4:** green.

### Task 3: Wire verification into the four surfaces

**Files:** `daily-devotion-pipeline.ts`, `bible-chat-pipeline.ts`, `insight-body.ts`, `monthly-reflection-pipeline.ts` (+ their tests)

- [ ] **Step 1: daily devotion — failing test.** Verification runs over `scripture.text` + `reflection` prose; a near-miss anchor quote is repaired **in the persisted artifact** (assert the inserted `body`, not just the return); a wrong quote fails validation and feeds the stricter retry. Note the ordering: verification joins the existing `makeDailyDevotionValidate` chain **after** citation + content rules (cheapest gates first, and a citation failure makes verification moot).
- [ ] **Step 2:** implement + green.
- [ ] **Step 3: chat replies — failing test** for both surfaces (study + journaling share `makeBibleChatValidate`). Repairs apply to the reply before persistence.
- [ ] **Step 4: streaming caveat.** The user has already *seen* the streamed text when a repair lands. Confirm what the client does with the `done` payload's `reply`: if it re-renders from the payload, emit the existing `refining` beat before `done` so the swap is explained; **if it does not re-render, that's the real fix** — make it, and pin it with a test. Do not ship a silent divergence between what was streamed and what was saved.
- [ ] **Step 5: etymology insight — failing test.** Verification runs on the body before the shared-cache insert (it already has a content-rules gate there from Phase 0 — extend that block, don't add a second one). A violating body is never cached.
- [ ] **Step 6: reflection markers — failing test.** Markers get **`unresolvable_ref` checks only** — the letter carries no verse-level citations by design (validator 2 forbids them), so there are no quotes to match. Do not run quote matching over the letter; it would false-positive on the reader's own remembered phrasing.
- [ ] **Step 7:** all four green; full `npx vitest run supabase/functions`.

### Task 4: Adapter carries provenance

**Files:** `lamplight-adapter.ts`, `supabase-lamplight-adapter.ts` (+test), `fake-lamplight-adapter.ts`

- [ ] **Step 1: failing adapter test** — the daily-devotion read (currently `.select('body')`, `supabase-lamplight-adapter.ts:128`) also returns `source_note_ids`, `source_verses`, `model_used`, `prompt_version`, `source_library_chunks`; the reflection read (currently `.select('period_key, title, body, created_at, saved_to_notes')`, ~line 494) likewise. Shape them into one `ArtifactProvenance` type shared by both.
- [ ] **Step 2:** implement — widen the selects, map snake_case → camelCase **inside the adapter only** (house rule), extend the interface, and mirror in `FakeLamplightAdapter` with a `__seedProvenance` helper so component tests can drive the panel.
- [ ] **Step 3:** green. **Note:** `source_note_ids` are ids, not titles — the panel needs note titles, so add a `resolveNoteTitles(ids)` adapter method (or reuse an existing note read) rather than rendering raw uuids at the user.

### Task 5: `LamplightProvenancePanel`

**File:** `src/notepad/components/lamplight/LamplightProvenancePanel.tsx` (+`.test.tsx`)

- [ ] **Step 1: failing component tests** (jsdom pragma) — renders "Drawn from your notes" with resolved note **titles** (never uuids); renders the scripture refs; renders library sources as `<sourceLabel> — <heading>` when `sourceLibraryChunks` is present and **omits that section entirely when null** (the "library never ran" case must not render an empty header); renders model + prompt version in a de-emphasized footer; the whole panel is behind a disclosure that is **closed by default** (this is reassurance-on-demand, not clutter); the trigger has an accessible name.
- [ ] **Step 2:** FAIL → **Step 3:** implement, matching the existing card's visual grammar (Cormorant Garamond for quoted material, uppercase tracking for labels — see `TodaysLampCard.tsx:79-157`). Copy: **"How this was written"**.
- [ ] **Step 4:** mount on `TodaysLampCard` (a small icon by the header) and on `WaymarksPeriodDetail`. Test each mount renders it with real adapter data.
- [ ] **Step 5:** green.

### Task 6: Sources screen (the CC-BY obligation)

**File:** `src/auth/settings/SourcesSection.tsx` (+`.test.tsx`)

- [ ] **Step 1: failing test** — reads `library_sources` via the adapter, groups by license, renders each source's `title`, `author`, `era`, and its **verbatim `attribution` string** with any required link; an empty table renders a short "no sources yet" state rather than a broken heading (true until 1b runs).
- [ ] **Step 2:** implement; mount in `ProfilePage` beside `LamplightSettingsSection` (follow that section's shape and props convention).
- [ ] **Step 3:** green. **This is the license-compliance surface** — CC-BY for OpenBible and STEPBible requires visible credit. It is not optional polish.

### Task 7: Eval harness v1

**Files:** `scripts/eval-lamplight.ts` (+test), `scripts/eval-fixtures/*.json`, `docs/lamplight/evals/README.md`

- [ ] **Step 1: build ~10 synthetic persona fixtures** — sparse month, grief month, ordinary month, doubt season, heavy-study month, contested-passage-heavy, no-first-name, long-vault, brand-new user, non-English name. Each: notes (with dates), highlights, and expected-property assertions. **Synthetic only** — never a real user's vault, and say so in the README.
- [ ] **Step 2: failing tests for the pure scoring layer** — a report aggregates per-fixture results into pass/fail counts; a scripture violation anywhere marks the run failed; token/cost tallies sum correctly per artifact kind.
- [ ] **Step 3:** implement the runner: `--artifact=reflection|devotion|study-chat`, `--live` (real key + real models) vs `--dry` (context assembly only, no spend), `--fixture=<name>` for one-off debugging.
- [ ] **Step 4: per-run checks** — deterministic validators pass; `verifyArtifactScripture` reports **zero** violations; judge verdicts recorded; banned/contested/growth families clean; token + cost tally per artifact; **output snapshots written for human read-through** (the register question — "does this sound like Lamplight?" — is not machine-checkable, and the report should say so rather than implying a green run means good prose).
- [ ] **Step 5:** write `docs/lamplight/evals/README.md`: how to run, what each check means, what a green run does and does **not** prove, and the standing gate — **run before any `prompt_version` bump, model id change, or effort change; attach the report to the PR.**
- [ ] **Step 6:** run it once live against the current prompts and check in the baseline report. That baseline is what every later change is compared against.

### Task 8: Gates + close-out

- [ ] **Step 1:** `npx tsc -b` exit 0; full `npx vitest run` green; `npx eslint` clean on touched files.
- [ ] **Step 2: browser verification** — open Today's Lamp, expand "How this was written", confirm note titles/refs/sources render and the panel is closed by default; open a Waymarks stone and confirm the same; open Profile and confirm the Sources section lists the corpus with credit lines.
- [ ] **Step 3: update the backlog** — mark P2-2 (transparency panel) and P2-8 (inline verse-ref validation) closed in `docs/superpowers/lamplight-followups.md`, noting that P2-8 shipped with *repair* semantics rather than the flag-only behaviour it originally described.
- [ ] **Step 4: close out Phase 1** — append a completion record to the Phase-1 design doc summarizing all four slices, and note in the brainstorm §14 that Phase 1 is done and Phase 2 (Journey Thread) is next to design.

## Open questions (resolve during execution, none blocking)

- The 0.9 token-overlap repair threshold is a starting point. If the baseline eval shows repairs firing on legitimately different translations (a user reading KJV while the allowlist is BSB), raise it or make it translation-aware.
- Should chat replies verify **before** the `done` beat (blocking, adds latency) or after (already shown, then corrected)? Default: before persistence but after streaming, with the `refining` beat covering the swap — revisit if the swap reads as jarring in practice.
- Does the provenance panel belong on study-chat replies too? Out of scope here (chat has no artifact row), but worth considering once the library is live in 1c.
