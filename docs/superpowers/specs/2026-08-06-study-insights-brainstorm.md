# Study Insights — Brainstorm

> **Status: brainstorm, not a settled design.** Talk-through document for the Insights section in the Study tab. Once §14 is settled this graduates into `2026-08-XX-study-insights-design.md` + an implementation plan, per the superpowers workflow. Grounded in a read of the live Study surface and the Phase-1 depth-overhaul artifacts (`2026-08-04-lamplight-depth-brainstorm.md`, `2026-08-04-lamplight-library-and-reasoning-design.md`).

## 1. The one-sentence pitch

**Insights turns the library we just ingested into something a reader can *browse*, not just ask about** — a verse-anchored, progressively-revealed study of the open passage, where every claim is visibly either *data we hold*, *a voice from the church's study*, or *Lamplight's own synthesis under the same validators that guard chat*.

## 2. Where the Study tab stands today

This matters more than usual: **roughly half of the requested content already ships**, in a panel most readers never widen.

**Desktop** (`StudyWorkspace.tsx`) — three columns:

| Column | Component | Contents |
|---|---|---|
| Left, 280px, collapsible | `ApparatusRail` | Original Language (interlinear/Strong's), Etymology (word studies + shared cached AI insight), **Book context** (author, author_note, date_label, region, genre, cultural_context, summary from `bible_books`), Region map, **Cross-references** (top-5 by OpenBible votes, ref + text + `OT ↔ NT` badge) |
| Center | `StudyReader` | BSB/translation reader, verse tap → `selectedVerse` |
| Right, 360px, collapsible/expandable-over-reader | `StudySidePanel` | Flat tabs: **Notes \| Chat \| Memorize**. Chat = `LamplightStudyPanel` |

**Mobile** (`MobileStudyWorkspace.tsx`) — bottom tab bar: **Study \| Reader \| Context**, where Context *is* the `ApparatusRail` and Study *is* the `StudySidePanel`.

**Server** (`supabase/functions/lamplight-study/`): a mature grounded pipeline — `buildStudyContext` assembles chapter text + `bible_books` apparatus + curated cross-refs + whole-Bible semantic retrieval + **library excerpts + lexicon entries** (34,076 chunks live since Phase 1), then runs `runBibleChatPipeline` → citation allowlist → content rules → Layer C doctrinal classifier → `verifyArtifactScripture` (repairs before it rejects) → stricter retry.

**Already present and unused:** `mode: 'insight'` in the edge function, `STUDY_INSIGHT_PROMPT`, and a client `requestStudyInsight` that `LamplightStudyPanel.tsx:232` explicitly parks (`void requestStudyInsight; // available for future use`). Today "insight" means *one short opening observation posted into the chat thread* — a different concept wearing the name we now want. **Naming collision to resolve** (§14).

## 3. The user problem

A reader opens Psalm 27 and can see *what it says*. To learn *what it means* they must know what to ask, and ask it — in a 360px chat box, one question at a time, with no map of the territory. The apparatus that would orient them sits in a thin left rail that reads as reference furniture, not as study.

Three distinct people are underserved:

1. **The reader who doesn't know what to ask.** Chat is a blank page. It rewards expertise the feature exists to build.
2. **The reader who wants the survey before the question.** "What is going on in this chapter, and why does it sit here in this book?" is a *document* question, not a chat question.
3. **The reader who doesn't trust AI with Scripture.** (83% of practicing Christians, per the Barna figure in the depth brainstorm.) Chat's fluency reads as confidence. A surface that visibly separates *"Spurgeon says"* from *"the text says"* from *"Lamplight suggests"* converts the corpus into trust.

The strategic point: **Phase 1 bought a library. Chat is a straw through which to drink it. Insights is the glass.**

## 4. The spine of the design: three content classes

The request asks (planning item #4) for a distinction between generated and sourced content. That distinction shouldn't be a footnote — **it should be the visual and architectural spine.** Three classes, three treatments, three cost profiles:

| Class | Where it comes from | Cost | Hallucination risk | Treatment |
|---|---|---|---|---|
| **A. Held** | Our own tables: `bible_books`, `bible_cross_references`, `bible_interlinear`, `bible_lexicon`, `bible_etymology_verse_insight`, region maps | Free, instant, offline-able | **Zero** | Rendered plainly. No badge needed — it's the furniture. |
| **B. Voiced** | `library_chunks` verse-anchored join — Spurgeon / Henry / JFB / creeds **on this exact ref** | Free after ingest (a deterministic SQL join, *no embedding call, no LLM*) | **Zero** — it's quoted text | Named attribution card: *Treasury of David · Spurgeon, 1869–1885, on Ps 27:4* |
| **C. Synthesized** | Lamplight, grounded in A + B, through the existing validator stack | ~$0.15–0.40/generation, cacheable | Managed | Visibly Lamplight's voice; sources listed; hedged where the data hedges |

**The load-bearing consequence:** class A and B need **no AI call at all** and can render the instant the panel opens. That single fact solves most of the latency problem, most of the cost problem, and most of the trust problem — and it is only available because Phase 1 already anchored the corpus by verse range (`overlapsRef` in `_shared/library-retrieval.ts` is exactly this join, currently used only to feed prompts).

> Today the library is *invisible*: 34,076 chunks of Spurgeon, Henry, and JFB exist solely as prompt filler. Class B makes them a product surface. This may be the highest value-per-line-of-code in the whole request.

## 5. Request → reality: the gap analysis

| Requested section | Status today | Class | Notes |
|---|---|---|---|
| Overview | ✗ | C | New. The "above the fold" tier. |
| Verse Context (immediate literary) | ✗ | C | New. Needs neighbouring-verse text — trivial (chapter is already fetched). |
| Chapter Context | ✗ | C | New. |
| Book Context | ✓ **ships** | A | `ApparatusRail` renders all 8 `bible_books` fields today. Reuse verbatim. |
| Historical Background | ◐ partial | A + C | `cultural_context` + `region` + `RegionMapBlock` exist; the *narrative* is C. |
| Original Languages | ✓ **ships, and is deep** | A | `OriginalLanguagePanel` + `EtymologyPanel` + cached per-(strongs, verse) insights. **Do not rebuild.** Link or embed. |
| Hermeneutics | ✗ | C | New. Highest-value differentiator; also the section most likely to read as filler if done generically. |
| Biblical Connections | ◐ shallow | A + C | Cross-refs render bare (ref + text + OT↔NT). The *why* is **Pillar D / Phase 3** of the depth overhaul — this request pulls it forward. See §12 risk. |
| Interpretive Perspectives | ◐ **corpus is one-sided** | B | See §6. The sharpest gap in the request. |
| Theology | ✗ | C | New. |
| Common Misreadings | ✗ | C | New. **Highest doctrinal risk in the spec** — see §7. |
| Reflection & Application | ✗ | C | New. Cheap, and the natural handoff into notes. |

Net: **3 of 12 largely exist**, 2 more partially, 7 are new generation.

## 6. The corpus problem (must be decided before design)

The request asks Interpretive Traditions to cover: Early Jewish interpretation, Church Fathers, Catholic, Orthodox, Protestant, contemporary scholarship.

**What we actually hold** (`scripts/library-adapters/commentary.ts` + `058_library.sql`):

- `treasury-of-david` — Spurgeon, Baptist, 1869–85, **Psalms only**
- `matthew-henry-concise` — Nonconformist/Presbyterian, ~1710
- `jfb` — Scottish Presbyterian, 1871
- `creeds` — ecumenical creeds + **Westminster, Heidelberg** (Reformed confessions)
- `stepbible-lexicons`, `berean-interlinear`, `openbible-topics` — lexical/topical, not interpretive

That is a **17th–19th century Anglophone Protestant, Reformed-leaning corpus.** We hold **zero** Jewish, patristic, Catholic, Orthodox, or contemporary-scholarly sources. Treasury — the flagship — covers Psalms only, so outside the Psalter class B thins to two voices.

**If we ship an "Interpretive Perspectives" section anyway, the model will improvise those four traditions from memory** — precisely the failure the entire depth overhaul was built to prevent, dressed in the visual language of sourcing. That is worse than not shipping the section, because the section's *frame* asserts sourcing.

Three honest options (→ §14 Decision 2):
- **(a) Ship what we hold, labelled.** Rename to "Voices from the Church's Study"; render only real excerpts; state the corpus's era and tradition plainly in the section header and in the Sources screen. Where a genuine divide exists that our corpus can't represent, say so and hand off to chat/pastor. *Honest, cheap, shippable now.*
- **(b) Defer the section** until v2 sources land (NET notes, Guzik — both permission conversations already planned) plus a PD patristic/Jewish layer (Catena Aurea, Schaff's ANF/NPNF, Rashi via Sefaria's CC licensing — all worth a licensing pass).
- **(c) Acquire first, ship together.** Slower, but the section is then what the request describes.

Recommendation: **(a) now, (b/c) as a named follow-on.** It respects the request's own accuracy principle ("Do not force multiple perspectives when there is little meaningful disagreement") and the repo's standing decision §14.6 (creedal-neutral, labeled views).

## 7. "Common Misreadings" — reframe before building

The request is right that this is valuable and right about the failure mode it targets (it even names the big one: etymology-as-meaning). But as literally specified — *"identify interpretations that... are incomplete or misleading"* — it asks a model to adjudicate contested theology, in a product whose standing posture is creedal-neutral with labeled views.

**Reframe: "Read With Care."** Constrain it to *interpretive moves*, never *groups or traditions*:

- ✅ Context-stripping ("this verse read apart from vv. 1–3 loses its condition")
- ✅ Etymology-as-meaning (the root fallacy — the user flagged this themselves)
- ✅ Genre errors (reading proverb as promise, apocalyptic as chronology)
- ✅ Anachronism (importing a modern institution into an ancient text)
- ❌ "Catholics misread this as…" / "the Reformed view is wrong here"

And a hard gate: **the section may only assert a caution grounded in supplied sources or in the passage's own literary data. No supplied warrant → the section is omitted, not softened.** Omission must be a first-class, unremarkable outcome for *every* class-C section.

## 8. Ideal user journey

```
Reader taps Ps 27:4 in the reader
        ↓
Taps the Insights pill  →  panel opens EXPANDED over the reader
        ↓
INSTANT (no AI, class A+B):
  • "Psalm 27 · verse 4" scope chip  ▸ [verse ⇄ chapter] toggle
  • Book context card  (author · date · region · genre · cultural setting)
  • Voices on this verse: Spurgeon ▸  Matthew Henry ▸   (real excerpts, collapsed)
  • Original Languages ▸  (existing panels, scoped to v.4)
  • Cross-references ▸  (existing, ref + text)
        ↓
STREAMING or CACHED (class C, fold tier):
  • Overview            ← streams first
  • In the Chapter      ← the immediate literary context
  • The Chapter's Shape
        ↓
ON EXPAND (lazily generated or cached):
  Historical Background · Hermeneutics · Connections ·
  Theology · Read With Care · Reflection & Application
        ↓
Every section footer:  "Take this further →"  2–3 seeded prompts
        ↓
Tap → Chat tab opens with the prompt prefilled + scope carried
```

Two things make this feel fast rather than "AI is thinking": the panel is **never empty** (class A+B paint immediately), and the fold tier **streams** (`streamBibleChat` + per-field text events already exist).

## 9. Information architecture

Proposed grouping — the request's 12 sections, reordered so the *free* content carries the top of the panel and the progressive-disclosure promise is real:

```
┌ SCOPE CHIP ─────────── Psalm 27:4 ▾   [verse | chapter]
│
├ THE PASSAGE          ── Overview                        [C, streams]
│                         In the chapter                  [C]
│                         The chapter's shape             [C]
│
├ THE WORLD BEHIND IT  ── Book context                    [A, instant]
│                         Historical & cultural setting   [A + C]
│                         Original languages              [A, existing panels]
│
├ THE CHURCH'S STUDY   ── Voices on this passage          [B, instant]
│                         (Spurgeon · Henry · JFB · creeds)
│
├ READING IT WELL      ── How to read this passage        [C]  (hermeneutics)
│                         Read with care                  [C]  (§7)
│
├ HOW IT CONNECTS      ── Cross-references                [A, instant]
│                         Why these belong together       [C, see §12]
│
└ WHAT IT CARRIES      ── Theological significance        [C]
                          Reflection & application        [C]
```

Rules: every section collapsed by default except the fold tier; **absent ≠ empty** — a section with no warrant does not render at all (no "no data available" apologies); each section footer carries its Lamplight handoff prompts.

## 10. Data & AI architecture

### The caching decision (the one that decides whether this is viable)

**Insights are not personal.** The historical setting of Psalm 27 is the same for every reader. That makes them a *global, cacheable, reviewable asset* — and the repo already has the exact pattern in `bible_etymology_verse_insight`: shared row keyed by content, `public read using (true)`, generated once by whoever arrives first, free for everyone after, `prompt_version` + `model_used` stamped for reviewability.

```sql
create table public.bible_passage_insight (
  scope           text not null,          -- 'verse' | 'chapter'
  ref_id          text not null,          -- 'psa.27.4' | 'psa.27'
  section         text not null,          -- 'overview' | 'hermeneutics' | …
  body            text not null,
  sources         jsonb not null default '[]',  -- library chunk provenance
  model_used      text,
  prompt_version  text,
  created_at      timestamptz not null default now(),
  primary key (scope, ref_id, section)
);
```

Consequences, all good:
- Common case is a **DB read** — instant, free, no entitlement gate needed to *read* (matching etymology). Cached Insights become a genuine acquisition surface for signed-out readers.
- **Precomputable.** A background sweep can warm the top-N most-read chapters so first-touch is rare.
- **Reviewable.** A doctrinal reviewer can read the actual rows — which the depth brainstorm's review-board remit (§9) asks for and chat can never offer.
- Per-section rows mean lazy generation, partial cache hits, and per-section `prompt_version` bumps all fall out for free.

### Granularity: two grains only

Arbitrary ranges explode the key space (a 176-verse Psalm 119 has 15,576 possible ranges). **Cache `chapter` and single-`verse` only.** A multi-verse selection resolves to the enclosing chapter grain with the selection shown in the scope chip, plus a "focus these verses →" handoff into chat, which *is* the right tool for an arbitrary range. Whole-chapter (nothing selected) is the default and the always-warm grain.

### Generation path

Reuse `lamplight-study` wholesale — a new `mode` (or a sibling function sharing `buildStudyContext`), the same `runBibleChatPipeline`, the same allowlist/validators/verification. **Do not build a second grounding path.** Two changes needed:
- `buildStudyContext` currently grounds at chapter granularity. Verse-scope Insights need `libraryAnchors` narrowed to the selected verse and the neighbouring-verse text surfaced explicitly (§11 literary context). Both are small.
- Sections generate as a **structured multi-field tool call** (one call, many fields → the streaming infra already emits per-field text events), or as per-section calls for the deep tier. One call for the fold tier is almost certainly right; per-section for the rest keeps lazy expansion honest.

### Cost sketch

At `deep`/medium with a ~6k-token grounded context: fold tier ≈ 1,200 output tokens ≈ **$0.03–0.06**; full 12 sections ≈ 5–6k output tokens ≈ **$0.15–0.40**. Per *passage, ever* — not per user, not per open. Warming the ~1,200 chapters readers actually touch is a **one-time ~$200–500**, and the long tail generates on demand. This is affordable precisely *because* it's global; per-user generation of this document would not be.

## 11. Context passing (reader ↔ Insights ↔ Lamplight)

Today `LamplightStudyPanel` takes only `{ book, chapter, userId }` — no seam for a seeded message, and `selectedVerse` never reaches it (it stops at `ApparatusRail`). Three seams to add:

1. **Reader → Insights.** `selectedVerse` is already lifted in both workspaces; thread it into the side panel the same way it reaches the rail today.
2. **Insights → Chat.** A seeded-prompt seam: `{ text, scope: {book, chapter, verse?}, section }`. Open questions: does it **auto-send or prefill** (recommend *prefill* — the user stays the author of their question, and it costs nothing to let them edit), and does it **open a new thread or append** (recommend *append* to the passage's open thread; threads are keyed `(user_id, passage_ref, surface='study', archived=false)` and a fresh thread per handoff would fragment history).
3. **Section context into the prompt.** The handoff should carry the section as retrieval steering (`registers` is already a `searchLibrary` parameter) so "explore this Hebrew word" biases lexical sources and "compare interpretations" biases commentary.

Mobile adds a wrinkle: Insights and Chat may sit in different tabs, so the handoff must switch tabs and survive the switch. Panes stay mounted via `display` toggling in both workspaces, so drafts survive — the seam is a shared draft state, not a remount.

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Generic AI mush.** 12 sections × every passage guarantees some are thin. Filler destroys the "scholarly deep dive" promise faster than absence does. | Omission is first-class. Per-section minimum-warrant gate: no supplied grounding → no section. Consider a flattening/sycophancy judge (already planned in depth brainstorm §8.4). |
| R2 | **Sourcing theatre.** A section headed "Interpretive Traditions" that is actually model memory is *more* damaging than no section — the frame makes a claim the content can't cash. | §6 decision. Class-B sections render **only** real excerpts; class C never wears class-B chrome. |
| R3 | **Connections pulls Phase 3 forward.** "Why these passages belong together" is Pillar D, with a designed contract (Greidanus roads, Hays confidence tiers, the Beale typology gate). Shipping an ungoverned "why" now means allegorical drift, then a rewrite. | Either ship Connections as class A only (bare cross-refs, as today) and defer the *why*, or adopt the road/confidence contract in this feature. **Decide explicitly** (§14.4). |
| R4 | **Panel width.** A 12-section scholarly document in 360px is a bad experience; the request also asks for tab-bar prominence. These pull opposite ways. | Default to opening in the existing expanded-over-reader mode. But see §14.1 — the deeper question is whether Insights *absorbs* the left rail. |
| R5 | **Two homes for the same content.** Book context, cross-refs, and Original Languages would appear in both `ApparatusRail` and Insights. Two surfaces drifting apart is the worst outcome. | §14.1. |
| R6 | **Psalm superscriptions / versification.** Hebrew Psalm-title offsets are a known live hazard (`docs/lamplight/evals/2026-08-06-superscriptions/`), and verse-scope Insights are more exposed than chapter-scope chat. | Reuse the TVTMS-aligned refs; add superscription cases to the eval fixtures. |
| R7 | **Cache staleness across prompt versions.** 12 sections × 2 grains × thousands of refs makes a bad prompt a large, expensive artifact. | `prompt_version` per row; invalidate per section, not globally; eval before any bump (harness exists). |
| R8 | **Translation coupling.** Most sections are translation-agnostic; quoted text isn't. | Prefer citing refs over quoting in class C (verification already repairs quotes); revisit if evals show drift. |
| R9 | **"Insight" already means something else** in this codebase (the chat opening observation) *and* `bible_etymology_verse_insight` is a third meaning. | Rename one of them in the design, and pick table/mode names that don't collide. |

## 13. Edge cases to specify

- **Multi-verse selection** → enclosing chapter grain + scope chip + "focus these verses" chat handoff (§10).
- **Whole chapter / nothing selected** → chapter grain; the default and always-warm case.
- **Verse 1 / last verse** → "in the chapter" must reach across the chapter boundary or say it's at one.
- **Disputed authorship/dating** → `bible_books.author_note` already carries the hedge ("traditionally attributed to Moses; authorship debated"). Class C must **inherit the hedge and never resolve it**. Worth an eval fixture (Hebrews, 2 Peter, Daniel, Isaiah).
- **No library coverage** (most of the OT outside Psalms has only Henry + JFB) → class B renders thin or absent; graceful degradation is already the library contract.
- **Signed-out / no entitlement** → cached rows are a public-read DB read (etymology precedent). Reading is free; *generating* a cache miss is gated.
- **Genre extremes** — genealogies, legal codes, Psalm superscriptions, one-line proverbs: several sections will legitimately have nothing to say. R1's omission rule covers it; these belong in the eval set.
- **Rapid verse tapping** → debounce; never fire generation on transient selection. Cache reads can be eager, generation must be intentional (or explicitly triggered).

## 14. Open decisions — the agenda

1. **Placement & the left rail.** Insights as a 4th destination in the `StudySidePanel` tab row (Reflections-pill styling per the request) *beside* an unchanged `ApparatusRail` — accepting duplicate content (R5)? Or does Insights **absorb** the rail, making it the single home for context (rail becomes a thin collapsed strip or goes away)? Or a full-width overlay? *This decides the IA and the mobile "Context" tab's fate.*
2. **Interpretive Perspectives.** Ship-what-we-hold-labelled (recommended) / defer to v2 sources / acquire first. §6.
3. **v1 section cut.** All 12, or a tighter first cut (fold tier + class A/B + 2–3 class C) with the rest following once evals show quality? Fewer, better sections beat twelve thin ones.
4. **Connections depth.** Bare cross-refs now with the *why* deferred to Pillar D, or adopt the road/confidence/typology contract inside this feature? R3.
5. **Caching model.** Global shared cache + precompute sweep (recommended, etymology precedent) vs per-user on-demand. Also: is reading cached Insights free for signed-out readers?
6. **Handoff behaviour.** Prefill vs auto-send; append to the passage thread vs new thread. §11.
7. **Naming.** "Insights" collides twice in-codebase (§R9). Keep and rename the others, or pick a distinct name for the section?
8. **Generation trigger.** Auto-generate on open (best feel, real cost on cache miss) vs an explicit "Study this passage" action for uncached passages (cheapest, one extra tap).

---

*Prepared 2026-08-06 on `feat/reflections-before-lamplight`. Reads: `src/notepad/study/**`, `supabase/functions/lamplight-study/**`, `supabase/functions/_shared/library-retrieval.ts`, `supabase/migrations/{032,048,058,059}`, `scripts/library-adapters/commentary.ts`.*
