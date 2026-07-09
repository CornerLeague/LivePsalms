# Etymology Study Feature — Design Spec

**Date:** 2026-07-08
**Status:** Design approved (brainstorming complete) — pending implementation plan
**Feature:** A dedicated, collapsible **Etymology** panel in the Study tab where Lamplight explains how key Hebrew words grew from their roots — grounded in a real lexicon (Strong's derivation + BDB), never invented.

---

## 1. Overview

The Study tab already surfaces per-verse Hebrew/Greek data via the **Original Language** panel (interlinear tokens + Strong's entries). This feature adds a sibling **`EtymologyPanel`** directly beneath it: a verse-driven slideshow ("deck") of the verse's words, each card showing the word's **root**, a short **"how it grew"** narration, and its **related words** — all grounded in the lexicon. A per-verse **"Ask Lamplight about this verse"** action generates a shared, verse-specific insight on demand.

The core etymology content is **pre-generated offline, human-proofed, and cached** in the database; it reads free and public for everyone (including logged-out visitors). The only gated, on-demand action is *generating* a not-yet-existing verse insight.

**v1 scope: Psalms + Hebrew only.** Greek/NT (Thayer) and the rest of the Old Testament are explicitly deferred; the schema grows by adding rows, not by changing shape.

---

## 2. Goals & non-goals

**Goals**
- Show, for a studied verse, how its key Hebrew words derive from their roots, in the word's natural (RTL) reading order.
- Keep every factual claim traceable to a real lexicon (Strong's `derivation` + BDB). Narration retells verified facts; it never invents etymology.
- Make the grounded-vs-narrated distinction legible in the UI (verified facts marked; the one narrated block marked as Lamplight).
- Reads are free and public; a single, shared per-verse insight can be generated on demand by entitled users and is then free for everyone.

**Non-goals (v1)**
- No Greek / New Testament etymology (Thayer path deferred).
- No Old Testament books beyond Psalms.
- No per-user private insights — insights are **shared** community content.
- No raw-grounding table in the DB (raw BDB text lives in the offline script inputs, not a runtime table).
- No user report/flag affordance on generated insights (noted, deferred).

---

## 3. Locked decisions (Q1–Q9)

| # | Decision |
|---|----------|
| Q1 | **Grounded-hybrid.** Grounding = OpenScriptures Strong's `derivation` + BDB (`HebrewLexicon`), Hebrew-first. The narration retells only verified facts; never invents. |
| Q2 | **Hybrid word-selection.** Which words earn a full etymology card is curated via a root-level study-value weight (Q4), not "every word." |
| Q3 | **Pure-etymology core + on-demand shared per-verse insight.** The card body is pure etymology; the "Ask Lamplight about this verse" insight is a separate, shared, on-demand layer. |
| Q4 | **Root-level `study_value` weight** (int) drives curation and per-verse star ranking. |
| Q5 | **Dedicated `EtymologyPanel`** — a verse-driven slideshow/deck, mounted beneath Original Language; not inline in the verse text. |
| Q6 | **Full deck including function-word cards** — particles appear as grammar-note-only cards so reading order stays intact. |
| Q7 | **Persistence + offline pre-generation.** Two shared public-read tables; offline seed script; `reviewed` gate; runtime insight via edge function; no raw-grounding table for v1. |
| Q8 | **Reads free/public; only *generation* is gated** through the existing Lamplight entitlement. First tapper spends quota, everyone after reads free. |
| Q9 | **v1 = Psalms + Hebrew only.** Greek/NT and rest of OT deferred; growth = more rows. |

---

## 4. Architecture & data model

### 4.1 Components

- **`EtymologyPanel`** — mounted under `OriginalLanguagePanel` in `ApparatusRail.tsx`; receives `{ verseId, reference }`. Owns the deck's `currentIndex` and open/closed state.
- **`buildEtymologyDeck(tokens, entries)`** — pure util. Takes the verse's `bible_interlinear` tokens (RTL reading order) and the reviewed `bible_etymology` entries, returns the ordered deck (see §7).
- **`useEtymologyEntry(strongs)`** — hook, sibling to `useStrongsEntry`; reads `bible_etymology`, **filters `reviewed = true`**. Returns entry / loading / empty.
- **`useEtymologyVerseInsight(strongs, verseId)`** — hook; reads `bible_etymology_verse_insight`; if absent, exposes a gated `generate()` that calls the edge function.
- **`etymology-insight` edge function** — Supabase edge function mirroring `lamplight-generate`; the Anthropic API key stays server-side. Generates + inserts the shared insight row.
- **Offline pre-generation script** — one-time seed/maintenance script (NOT the Vercel/CI build) that populates `bible_etymology` for every unique Psalms Hebrew Strong's number, `reviewed = false`, for a human proofing pass.

### 4.2 Tables

Both tables are **public-read shared** (RLS `using(true)` for select), mirroring the existing `bible_strongs` caching pattern.

**`bible_etymology`** — keyed by Strong's number:

| column | type | notes |
|---|---|---|
| `strongs` | text | **PK** |
| `lemma` | text | the Hebrew lemma |
| `root` | text | root form (verified) |
| `root_gloss` | text | short gloss of the root (verified) |
| `development` | text | Lamplight "how it grew" prose (the one narrated field) |
| `related` | jsonb | `[{ strongs, word, gloss }]` (verified) |
| `study_value` | int | Q4 weight; drives curation + star ranking |
| `source` | text | grounding provenance (e.g. "Strong's + BDB") |
| `model_used` | text | e.g. `claude-opus-4-8` |
| `prompt_version` | text | for regeneration tracking |
| `reviewed` | boolean | **runtime filter gate** (default false) |
| `created_at` | timestamptz | |

**`bible_etymology_verse_insight`** — keyed by word-in-verse:

| column | type | notes |
|---|---|---|
| `strongs` | text | **PK part** |
| `verse_id` | (verse-key type) | **PK part**; same key type the app uses for `selectedVerse` |
| `body` | text | the generated shared insight prose |
| `model_used` | text | |
| `prompt_version` | text | |
| `created_by` | uuid | nullable (who first generated it) |
| `created_at` | timestamptz | |

Composite **PK `(strongs, verse_id)`** — this is what makes generation idempotent (§8, concurrency).

> **Divergence from recon (accepted):** the codebase-recon handoff guessed the insight would reuse the per-user `lamplight_artifacts` table. Q3 locked the insight as **shared**, so a per-user home is wrong — it gets its own shared table. Flagged and accepted.

### 4.3 Grounding pipeline (offline)

```
OpenScriptures Strong's `derivation` + BDB (HebrewLexicon)   [public domain]
        │
        ▼
verified-facts grounding record  (root, root_gloss, related, raw BDB gloss)
        │
        ▼
constrained Opus prompt: "retell ONLY these facts, never invent"
        │
        ▼
development (prose) + related (jsonb) + study_value        →  row with reviewed = false
        │
        ▼
human proofing pass  →  flip reviewed = true   (structural launch gate)
```

The `reviewed = true` runtime filter means future expansion batches (other books, unproofed narration) **cannot leak** into the UI. Re-narration = re-run the script with a bumped `prompt_version`; no separate raw-grounding runtime table (YAGNI).

---

## 5. EtymologyPanel layout & card anatomy

The panel sits collapsed by default beneath Original Language. Expanded, it shows one **card** at a time plus a **deck strip**.

**Card anatomy (top → bottom):**
1. **Word header** — Hebrew (with niqqud) · transliteration · gloss · Strong's number.
2. **Root** — the root form + root gloss. *Verified fact.*
3. **How it grew** — the `development` narration, rendered in `--font-voice` (serif). *The one narrated block.*
4. **Related words** — the `related` list. *Verified facts.*
5. **Ask** — "Ask Lamplight about this verse" button (lexical cards only).
6. **Deck nav** — prev/next, dots, "word X of N" counter.

**Grounded-hybrid made legible:**
- Verified facts (root, related) carry a small **teal check** labelled "from Strong's + BDB".
- The narrated **"How it grew"** block is marked with **accent sparkles + a "Lamplight" tag**.

**Deck strip** — the full verse deck in RTL reading order; key words **starred**; particles (e.g. `לֹא`) shown **dashed**. Opens on the first starred word.

**Function-word cards** are **grammar-note-only**: the particle's in-verse meaning *is* the grammar note. **No "Ask Lamplight" button** — this keeps the single quota touchpoint on lexical words.

Nav is **RTL-aware**: "next" advances leftward (left chevron).

---

## 6. Mobile / Context-tab view

Same card anatomy, **restacked full-width**. The deck strip becomes a **horizontally scrollable RTL strip**. Prev/next use **44px touch targets**; the Ask button is full-width; a **swipe affordance** hints deck navigation. The panel slots into the existing mobile study/context surface unchanged — no new tabs; the app's real tab set stays as-is.

---

## 7. Interaction & state flow

**Inputs & lifecycle.** The panel receives `{ verseId, reference }` from `StudyWorkspace.selectedVerse`. When `selectedVerse` changes, the panel rebuilds its deck and resets `currentIndex`.

**Deck construction (`buildEtymologyDeck`, pure).** The panel first resolves the **set** of reviewed `bible_etymology` entries for the verse's token Strong's numbers (a batched read via `useEtymologyEntry` over the token set — batching is a plan-level implementation detail; a skeleton shows while the set loads). It then builds the deck from the verse's `bible_interlinear` tokens in RTL reading order. A token's **lexical-vs-particle classification comes from its existing interlinear morphology / part-of-speech data** (already carried by `bible_interlinear`):
- lexical token **with** a reviewed entry → **lexical card**
- particle / function-word token → **function-word card** (grammar note only, no Ask)
- lexical token with **no** reviewed entry → **omitted**

Because the entry set (including `study_value` and `reviewed`) is fully resolved before building, **omission and star ranking happen at build time — not lazily per card** (a lazy fetch would flash-then-hide omitted words and couldn't rank before first render).

**Panel activation gate.** The panel renders **iff the deck contains ≥1 lexical card**. Function-word cards are companions *within* an active deck — never a reason to show the panel on their own. Zero lexical cards (out-of-scope verse, non-Psalms, nothing reviewed yet) → the panel is **absent** (graceful no-op). After the full pre-gen + proofing pass, in-scope Psalms verses should have complete lexical coverage; omitted lexical tokens are the exception (e.g. a lemma still pending review).

**Star ranking (per-verse, pinned rule).** Among the deck's lexical cards, sort by `study_value` **descending** (tiebreak: RTL token order) and star the top **N = min(4, lexical-card count)**. No `study_value` floor in v1 (KISS; a floor can be added later if trivial words prove distracting). Because the panel only activates with ≥1 lexical card, an active deck always has ≥1 starred word.

**State ownership** — three owners, no overlap:
- **Workspace** owns `selectedVerse`.
- **Panel** owns `currentIndex` + open/closed. On deck build, `currentIndex` initializes to the **first starred word** in RTL order (defensive fallback: first card).
- **Hooks** own all data: `useEtymologyEntry` (card content), `useEtymologyVerseInsight` (read-or-generate insight).

**Navigation.** Prev/next are RTL-aware (next = left chevron); dots + "word X of N" counter. Desktop: arrow keys. Mobile: swipe. Nav only moves `currentIndex` — it never refetches; all cards for the verse are already resolved.

**The Ask flow (lexical cards only).** On card render, `useEtymologyVerseInsight(strongs, verseId)` reads `bible_etymology_verse_insight`:
- **Row exists** → render the insight prose inline, **free, for everyone** (logged-out included) — it's a DB read.
- **No row** → show the Ask button. On tap → entitlement check via `useLamplightEntitlement` / `useUserTier`:
  - **not entitled** → existing blocked-Lamplight affordance (logged-out → sign-in; out-of-quota → existing upgrade path)
  - **entitled** → button → loading ("Lamplight is reflecting…") → `etymology-insight` edge fn generates the insight (**grounded on the word's reviewed etymology entry + the verse text** — same never-invent discipline) + inserts the shared row → prose replaces the button inline. **The next viewer of that same word-in-verse reads it pre-filled and free.**

**Loading & empty states.** The panel shows a skeleton while the verse's entry set resolves; once resolved, cards render without further per-card fetches. Empty deck → panel absent (above).

---

## 8. Edge cases & error handling

- **Missing / unreviewed entries.** Deck = `lexical tokens ∩ reviewed-entries` (+ particles). Any token whose Strong's lacks a row, or has `reviewed = false`, is silently omitted. The `reviewed = true` filter is structural — unproofed narration physically cannot appear.
- **Empty deck.** No lexical cards → panel **absent entirely** (not an empty error box). Never touches the surrounding Study UI.
- **Generation failure.** If `etymology-insight` fails (model error, timeout, network), the card returns to its **Ask** state with a soft retry message. Invariant: **no row inserted, no quota spent on failure** — quota decrements only on a successful insert. A failed insight *read* degrades the same way (falls back to the Ask button); it never blanks the card.
- **Concurrency.** Two users tapping Ask on the same `(strongs, verseId)` near-simultaneously: the edge fn re-checks for an existing row just before generating (shrinks the window), and the insert uses **`ON CONFLICT (strongs, verse_id) DO NOTHING`** as the hard guarantee. The row is never duplicated; the conflict-loser re-reads and renders the winner's insight. Accepted tradeoff: in a rare true race both may call the model once — a redundant call, never a duplicate row or corrupted state.
- **The one live-generated surface.** Core cards are human-proofed before launch; the verse insight is the only text generated on demand and shown unreviewed. Its guardrail is a **grounded prompt**: the edge fn conditions Opus on the word's already-reviewed etymology entry (root, `development`, related) plus the verse text, so the insight retells established facts rather than inventing. An optional user report/flag affordance is noted but **deferred**.
- **RTL / niqqud / bidi.** Hebrew renders with vowel points intact; deck order, nav direction (next = left), and the counter are all RTL-correct. Mixed Hebrew / transliteration / English within a card must not break bidi layout.
- **Particles.** Function-word cards never fabricate etymology and never show Ask — the particle's in-verse meaning *is* the grammar note.

---

## 9. Testing (TDD)

Tests are written first, per repo discipline.

- **Deck builder (pure unit)** — RTL ordering; `lexical tokens ∩ reviewed-entries` intersection; lexical-vs-particle classification; missing/unreviewed omission; panel-activation gate (≥1 lexical card); per-verse star ranking (`min(4, count)`, tiebreak RTL); opens-on-first-starred.
- **Hooks** — `useEtymologyEntry` cache hit/miss + loading/empty + `reviewed=true` filtering; `useEtymologyVerseInsight` read-hit (free display) vs. read-miss → gated generation path.
- **Edge fn (`etymology-insight`)** — entitlement gating (logged-out / out-of-quota / entitled); insert-once under conflict (`ON CONFLICT DO NOTHING`); **failure = no row + no quota spent**.
- **Anti-hallucination** — a grounding check over the pre-generated prose asserting the narration only references facts present in the grounding record (the launch proofing pass, encoded as a check).
- **Component states** — loading skeleton; empty/absent panel; populated card; insight-present vs. Ask; generation error/retry; RTL nav.

**Completion gate — MUST run `tsc -b`**, not just eslint + vitest. (Repo gotcha: a prod-build type error can hide behind passing lint and tests.)

---

## 10. Deferred / open sub-details

- Greek / NT etymology (Thayer grounding path) — later; new rows, same schema shape.
- Old Testament beyond Psalms — later; new rows.
- User report/flag affordance on generated insights — deferred.
- `study_value` floor for star ranking — not in v1; revisit if trivial words distract.

---

## 11. Attribution

Grounding uses **OpenScriptures Strong's Hebrew dictionary** (~8,674 entries) + **BDB** (`HebrewLexicon`), both public domain. In-app attribution already reads: *"STEPBible (TAHOT/TAGNT, CC BY 4.0) + OpenScriptures Strong's."* The etymology panel inherits this attribution.
