# Study Insights — Design

> Design for the Insights section in the Study tab. Talk-through and gap analysis: `2026-08-06-study-insights-brainstorm.md`. Builds directly on Phase 1 of the depth overhaul (`2026-08-04-lamplight-library-and-reasoning-design.md`) — the library, the Responses API migration, Scripture verification, and the eval harness are all assumed present and live.

## Purpose

Turn the corpus Phase 1 ingested into something a reader can **browse** rather than interrogate.

Today a reader who wants to understand Psalm 27:4 has two surfaces: a thin reference rail they read as furniture, and a chat box that rewards expertise the feature exists to build. The 34,076 library chunks — Spurgeon, Matthew Henry, JFB, the creeds — are invisible, used only as prompt filler.

Insights is a full-screen study of the open passage that opens outward — verse → chapter → book → canon — where **every claim is visibly one of three things**: data we hold, a named voice from the church's study, or Lamplight's own synthesis under the same validators that guard chat.

## Decisions log

**Decided 2026-08-06 (Myles):**

1. **Placement → full-width overlay.** Insights opens over the whole Study workspace (rail and reader both hidden), not as a side-panel tab. Entry is a Reflections-styled pill in the Study side-panel tab row. Rationale: a twelve-section scholarly document does not fit 360px, and the overlay gives the two-column reading layout the content wants.
2. **Interpretive traditions → acquire sources first.** No section may present a tradition we hold no corpus for. Corpus expansion is **Phase A of this project** (§3), in two tracks: **A1** public-domain adapters (engineering only, no permission needed) and **A2** rights acquisition (Myles-led — §3.2 is the worklist). All six requested traditions are in scope; A2 is where the four needing permission or a license audit get secured.
3. **Content structure → two generated doors, not one document.** Clicking Insights presents grouped entry points rather than one long scroll:
   - **Door 1 — The Passage:** Overview · In the Chapter · The Chapter's Shape · Reflection & Application
   - **Door 2 — Deeper In:** How to Read This Passage (hermeneutics) · Historical & Cultural Setting · Theological Significance · Read With Care
   - **Door 3 — Sources & Reference** (added; §5): Book Context · Voices from the Church's Study · Original Languages · Cross-References
   Rationale (Myles): *"it doesn't all show on one whole thing but broken up into smaller easier to digest way."*
4. **Caching → global shared cache, explicit generate.** Cached passages render instantly from a public-read row; an uncached door shows a *Study this passage* action rather than auto-generating. Cheapest and most predictable; pairs exactly with the door structure — each door is one generation batch and one cache group.

**Recommended defaults (engineering-level; flag to change):**

5. **Cached rows are public-read**, matching `bible_etymology_verse_insight` (`for select using (true)`). Reading costs a DB query and is free for signed-out readers; *generating* a miss is entitlement-gated. This makes warmed passages an acquisition surface.
6. **Two cache grains only** — `chapter` and single `verse`. Arbitrary ranges are not cached (§6).
7. **Handoff prefills, never auto-sends**, and appends to the passage's existing study thread rather than opening a new one (§8).
8. **Duplication with `ApparatusRail` is resolved by component reuse, not by removing the rail** (§5). One implementation, two entry points.
9. **Section omission is first-class.** A section with no supplied warrant does not render — no placeholder, no apology (§9).
10. **Naming:** the feature is *Insights*; the existing chat-opening `mode: 'insight'` is renamed `mode: 'opener'` to clear the collision (§10).

## Scope

### In
- **Phase A** — corpus expansion (§3), two tracks: **A1** ingest adapters + `library_sources` rows for the public-domain tradition-broadening works, with the license evidence trail the existing runbook requires; **A2** the rights-acquisition worklist (§3.2), which Myles runs and which lands source-by-source without blocking Phase B.
- **Phase B** — the Insights feature:
  - Migration: `bible_passage_insight` table (§6) + RLS.
  - `InsightsOverlay` — full-screen shell, scope chip, three doors, per-door generate action.
  - Door 3 assembled from **existing components** (`OriginalLanguagePanel`, `EtymologyPanel`, `RegionMapBlock`, a book-context block extracted from `ApparatusRail`) plus a new `LibraryVoices` component (class B, §4).
  - Edge function: a new generation mode over the existing `buildStudyContext` + `runBibleChatPipeline` — one structured call per door.
  - Verse-scope grounding: narrow `libraryAnchors` to the selected verse; supply neighbouring-verse text for literary context.
  - Lamplight handoff seam: seeded prompt + scope + section into `LamplightStudyPanel` (§8).
  - Mobile: overlay behaviour + tab handoff (§7).
  - Eval fixtures for the new prompts (§9), including the hazard cases in §11.
- Rename `mode: 'insight'` → `mode: 'opener'` and un-park `requestStudyInsight`.

### Out (explicitly)
- **Typed connection explanations** (Greidanus roads, Hays confidence tiers, the Beale typology gate). Cross-references carry **no generated "why."** That contract belongs to Pillar D / Phase 3 of the depth overhaul; shipping an ungoverned version here would mean allegorical drift and then a rewrite. Instead the reader gets the connection *shown* rather than asserted — each ref expands in place to the target passage in its own context, with that passage's book context and library voices (§4). When Pillar D lands, its explanation drops into a slot that already exists.
- Journey Thread personalization (Phase 2). Insights are global by construction (§6) and carry no per-user content.
- Removing or restructuring `ApparatusRail`.
- Arbitrary multi-verse-range caching (§6).

## 1. The spine: three content classes

The generated/sourced distinction is the design's organizing principle, not a footnote. It drives the door structure, the cost model, and the trust presentation.

| Class | Source | Cost | Hallucination risk | Treatment |
|---|---|---|---|---|
| **A — Held** | `bible_books`, `bible_cross_references`, `bible_interlinear`, `bible_lexicon`, `bible_etymology_verse_insight`, region maps | Free, instant | **Zero** | Rendered plainly; no badge — it's the furniture |
| **B — Voiced** | `library_chunks` verse-range join on this exact ref | Free — a SQL join, **no embedding call, no LLM** | **Zero** — quoted text | Named card: *Treasury of David · Spurgeon, 1869–1885 · on Ps 27:4* |
| **C — Synthesized** | Lamplight over A + B, through the existing validator stack | ~$0.03–0.06 per door | Managed (§9) | Lamplight's voice, hedged where the data hedges, sources listed |

**Door 3 is entirely A + B.** It renders the instant the overlay opens, with no AI call and no entitlement gate. Doors 1 and 2 are entirely C. That alignment is why the door structure works: it separates *free and instant* from *generated and gated* along a line the reader can feel.

The class-B join already exists — `overlapsRef()` in [`_shared/library-retrieval.ts`](supabase/functions/_shared/library-retrieval.ts) is exactly this query, currently used only to feed prompts. Surfacing it is close to free and is the strongest trust artifact in the feature.

## 2. Where Insights lives

**Entry.** A pill in the Study side-panel tab row, styled after `ReflectionsButton` — rounded outline, own accent token, distinct from the flat Notes/Chat/Memorize tabs, because like Reflections it opens a destination rather than switching an in-pane tab.

**Desktop.** Full-screen overlay above the workspace; header carries the passage, the scope chip, and a close control. Two-column reading layout at ≥1024px; single column below.

**Mobile.** Full-screen route-like overlay over the tab bar, with a back affordance. The Reader and Context tabs stay mounted beneath (the workspace already toggles panes with `display`), so closing Insights returns the reader exactly where it was.

## 3. Phase A — corpus expansion

Decision 2 means no tradition section ships on improvised knowledge. Two tracks run in parallel: **A1** is adapter work over sources we can already use; **A2** is rights acquisition, which Myles runs.

### 3.1 — A1: reachable from public domain (engineering only)

| Tradition | Work | License | Channel | Coverage |
|---|---|---|---|---|
| Church Fathers | **Catena Aurea** (Aquinas, tr. Newman 1841) | PD | CrossWire SWORD — **already verified in the research doc's module list** | Gospels |
| Catholic | Catena Aurea (above); **Haydock** (1859) | PD *(Haydock needs verification)* | SWORD; e-Sword modules | Gospels; whole Bible |
| Wesleyan / Methodist | **Wesley's Explanatory Notes**; **Adam Clarke** | PD *(verified)* | SWORD `Wesley`, `Clarke` | Whole Bible |
| Reformed | **Calvin's Commentaries** (CTS tr.); **Geneva notes** (1560/1599 original only) | PD *(verified)* | SWORD `CalvinCommentaries`, `Geneva` | Calvin partial |
| Jewish exegesis, secondhand | **John Gill** — the research doc rates him "strongest on Hebraica/rabbinics" | PD *(verified)* | e-Sword modules | Whole Bible |

Five of these are already sitting in channels the repo has ingest tooling for (`scripts/ingest-library.ts` + `scripts/library-adapters/`). This is adapter work and a license evidence trail, not an open-ended acquisition project.

### 3.2 — A2: rights acquisition worklist (Myles-led)

Each item below is a permission conversation or a license audit, not engineering. They are independent of each other and of Phase B; each one lands by adding a `library_sources` row and an adapter, which the Phase-1 schema already anticipates (`tradition`, `register`, `license`, `attribution` are existing columns).

| Target | Why it matters | Who to approach / what to check | License bar |
|---|---|---|---|
| **Early Jewish** — Rashi, Midrash Rabbah, Targums | The only direct Jewish-interpretation layer; Gill is secondhand | **Sefaria.** Corpus is licensed **per text** — some CC0/CC-BY (usable), but the William Davidson Talmud is **CC-BY-NC** (not usable commercially). Sefaria publishes per-text license metadata via its API; audit text by text. They are mission-driven and may grant beyond the posted license if asked | Commercial use + derivatives; **NC is disqualifying** |
| **Church Fathers** beyond the Catena | Catena Aurea covers Gospels only; ANF/NPNF is the full patristic corpus | Schaff's **translations are public domain**; the obstacle is a clean transcription. CCEL claims copyright on *their editions* (research doc, verified) — either request CCEL commercial permission, or source from archive.org scans, or Wikisource (**CC-BY-SA → ShareAlike quarantine**, same handling as unfoldingWord/Theographic) | Prefer a PD transcription with no edition claim; avoid ShareAlike if a clean path exists |
| **Contemporary scholarship** | The one tradition with no PD path at all | **NET Bible translators' notes** (bible.org) — 60k notes, permission-required but permission-friendly, already a planned v2 conversation. **Enduring Word / David Guzik** — best modern devotional-register commentary, also permission-friendly | Commercial use + excerpting in-product; no per-query fee |
| **Orthodox** | Distinctively Orthodox commentary is modern and in copyright | **Ancient Faith Publishing**; **Chrysostom Press** (Blessed Theophylact commentaries); **St. Athanasius Academy / Thomas Nelson** (Orthodox Study Bible notes); the OCA | Commercial use + excerpting; expect a licensing fee — worth scoping cost before committing |
| **Catholic** — Haydock (1859) | Broadens Catholic coverage past the Gospels | PD by date, but **verify the module's provenance** before ingest (the same discipline applied to Creeds.json) | PD confirmation only |

**The acceptance bar for any new source**, so a negotiation can be evaluated without a second round-trip: commercial use permitted · excerpting and derivative works permitted · in-product redistribution permitted · no per-query or per-seat fee · attribution requirements are acceptable and render on the Sources screen. **Non-commercial (NC) clauses are disqualifying.** ShareAlike is usable but forces the quarantine handling the repo already has.

### 3.3 — What ships while A2 is in flight

Phase B is **not blocked on A2**. The tradition section renders whatever `library_sources` holds at the time and states its own coverage in its header — naming both the traditions represented and those not yet. As A2 items land they appear without a code change: a new source row, an adapter run, and the section widens on its own. That is the property worth protecting through implementation — **no section should hardcode a tradition list.**

## 4. Door 3 — Sources & Reference (class A + B)

Renders immediately, free, signed-out included.

- **Book Context** — all eight `bible_books` fields, including `author_note`, which carries the authorship hedge verbatim ("traditionally attributed to Moses; authorship debated"). Extracted from `ApparatusRail` into a shared component.
- **Voices from the Church's Study** — the class-B join. Each excerpt a named card with source, author, era, and the ref it comments on. Header states the corpus's composition and era plainly, naming the traditions currently represented and those not yet — read from `library_sources` at render time, never hardcoded (§3.3), so an A2 arrival widens it on its own.
- **Original Languages** — `OriginalLanguagePanel` + `EtymologyPanel`, reused as-is, scoped to the selected verse.
- **Cross-References — expandable in place.** Rows render as they do today (ref · text · `OT ↔ NT` badge). Tapping one **expands it inline, in the same section**, rather than navigating anywhere:
  - the referenced passage with a verse or two of surrounding context, so the reader sees it in its own setting rather than as a fragment;
  - a one-line book context for *that* ref (`bible_books` — author, era, genre), so a jump from Psalms to Hebrews lands with its footing;
  - **voices on that ref** — the same class-B verse-range join, run against the target passage.

  All class A + B: free, instant, no generation, no navigation. Still **no generated "why they connect"** (Scope/Out) — the reader gets both passages side by side and draws the line themselves, which is what the deferred Pillar D contract exists to do responsibly later. Multiple rows may be open at once; expansion state is local and resets with the passage.

## 5. Duplication with `ApparatusRail`

The overlay choice leaves the rail in place, so book context, cross-refs, and original languages have two entry points. **Resolved in code, not in product:** Door 3 imports the same components the rail renders. The book-context block — the only piece currently inlined in `ApparatusRail` — is extracted to a shared component and both call it. Two doors, one implementation, no drift.

## 6. Data model and caching

Insights are **not personal** — the historical setting of Psalm 27 is identical for every reader. That makes them a global, cacheable, human-reviewable asset, and lets us reuse the house pattern from `bible_etymology_verse_insight`.

```sql
create table public.bible_passage_insight (
  scope           text not null check (scope in ('verse','chapter')),
  ref_id          text not null,           -- 'psa.27.4' | 'psa.27'
  door            text not null check (door in ('passage','deeper')),
  section         text not null,           -- 'overview' | 'hermeneutics' | …
  body            text not null,
  sources         jsonb not null default '[]',   -- library chunk provenance
  model_used      text,
  prompt_version  text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  primary key (scope, ref_id, section)
);
```

Public-read RLS mirroring the etymology table. `door` is denormalized onto the row so a whole door loads in one query and invalidates as a unit.

**Grain.** `chapter` and single `verse` only. Arbitrary ranges would explode the key space — Psalm 119 alone has 15,576 possible ranges. A multi-verse selection resolves to the chapter grain, shows the selection in the scope chip, and offers "focus these verses →" into chat, which is the right tool for an arbitrary span.

**Generation.** Explicit, per door (decision 4). An uncached door shows *Study this passage*; the action generates that door's four sections in one structured call and writes four rows. Doors cache independently — Door 1 warmed and Door 2 cold is a normal state.

**Cost.** ~1,200 output tokens per door at `deep`/medium ≈ **$0.03–0.06 per door, per passage, ever** — not per user, not per open. A background sweep can warm the most-read chapters later; nothing in the design requires it.

## 7. Generation architecture

**Reuse `lamplight-study` wholesale.** A new mode over the existing `buildStudyContext` → `runBibleChatPipeline` path: same citation allowlist, same `applyContentRules`, same Layer C classifier, same `verifyArtifactScripture`, same stricter retry. **No second grounding path.**

Two changes to `buildStudyContext`:
- **Verse-scope anchoring.** It currently anchors the library at chapter granularity; verse-scope Insights narrow `libraryAnchors` to the selected verse (plus resolved cross-ref targets, as today).
- **Neighbouring-verse text**, supplied explicitly so "In the Chapter" has the immediate literary context to reason over. The chapter is already fetched — this is a slice, not a query.

Each door is one structured tool call emitting four named text fields, which the existing streaming infra already supports per-field. Streaming is optional for v1 given the explicit-generate model, but the section-by-section reveal is close to free if wanted.

**Retrieval steering.** `searchLibrary` already takes `registers` — Door 2's hermeneutics and theology sections bias `exegetical` and `confessional`, Door 1 biases `devotional`.

## 8. Context passing

Today `LamplightStudyPanel` takes only `{ book, chapter, userId }`, and `selectedVerse` stops at `ApparatusRail`. Three seams:

1. **Reader → Insights.** `selectedVerse` is already lifted in both workspaces; thread it to the overlay the way it reaches the rail today.
2. **Insights → Chat.** A seeded-prompt seam carrying `{ text, scope: { book, chapter, verse? }, section }`. **Prefills, never auto-sends** — the reader stays the author of their question, and editing costs nothing. **Appends to the passage's existing thread**; threads are keyed `(user_id, passage_ref, surface='study', archived=false)`, so a new thread per handoff would fragment history.
3. **Section → retrieval steering.** The section travels with the prompt so "explore this Hebrew word" biases lexical sources and "compare interpretations" biases commentary.

On mobile the handoff closes the overlay, switches to the Study tab, and lands in Chat with the draft present. Panes stay mounted, so the draft survives — the seam is shared draft state, not a remount.

Every section footer carries 2–3 seeded prompts, scoped to that section.

## 9. Accuracy safeguards

Everything class C inherits from the existing pipeline: the citation allowlist (`allowedVerseRefs` — **library excerpts never widen it**, the load-bearing rule from Phase 1), banned phrases, contested passages, the Layer C doctrinal classifier, and `verifyArtifactScripture`, which repairs a fuzzy-matched quote to canonical text before it ever rejects.

Three additions specific to Insights:

- **Minimum warrant.** Every class-C section declares the grounding it used. No supplied warrant → **the section is omitted**, not padded. Omission renders as nothing at all — no placeholder, no apology. This is the primary defence against twelve-sections-of-mush.
- **"Read With Care" is constrained to interpretive moves, never groups.** Permitted: context-stripping, etymology-as-meaning (the root fallacy), genre errors (proverb read as promise, apocalyptic as chronology), anachronism. Forbidden: any caution aimed at a tradition, denomination, or group. A caution with no warrant in the supplied sources or the passage's own literary data is omitted.
- **Hedges are inherited, never resolved.** Where `bible_books.author_note` records a dispute, class C must carry the dispute forward. Resolving a hedge the data leaves open is a validator-level failure, and belongs in the eval set.

**Prefer citing refs over quoting text** in class C. Verification repairs quotes, but a ref costs nothing and is translation-agnostic (§11).

## 10. Naming

"Insight" currently means three things: the chat-opening observation (`mode: 'insight'`, `STUDY_INSIGHT_PROMPT`, the parked `requestStudyInsight`), the cached etymology word study (`bible_etymology_verse_insight`), and now this feature. The feature keeps the name; **`mode: 'insight'` becomes `mode: 'opener'`** — it is an opening observation, and the rename is mechanical. The etymology table keeps its name (it's specific enough with its prefix).

## 11. Edge cases

- **Multi-verse selection** → chapter grain + scope chip + "focus these verses" handoff.
- **Nothing selected** → chapter grain. The default and the grain worth warming.
- **First / last verse of a chapter** → "In the Chapter" must reach across the boundary or say it sits at one.
- **Disputed authorship or dating** → §9 hedge-inheritance rule. Eval fixtures: Hebrews, 2 Peter, Daniel, Isaiah.
- **Thin library coverage** — outside the Psalter, Treasury is absent and class B narrows to Henry + JFB (broadening in Phase A). Graceful degradation is already the library contract; Door 3 renders what exists.
- **Signed-out readers** → cached rows read free (decision 5); doors that need generating show the sign-in path.
- **Genre extremes** — genealogies, legal codes, one-line proverbs, Psalm superscriptions: several sections will legitimately have nothing to say. The omission rule covers it; these belong in the eval set.
- **Psalm superscriptions and versification** — a known live hazard (`docs/lamplight/evals/2026-08-06-superscriptions/`), and verse-scope grounding is more exposed than chapter-scope chat. Reuse the TVTMS-aligned refs; add superscription fixtures.
- **Rapid verse tapping** → cache reads may be eager; generation is explicit by design, so there is nothing to debounce.
- **Translation** → most sections are translation-agnostic. The §9 cite-don't-quote preference keeps them so; revisit only if evals show drift.

## 12. Build order

- **Phase A1 — PD corpus (engineering).** Adapters for Catena Aurea, Wesley, Clarke, Calvin, Geneva, Gill; license evidence trail per the existing ingest runbook.
- **Phase A2 — rights acquisition (Myles, §3.2).** Runs in parallel with everything; each item lands independently as a source row + adapter. Nothing in Phase B waits on it.
- **Phase B1 — the free spine.** Overlay shell + scope chip + Door 3 entirely, including inline cross-ref expansion. No AI, no new table, no edge-function change. **Ships standalone and is independently valuable** — it makes the library visible for the first time.
- **Phase B2 — Door 1.** `bible_passage_insight` migration, the generation mode, explicit-generate action, handoff seam.
- **Phase B3 — Door 2.** The deeper tier, including Read With Care under its §9 constraints.
- **Phase B4 — mobile parity + eval fixtures + the `mode: 'opener'` rename.**

Phase B1 is worth calling out: it delivers the single highest value-per-line item in the request (making 34,076 chunks of Spurgeon, Henry, and JFB browsable) with zero AI cost, zero hallucination surface, and no dependency on Phase A.

## 13. Open items

1. **Door names.** "The Passage" / "Deeper In" / "Sources & Reference" are functional placeholders; they want a pass in the app's voice (cf. Waymarks, Lamplight, Today's Lamp).
2. **A2 outcomes** (§3.2) — each conversation resolves on its own timeline and widens the tradition section without a code change. The one design constraint that must survive implementation: **no section hardcodes a tradition list** (§3.3).
3. **Whether Door 1 streams** on generation, or renders on completion. Explicit-generate makes a spinner acceptable; streaming is nearly free if the reveal is wanted.
4. **Precompute sweep** — deferred. Worth revisiting once real usage shows which chapters concentrate.

---

*Prepared 2026-08-06 on `feat/reflections-before-lamplight`. Decisions 1–4 from Myles, 2026-08-06.*
