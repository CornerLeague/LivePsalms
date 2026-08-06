# Study Insights B2 — The Passage door

> Phase B2 of `2026-08-06-study-insights-design.md`. B1 shipped the overlay and the free Sources & Reference door (#112); this adds the first **generated** door. Product decisions from the parent design are restated, not reopened. Written after the study-chat eval work (#114) hardened the surface B2 builds on.

## Purpose

Door 1 answers the question a reader has before they know how to ask it: *what is going on in this passage?*

Four sections, progressively outward:

| Section | What it does |
|---|---|
| **Overview** | The passage's central message, argument, or event |
| **In the Chapter** | What sits either side of it, and why that changes the reading |
| **The Chapter's Shape** | The chapter's structure, movement, and purpose |
| **Reflection & Application** | Where it lands, following interpretation rather than replacing it |

## Settled upstream — restated, not reopened

From the parent design's decision log:

- **Global shared cache.** The historical setting of Psalm 27 is the same for every reader, so a generated door is a public asset, not a per-user artifact (parent §6, decision 4).
- **Explicit generate.** An uncached door shows *Study this passage*; nothing generates on open (decision 4).
- **Cached reads are free and public**, matching `bible_etymology_verse_insight` (decision 5).
- **Two grains only** — `chapter` and single `verse` (decision 6).
- **Handoff prefills, never auto-sends**, and appends to the passage's existing study thread (decision 7).
- **Omission is first-class.** A section with no warrant renders nothing (parent §9).

## 1. The architectural call: which pipeline shape

B2 sits between the two existing shapes and takes one half from each.

| | Grounding | Emit |
|---|---|---|
| `runBibleChatPipeline` | ✅ `buildStudyContext` — the study apparatus | ❌ one `reply` string + citations |
| `runDailyDevotionPipeline` | ❌ note-derived, no chapter apparatus | ✅ multi-field artifact with per-field bounds |
| **B2** | **study grounding** | **multi-field emit** |

So B2 is a new pipeline that composes `buildStudyContext` (already exercised by the eval harness, already carrying cross-refs and the library since #113) with a devotion-style structured tool emitting four named fields.

**Do not force this through `emit_chat_reply`.** One `reply` string holding four sections would push section boundaries into prose the client has to re-parse, and would lose per-section length bounds — the exact control whose absence caused the 1400-char truncation. Four fields, four bounds.

### Section bounds

Today's lesson, applied from the start: **a ceiling is a backstop, and only works when the prompt aims below it.** Every section gets both.

| Section | Word target (prompt) | Ceiling (schema) |
|---|---|---|
| Overview | 90–150 | 1200 |
| In the Chapter | 120–200 | 1600 |
| The Chapter's Shape | 120–200 | 1600 |
| Reflection & Application | 80–140 | 1100 |

Ceilings sit roughly 1.6–2× the top of each target, matching the ratio that keeps journaling chat and (now) study chat from ever running into theirs.

### Validators

Reuse wholesale. The citation allowlist (`allowedVerseRefs` — library excerpts still never widen it), banned phrases, `verifyArtifactScripture` with repair-before-reject, and the Layer C classifier. Two notes specific to B2:

- **Verse ranges** are accepted where fully supplied (#114) — a section describing a chapter's movement will cite spans constantly, so this had to land first.
- **Contested passages:** Door 1 is descriptive, not adjudicative, so it keeps the standard rejection rather than study chat's `allowContestedRefs` exemption. A chapter whose contested verses make Overview unwritable is a chapter whose reader should be in chat, and the door says so.

## 2. Verse-scope grounding

`buildStudyContext` anchors the library at chapter granularity. Verse-scope Door 1 needs two changes, both small and both already scoped in the parent design:

1. **Narrow `libraryAnchors`** to the selected verse (plus resolved cross-ref targets, as today).
2. **Supply neighbouring-verse text explicitly**, so *In the Chapter* has the immediate context to reason over. The chapter is already fetched — this is a slice, not a query.

## 3. Data model

```sql
create table public.bible_passage_insight (
  scope           text not null check (scope in ('verse','chapter')),
  ref_id          text not null,           -- 'psa.27.4' | 'psa.27'
  door            text not null,           -- 'passage' (B3 adds 'deeper')
  section         text not null,           -- 'overview' | 'in_chapter' | …
  body            text not null,
  sources         jsonb not null default '[]',
  model_used      text,
  prompt_version  text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  primary key (scope, ref_id, section)
);
```

Public-read RLS, service-role write — mirroring `bible_etymology_verse_insight`. `door` is denormalized so a whole door loads in one query and invalidates as a unit.

**Cost:** ~1,200–1,800 output tokens per door at `deep`/medium ≈ **$0.06–0.12 per passage, ever**. Warming the ~1,200 chapters readers actually touch is a one-time ~$100.

## 4. Decisions

**Decided 2026-08-06 (Myles).**

### D1 · Plus/promo may generate; it does not cost them quota

Gate with `hasInlineInsightAccess({ tier, promoActive })`, exactly as `etymology-insight` does. But the generation is **not counted against the triggering reader's allowance** — the output is a public asset, and charging one reader's quota to warm the cache for everyone else is the wrong incentive.

Two consequences worth getting right:

- **"Not quota-counted" means not counted against the *user*, not unbounded.** Add `passage_insight` as a kind that skips the per-user check but keeps the **global** daily ceiling, so a scripted loop still cannot run up an unbounded bill. Usage rows are still written, so cost stays visible on the admin dashboard.
- This is the first kind to sit outside all three of `GENERATION_KINDS` / `TRANSCRIPTION_KINDS` / `STUDY_KINDS`. Adding a fourth bucket with a per-user limit of `null` reads better than special-casing inside `checkQuota`.

### D2 · Serve stale; refresh deliberately

A read returns whatever is cached, regardless of `prompt_version`. A reader is never blocked, and a bump never silently re-bills the warmed corpus.

- Every row stores its `prompt_version` and `model_used`, which is what makes a targeted refresh possible later.
- Ships with `scripts/refresh-passage-insights.ts`: regenerate rows matching a scope/ref filter, or every row whose `prompt_version` is behind current. Dry-run first, reporting how many rows and roughly what it will cost — the same discipline as the ingest scripts.
- **The tradeoff to state plainly:** two readers can see different prose for the same passage, generated under different prompt versions. Acceptable here because the content is neither personalized nor time-sensitive; a correct Overview of Psalm 27 does not rot.

### D3 · Stream section by section

The reveal is worth it, and the infra exists: `streamBibleChat` already emits per-field `text` events, which maps cleanly onto four named fields. Overview lands while the rest fill in.

This means **the client has two rendering paths**, and that is the part to get right:

- **Cached** → one query, render immediately. No stream, no spinner.
- **Uncached** → the reader presses *Study this passage*, and sections stream in.

The cache write happens on the terminal `done` beat, so an interrupted stream leaves nothing behind and the door simply remains uncached — matching how study chat already declines to commit a reply on an interrupted stream.

### D4 · The Lamplight handoff is its own slice

B2 ships Door 1 without "take this further" prompts. The seam touches `LamplightStudyPanel`, both workspaces, and mobile tab switching with draft preservation; it deserves its own scope rather than riding along behind a migration and a new pipeline. Folded into **B4** alongside mobile parity.

---

## 5. Eval coverage is not optional here

#114 exists because a surface shipped with no eval and a retrieval channel went dark for months. B2 must not repeat it.

- Add `'passage-insight'` to the harness `ArtifactKind` union and drive it live, reusing the study-chat fixture shape (`book`, `chapter`, plus a verse for the verse grain).
- **Grounding floors apply unchanged** — the check that would have caught the empty cross-reference table.
- **Add per-section presence and length assertions.** A section that silently comes back empty, or one that stops mid-word, is exactly what the four-bound design is meant to prevent, and only an eval will tell us it worked.
- Run `--grounding-only` after any retrieval or ingest change; it stays free.

## 6. Sequencing

1. **Migration + RLS** — `bible_passage_insight`, public read / service-role write. Applied manually via the SQL Editor per the house workflow.
2. **Prompt module + tool** — four bounded fields, each with its word target; `promptVersion` from day one.
3. **Pipeline** — study grounding composed with the multi-field emit; verse-scope anchor narrowing and neighbouring-verse supply (§2).
4. **Quota bucket** — `passage_insight` outside the per-user buckets, global ceiling retained (D1).
5. **Edge-function mode** — cache read → hit returns immediately; miss gates on `hasInlineInsightAccess`, streams, writes on `done` (D3).
6. **Client** — door registration in `doors.tsx`, *Study this passage* action, the two rendering paths, section components.
7. **Eval fixtures + a checked-in baseline, before the door is enabled for readers.** Not after.
8. `scripts/refresh-passage-insights.ts` with a dry-run mode (D2).

Steps 1–4 are server-only and independently verifiable; the door can stay unregistered until step 7 is green.

---

*Prepared 2026-08-06. Decisions D1–D4 from Myles, same day. Parent: `2026-08-06-study-insights-design.md`. Builds on #112 (B1), #113 (cross-references), #114 (eval + prompt hardening).*
