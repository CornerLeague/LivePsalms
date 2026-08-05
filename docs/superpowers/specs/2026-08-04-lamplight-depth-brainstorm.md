# Lamplight Depth & Grounding — Brainstorm

> **Status: brainstorm, not a settled design.** This is the talk-through document for the Lamplight quality overhaul. Once the open decisions (§12) are settled, each pillar graduates into its own `-design.md` + implementation plan per the superpowers workflow. Research backing: the four reports in `docs/superpowers/research/2026-08-04-*.md`.

## 1. The mission

Make Lamplight's responses come from somewhere real — so that a user feels both *known* and *taught*:

1. **Deeply personal** — responses that know the user's walk: the questions they keep circling, the passages they keep returning to, the season they're in — drawn from their notes, studies, highlights, and the backlink graph they've built.
2. **Deeply grounded** — theological and biblical context from verified, credible, trusted sources: the church's actual accumulated centuries of study (commentaries, lexicons, creeds), retrieved and cited — never improvised from model memory.
3. **Connected the way Scripture is connected** — explanations of *why* passages belong together (quotation, typology, shared covenant thread, longitudinal theme), not just that they do.
4. **Companioned** — a biblical character attached to the user's journey by *principled-values resonance* (how they stand before God under pressure), never by plot similarity or personality-quiz logic.

One sentence: **Lamplight becomes the only AI companion that cites the church's trusted library, knows your journey with receipts, and explains why Scripture connects — while staying under the authority of Scripture and the local church rather than replacing either.**

### Why this wins (from the landscape research)
- The #1 trust destroyer in this market is misquoted Scripture (YouVersion CEO: models misquote 15–60%; Barna: 83% of practicing Christians fear AI misinterpreting Scripture). The #1 trust builder is visible citations to a *named* corpus (Logos, Magisterium AI, Hallow). Lamplight's allowlist+validator DNA is already ahead of most competitors — this overhaul makes grounding the headline promise.
- The personalization moat in AI journaling is *longitudinal memory with receipts* (Rosebud's most-loved feature; Psalmlog's "journey memory"). Nobody in the faith space has verse-anchored longitudinal callbacks. Lamplight's backlink graph makes them verifiable.
- Nobody has a serious character-resonance feature — the existing "which Bible character are you" products are quizzes with horoscope mechanics. Done with theological discipline, this is a category-defining feature.

## 2. Where the system stands

Full audit: `research/2026-08-04-lamplight-system-map.md`. The short version:

**Strong foundations (extend, don't replace):** the voice fragment + banned-phrase/contested-passage guardrails; the Waymarks pipeline (5-provenance candidate pool → allowlist → six deterministic validators → LLM register judge → stricter retry); BSB verse embeddings + `bible_cross_references` (votes) + `bible_books` apparatus + interlinear/Strong's/etymology tables; the GenerationLifecycle/GenerateWithRetry/NoteContext seams that make new artifact kinds cheap; provenance columns already persisted on every artifact.

**The six gaps this brainstorm addresses:**
| # | Gap | Today |
|---|---|---|
| 1 | No theological source library | Study prompt literally says "there is no structured lexicon yet" (stale — lexicon tables exist, but no commentary corpus at all) |
| 2 | Personalization is shallow | First name + a time-boxed note window; nothing learns across months |
| 3 | No character resonance | Doesn't exist |
| 4 | Intertextual depth is thin | Cross-refs surface as bare ref+text; no *why*, no typology/theme layer |
| 5 | Backlink graph never reaches prompts | The strongest personalization signal is unused in generation |
| 6 | Reasoning forced off on every call | Chat Completions + forced tools constraint; deep tier runs as a non-reasoning model |

**Found bugs to fix regardless of this project (Phase 0):** Study chat streaming runs `balanced` instead of `deep` (chip spawned); stale lexicon line in study prompt; three prompts bypass the voice fragment; Layer C classifier hook unwired (P0-5); daily-devotion word/char bounds mismatch.

## 3. The five pillars

The overhaul is five pillars on one foundation. Each is independently shippable; they compound (§10).

```
            ┌─────────────────────────────────────────────┐
            │  E. Model & reasoning upgrade (Responses API)│
            └─────────────────────────────────────────────┘
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ A. The       │ │ B. Journey   │ │ C. Witnesses │ │ D. Connections│
   │ Library      │ │ Thread       │ │ (characters) │ │ Engine        │
   │ (grounding)  │ │ (person)     │ │ (companioned)│ │ (intertext)   │
   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
            ┌─────────────────────────────────────────────┐
            │  Trust & safety floor: verse verification,   │
            │  entailment judge, Layer C, crisis layer,    │
            │  doctrinal review board, transparency panel  │
            └─────────────────────────────────────────────┘
```

## 4. Pillar A — The Library (grounded theological corpus)

**What it is:** a license-clean corpus of the church's most trusted study material, verse-anchored, embedded, and retrieved into every Lamplight surface — with source names visible to the user.

### Corpus (from the licensing research — every license verified)

**v1 lean cut (~8M tokens, ~50 MB, zero attribution obligations):**
- **Spurgeon's Treasury of David** — the definitive Psalms commentary, public domain. *For a Psalms-branded app this is the flagship acquisition.*
- **Matthew Henry Concise** (whole Bible, devotional register, ~800k tokens — best cost/coverage) + selectively Matthew Henry Complete.
- **Jamieson-Fausset-Brown** — terse, verse-keyed, exegetical second voice.
- **Creeds.json Unlicense subset** — Apostles'/Nicene/Athanasian, Westminster + catechisms, Heidelberg, etc. (grounds the "historic, creedal orthodoxy" the voice fragment already promises).
- Already in place: BSB text + OpenBible cross-refs (the `bible_cross_references` table *is* the CC-BY OpenBible dataset).

**v1.5 (CC-BY, attribution screen required):** STEPBible TBESH/TBESG lexicons + TVTMS versification map (upgrades the existing etymology feature's ground truth); Berean interlinear tables (public domain); OpenBible topical scores (modern phrasing: "anxiety," "waiting" — feeds devotion/theme retrieval).

**v2 (permission conversations, both permission-friendly):** NET Bible translators' notes (bible.org); Enduring Word / David Guzik (the best modern devotional-register commentary). Also: unfoldingWord TN/TW and Theographic (CC BY-SA — quarantined data layer).

> **Decided 2026-08-04:** v1 ships the lean PD cut **and** the CC-BY layer together (STEPBible lexicons + TVTMS, Berean interlinear tables, OpenBible topical scores) — so the attribution screen is day-one scope, and the etymology feature's ground truth upgrades in the same phase. v2 remains the permission conversations.

**Never ingest:** BibleProject (no derivatives), Got Questions (200-word cap), Louw-Nida (UBS copyright), CCEL editions (their formatting copyright), My Utmost (renewed copyright), NA28/UBS quotation indexes (consult in print only).

### Architecture sketch

```sql
create table library_sources (
  id text primary key,           -- 'treasury-of-david', 'matthew-henry-concise'
  title text, author text, era text,      -- 'Charles Spurgeon', '1869–1885'
  tradition text,                 -- 'Baptist', 'Presbyterian', 'Nonconformist'…
  license text, attribution text, -- render-ready credit line
  register text                   -- 'devotional' | 'exegetical' | 'confessional' | 'lexical'
);

create table library_chunks (
  id uuid primary key,
  source_id text references library_sources,
  book text, chapter int, verse_start int, verse_end int,  -- verse anchor (nullable for topical)
  heading text, content text, token_count int
);
-- embeddings ride the existing pattern: either a new match_library_embeddings RPC
-- or source_type='library' rows; separate table preferred for independent HNSW tuning.
```

- **Verse-anchored chunking** — chunk on the commentary's own verse-range headings (SWORD modules store these natively); prepend `author + era + ref` to each chunk before embedding. This is what makes the three-channel retrieval work.
- **Versification normalization through STEPBible TVTMS at ingest** — the #1 silent data bug otherwise (KJV-keyed classics vs BSB numbering; Hebrew Psalm-title offsets).
- **Three-channel retrieval fusion** (per artifact, budgeted): (1) verse-key exact join — the passage at hand + its cross-refs pull overlapping library chunks deterministically; (2) semantic — Voyage over library embeddings; (3) votes/topical priors. Fuse with reciprocal-rank fusion, then rerank. This mirrors what the study context already does for cross-refs, extended to commentary.
- **Prompt contract:** library chunks arrive labeled (`[Treasury of David · Spurgeon, 1870 · on Ps 27:4]`); the model may only draw theological claims from supplied chunks + supplied Scripture, must name the voice when it leans on one ("Spurgeon reads this verse as…"), and when trusted voices differ, says so — disagreement presented honestly is a credibility feature, not a bug.
- **Attribution surface:** extend the planned "How was this written?" transparency panel (backlog P2-2) to list the library sources each artifact drew from. The license requirement and the trust play are the same feature.

### Voice question this raises (for §12)
The classics are 150–350 years old. Registers vary from Henry's warmth to K&D's technicality. Options: (a) quote them visibly and let the age show (Logos-style credibility); (b) let Lamplight *digest* them silently into its own voice (seamless but forfeits the citation trust-play); (c) **recommended: both, by surface** — study chat quotes voices by name; devotions/reflections stay in Lamplight's voice but the transparency panel shows which sources informed them, with inline "Spurgeon:" quotes reserved for moments that earn it.

## 5. Pillar B — Journey Thread (longitudinal personalization)

**What it is:** the hierarchical-memory architecture the research converged on (per-entry extraction → periodic consolidation → rolling profile), built Lamplight-style: transparent, verse-anchored, user-ownable.

### Three layers

1. **Note distillates** (new, cheap): at embed time (the embed-note job already exists), a luna pass extracts per-note structured signals: themes (controlled vocab + free), posture (lament/thanksgiving/petition/wrestling…), open questions the note asks, scripture engaged, people mentioned (first names), season markers. Stored in a `note_distillates` table under the same RLS as notes. Pennies per note (~$0.001–0.003).
2. **Waymarks** (exists): the monthly letter is already a distillation of the month. Add a small *structured* sibling output (month themes, dominant posture, season estimate, key refs) persisted alongside the letter — the letter stays art; the struct feeds memory.
3. **The Journey Thread** (new artifact kind, e.g. `journey_thread`): a rolling ~800–1,500-token profile, refreshed monthly after Waymarks (or quarterly): the recurring questions; active themes with their scripture anchors; current season (taxonomy below); the user's own vocabulary and phrases worth echoing; trajectory deltas ("the March fear has become an August question"); prayer patterns. Built from distillates + waymark structs — never a raw re-read of the whole vault (cost- and privacy-bounded).

### Where it flows
The Thread becomes a cached system-prompt block (GPT-5.6 explicit cache breakpoints — 90% off cached input) injected into: Today's Lamp (currently sees only 3 recent notes — this is the single biggest devotion-quality lever), both chats (currently per-question retrieval only), Waymarks generation ("this month *against* the journey so far" — trajectory awareness), connection whys, and Witnesses matching (Pillar C).

**Timeline callbacks with receipts:** the pattern users love — "In early June you wrote about the interview with an open hand — Psalm 37 was open that week." Requires relaxing the verbatim-quote rule *for callbacks only*: a dated quote of the user's own words ≤15 words, always paired with its note citation. The witnessed-not-reopened rule still governs *hard* seasons (callbacks to battles mark the stone; they don't replay it).

### Season taxonomy
Brueggemann's Psalms-native frame (orientation → disorientation → new orientation) as the top level — it's unranked, cyclical, and matches the app's soul. Under it, ~8 named seasons in original language (calling, wilderness, waiting, testing, grief, doubt/the Wall, return, renewal), each mapped to psalm genres and to character `seasons_fit` tags. **The user can see and rename their season** — inference proposes, the user disposes. Agency is the anti-horoscope stance and it feeds matching quality.

### Transparency & control (non-negotiable)
A "What Lamplight carries" page: the Thread rendered legibly; per-item delete; full opt-out (aligns with backlog P4-1); explicit in-product covenant at the point of AI use ("Your notes are read to write *your* reflections. Never to train models. Never sold."). Day One's lesson: privacy architecture that makes AI shallow kills the feature; the answer is transparency + control, not opacity.

### Crisis layer (prerequisite to deepening)
Before the AI gets *more* intimate with notes, add the deterministic layer the research shows base models fail at: detection on note ingest (patterns + luna classifier) → never generate normal AI reflection on that entry → gentle, static, human-written response with crisis resources → "not a crisis service" disclosure at consent. Woebot's confirm-then-resource protocol is the template.

## 6. Pillar C — Witnesses (biblical character resonance)

**Working name options:** *Witnesses* (Heb 12:1, "so great a cloud of witnesses" — characters who point beyond themselves; strongly anti-horoscope), *Kindred*, *Companions*. Recommendation: **Witnesses**.

**What it is:** a hand-curated dataset of ~60 biblical figures profiled by *how they stood before God under pressure*, matched to the user's current season and posture (from the Journey Thread), presented as a companion for a season — with the exemplarism guardrails built into the output contract.

### The data (the moat — no open dataset of character values/arcs exists)
`character_profiles` schema (full version in the research doc): keyed to STEPBible TIPNR / Theographic person IDs (so passages, relationships, events join for free); fields include `values_under_pressure` (controlled vocab: honest wrestling, reluctant obedience, steadfast loyalty, costly truth-telling, waiting on promise, integrity in exile, repentance & restoration, quiet faithfulness, courage from the margins, generous partnership, grief carried to God, second-generation faith), `arc_stages`, `doubts_failures` + God's response, **`how_god_met_them` (the load-bearing field)**, `what_it_reveals_about_god`, `christ_connection` (typed by Greidanus road), `seasons_fit`, `misreadings_to_avoid`, `sensitivities` (grief, infertility, abuse — trigger gentler variants), `companion_texts` (psalms to sit with). Roster: ~40 OT + ~32 NT, women and lesser-known figures deliberately included (Hagar, Huldah, Habakkuk, the Syrophoenician woman, Onesimus, Phoebe…).

Authored as original prose; every profile passes a review checklist (flaw included? God-centered? Christ-connection defensible by Beale's criteria? misreadings listed? sensitivities tagged?) with named reviewer sign-off — this is the doctrinal review board (P0-2) given a concrete, ongoing curation role.

### Matching
Season tags × values-under-pressure overlap between the Journey Thread and profiles. **Explicitly not features:** personality, temperament, plot similarity, gender-matching. Output: 1 primary + 2 alternates, *scoped to the season* — matches expire and are revisited as seasons change; the user can contest a match and see the plain-language why ("you've been writing psalms of waiting; Hannah's years at Shiloh were that same posture").

### The output contract (hard guardrails, enforced by validators + judge)
- Frame is "walking the road X walked," **never** "you are X" / "be like X."
- The character's failure and God's grace through it are mandatory content.
- Every card lands God-ward: what this life reveals about God, and where the arc points to Christ (its Greidanus road named).
- The Fallen Condition Focus is the bridge ("waiting without a visible answer") — per Chapell.
- No outcome prediction, ever ("God will do for you what he did for Esther" is a banned pattern — extend `BANNED_PHRASES`).
- Cold start (no notes): a 6–8 question posture intake — "what does your prayer sound like lately," never lifestyle trivia.

### Where it surfaces
- A Witness card in the Waymarks world (a season-companion beside the monthly stones; the letter itself stays in its register — at most a marker-adjacent mention).
- "Walk with Ruth this season" → one tap creates a study note pre-linked to the character's key passages (instant backlinks; resonance feeds study, not a share-card).
- Study chat gains the profile as retrievable context when the user's witness comes up.

## 7. Pillar D — Connections Engine (how Scripture holds together)

**What it is:** upgrade cross-references from bare links to *typed, explained, confidence-rated connections* — the "hundreds of years of studying how Scripture reads Scripture" made legible.

### Data stack (bottom → top)
1. **Base graph (exists):** `bible_cross_references` (OpenBible CC-BY, votes) + the client TSK json (consolidation candidate — serve one corpus, votes-ranked, both sides).
2. **Curated quotation layer (new, ~400 rows, proprietary):** the OT↔NT quotations and major allusions, typed `citation | quotation | allusion | echo`, with direction, MT/LXX note, and the NT author's rhetorical use — built from public-domain collations (Gough 1855, Easton), print-checked against NA28/Beale-Carson. Facts are free; our arrangement is ours.
3. **Theme layer (new, ~12 themes, original prose):** temple/presence, kingdom, seed, exile & return, rest, shepherd, sacrifice/priesthood, bride, water, bread, vine, light — each a definition + verse anchor set. Passages carry theme tags; connections can travel *through* a theme.
4. **Covenant spine (new, small):** every book/passage tagged with covenant epoch (creation → Noah → Abraham → Moses → David → New) so explanations locate both ends in the one storyline — without endorsing any one system's polemics.
5. **Later:** MACULA (CC-BY) lemma-overlap scoring for word-level receipts.

### The explanation contract
Every AI-explained connection declares:
- **Its road** (Greidanus's seven: redemptive-historical progression, promise–fulfillment, typology, analogy, longitudinal theme, contrast, NT reference) — "this is a *promise–fulfillment* link," "these share the *exile* thread."
- **Its confidence** (Hays-informed): `citation > quotation > allusion > echo > thematic parallel` — the model may not upgrade a thematic parallel into "quotes."
- **The typology gate (Beale):** may call something a *type* only with correspondence + escalation + divine-design warrant in the supplied data; otherwise it must downgrade to analogy/shared theme. Prevents allegorical drift — the classic failure mode of enthusiastic connection-making.

### Caching & surfaces
`connection_explanations` cached globally per (from_ref, to_ref, prompt_version) — like the shared etymology insights, generated once, served to everyone (cost ↓, consistency ↑, reviewability ↑). Surfaces: reader apparatus (tap a cross-ref → the why, with its road badge); study chat (roads named in prose); **Connection Cards upgraded** — when two notes share verse lineage (note A ↔ Isa 53, note B ↔ 1 Pet 2), the why can say *your notes are joined by the road between these passages*; the graph view can label cross-reference edges; Waymarks markers become typology-aware when candidates allow (e.g., a month in Exodus + a highlighted John 6 → the bread thread, named).

**User loop:** confirm/dismiss on explained connections → a feedback column beside OpenBible's votes → our own ranking signal over time.

## 8. Pillar E — Model & reasoning upgrade

1. **Migrate the adapter to `/v1/responses`** — the single constraint blocking reasoning (`openai.ts:33-40`). Keep the provider-neutral tier seam and tool-forced JSON contract; unlock per-call `reasoning_effort`.
2. **Effort/tier map:** Waymarks + Journey Thread: `deep` at high effort via **Batch API** (they're cron-swept already — 50% discount, effective ~$2.50/$15 per M); study chat: `deep`, low/medium effort (fix the drift bug first); journaling chat + devotion: `balanced`, low; judges/distillates: `fast` at none/low.
3. **Prompt-cache breakpoints:** voice fragment + library preamble + Journey Thread as stable cached blocks (90% off cached input across a user's day).
4. **Judge stack grows:** register judge (exists) + **entailment judge** (claims ⊆ supplied sources — the research's "citation correctness ≠ faithfulness" point) + **sycophancy/flattening check** (no generic-spirituality mush, no unearned affirmation) — all on `fast`, pennies each.
5. **Retry budget:** raise reflections to 3 attempts (judge failure currently consumes the only retry).
6. **Live-model eval harness (none exists today):** golden set of ~10 synthetic personas × months (sparse month, grief month, ordinary month, doubt season…); assert validators + judge verdicts + verse-quote accuracy against canonical text; run per prompt_version bump. Extend with BibleQA-style retrieval checks and a FAI-C-inspired flattening probe. A small internal verse-accuracy eval would literally exceed the published state of the art.

## 9. Trust & safety floor (crosses all pillars)

- **Deterministic verse verification everywhere** (extend `verse-verify.ts` beyond transcription; backlog P2-8): parse refs in every artifact → bounds-check → string-match quotes against `bible_passages` → repair or regenerate. This is the "never misquotes Scripture" headline guarantee, enforced in code.
- **Layer C wiring (P0-5):** the declared-but-unwired `classifier` hook gets a `fast` doctrinal classifier pass (catches paraphrased prophetic claims regex can't).
- **Doctrinal review board (P0-2), expanded remit:** signs off the voice + rule lists (as specced) *and* the library source list, character profiles, connection rubric, season taxonomy. The board becomes an ongoing curator, not a one-time gate. Also: bring the three fragment-bypassing prompts under `composeSystem`.
- **Transparency panel (P2-2), expanded:** provenance now includes library sources with credit lines (license compliance + trust in one feature).
- **Humility stance, structural:** the AI recommends pastor/community for contested and weighty questions (already in the voice); add the formation-first patterns — Scripture and the user's own wrestling sequenced before insight; occasional gentle challenge ("in June you committed to X — how is it going?"); insights metered, not infinite.
- **Crisis layer** (§5) ships before personalization deepens.

## 10. How it compounds (the flywheel)

Notes → distillates → **Thread**. Thread + **Library** → devotions/reflections/chat that are both personal and grounded. Artifacts saved to notes → richer **backlink graph**. Graph + **Connections Engine** → explained connections between the user's own studies. Thread + seasons → **Witnesses** → study notes → more graph. User confirmations (connections, witness contests, "wasn't helpful") → ranking signals nobody else has. Every pillar makes the others better; none blocks the others.

## 11. Sequencing sketch (for discussion — not yet a plan)

- **Phase 0 — quick wins (days):** study-tier drift fix (chip spawned); stale lexicon line; bring bypassing prompts under the voice fragment; wire Layer C (P0-5); tighten thresholds (P0-1); retry budget.
- **Phase 1 — grounding + reasoning:** Responses API migration; verse verification everywhere; Library v1 lean corpus (Treasury of David + Henry Concise + JFB + creeds) with verse-anchored ingestion + retrieval fusion into study chat and Today's Lamp; transparency panel; eval harness v1. *(Rationale for first: it upgrades every existing surface immediately and de-risks everything downstream.)*
- **Phase 2 — the person:** crisis layer → note distillates → Journey Thread artifact + season taxonomy + "What Lamplight carries" page → Thread injected into devotion/chats/Waymarks (trajectory-aware reflections).
- **Phase 3 — the connections:** curated quotation table + themes + covenant tags; `connection_explanations` cache + road/confidence contract; reader + cards + graph surfaces; TSK consolidation.
- **Phase 4 — the witnesses:** profiles authored (board-reviewed, can start during 1–3); matching from Thread seasons; Witness surfaces + study on-ramp.
- Each phase gets its own design doc → implementation plan cycle per repo convention.

## 12. Cost envelope (rough, plus-tier user, current GPT-5.6 prices)

| Item | Est. |
|---|---|
| Library one-time: embedding ~8M tokens (Voyage) | ~$1.50–5 one-time; ~40–75k chunks ≈ 150–300 MB pgvector |
| Note distillate (luna, per note) | ~$0.001–0.003 |
| Journey Thread refresh (deep, monthly, batched+cached) | ~$0.05–0.15/user/mo |
| Waymarks w/ reasoning (deep, high effort, batch, cached) | ~$0.15–0.45/letter (vs ~$0.03–0.06 today on terra) |
| Today's Lamp w/ Thread + library context (terra, cached) | ~$0.01–0.03/day |
| Judge passes ×3 (luna) | ~$0.001–0.004/artifact |
| Study chat turn (sol, medium effort, cached context) | ~$0.03–0.10/turn |

Order-of-magnitude conclusion: the depth upgrade lands within cents-per-user-per-day at plus tier; the expensive habit to avoid is un-cached long contexts, which the cache-breakpoint design addresses. (Prices move; re-verify against the cost map before public claims — existing backlog health-check.)

## 13. Open decisions — the talk-through agenda

> Items 1, 2, 3, and build order are **decided** — see §14. The rest are open or running on stated working defaults.

1. **Corpus stance.** PD-classics-first now + pursue NET-notes/Guzik permissions for v2 (**recommended**), vs. waiting on modern licenses before shipping the Library.
2. **Source visibility.** Quote voices by name in study surfaces + transparency-panel-only for devotional surfaces (**recommended**), vs. always-visible citations everywhere, vs. silent blending.
3. **Witnesses shape.** Season-scoped companion, revisited monthly (**recommended**), vs. persistent long-term companion, vs. both (season companion + a growing "cloud" history page).
4. **Naming.** *Witnesses* vs *Kindred* vs *Companions*; *Journey Thread* vs another Waymarks-adjacent name.
5. **Tradition posture.** Keep creedal-neutral voice + labeled-differences answering ("Reformed readings emphasize…; Wesleyan…") (**recommended**), vs. reviving the vestigial `tradition_hint` column as a user-selected lens (Bible Chat's model). Note the corpus skews Reformed/Puritan — Wesley + Clarke balance it some; the board should weigh in.
6. **Reasoning migration scope.** Adapter once, roll per-pipeline starting with Waymarks + study (**recommended**), vs. big-bang.
7. **Connection explanations: shared-global** (cheap, consistent, reviewable — like etymology insights) (**recommended**) vs. per-user personalized.
8. **Season agency.** Inference proposes + user confirms/renames (**recommended**) vs. pure inference vs. pure self-select.
9. **Callback quote rule.** Permit dated ≤15-word quotes of the user's own words with note citation, hard seasons still witnessed-not-reopened (**recommended**), vs. keep the blanket no-verbatim rule.
10. **Cadence additions.** Does Weekly Insight (P2-12) ride on the Thread once it exists (cheap then), or stay deferred?
11. **Budget ceiling.** Per-user soft cost cap value (P1-4) — informs how much reasoning effort the default tiers get.
12. **Crisis-layer scope.** Detection on all note saves vs. only on AI-surface entry points.

## 14. Decision log

**Decided 2026-08-04 (Myles):**
1. **Corpus stance → Classics + CC-BY now.** v1 = lean PD cut (Treasury of David, Matthew Henry Concise, JFB, Creeds.json Unlicense subset) **plus** the CC-BY layer (STEPBible TBESH/TBESG + TVTMS, Berean interlinear, OpenBible topical scores). Attribution screen is day-one scope. v2 = NET-notes + Enduring Word permission conversations.
2. **Source visibility → by surface.** Study chat quotes voices by name; devotions/reflections stay in Lamplight's voice with sources in the transparency panel; inline quotes only when they earn it.
3. **Witnesses shape → season-scoped companion.** 1 primary + 2 alternates per season, revisited monthly, contestable with a plain-language why.
4. **Build order → Phase 1 = Library + reasoning** (Responses API migration, verse verification everywhere, eval harness v1), after Phase-0 quick fixes.
5. **Naming → "Witnesses"** for the character-resonance feature (Heb 12:1 — characters who point beyond themselves; sits beside Waymarks).
6. **Tradition posture → neutral + labeled views.** Keep the creedal-orthodoxy voice with no assumed tradition; on genuinely divided questions present labeled readings ("Reformed readings emphasize… Wesleyan readings…") and point to the user's pastor. The corpus's Reformed/Puritan lean is balanced by Wesley/Clarke and board review. (The vestigial `tradition_hint` column stays dormant; a user-selected lens is not planned.)

**Working defaults (engineering-level; flag to change):** reasoning migration rolls per-pipeline starting with Waymarks + study (§13.6); connection explanations shared-global like etymology insights (§13.7); season inference proposes + user confirms/renames (§13.8); callback quotes permitted at ≤15 words, dated, with note citation — hard seasons still witnessed-not-reopened (§13.9); Weekly Insight deferred until the Thread exists, then revisited (§13.10); crisis detection runs on all note saves, not just AI entry points (§13.12). Budget ceiling (§13.11) to be set during Phase-1 design alongside the P1-4 cost cap.

**Still open:** none — all §13 items are decided or covered by the working defaults above.

**Progress:** Phase-0 quick fixes implemented 2026-08-04 (tier fix, stale lexicon line, Layer C wired across all pipelines, content rules on reflections + etymology, spec thresholds, retry budget, intentional-bypass documentation). Phase 1 design: `2026-08-04-lamplight-library-and-reasoning-design.md`.

---

*Prepared 2026-08-04 on `feat/lamplight-gpt-migration`. Research: `docs/superpowers/research/2026-08-04-{theological-source-library, ai-faith-landscape-and-techniques, intertextuality-and-character-resonance, lamplight-system-map}.md`.*
