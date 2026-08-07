# Lamplight — Journey Thread (Depth Overhaul, Phase 2)

> Phase 2 of the depth overhaul. Pillar B of `2026-08-04-lamplight-depth-brainstorm.md` (§5), sequenced after Phase 1's library + reasoning work (`2026-08-04-lamplight-library-and-reasoning-design.md`, complete 2026-08-05). Decisions from the brainstorm's §14 log are restated, not reopened.

## Purpose

Lamplight currently meets each user as a stranger every morning.

Today's Lamp builds its context from **three notes** — `noteLimit: 3` in `buildDailyDevotionContext`, verified in code, not inferred from the brainstorm. Study chat retrieves per-question. Waymarks reads the month and forgets it. Nothing carries a person's actual journey: the question they have been circling since March, the psalm they keep returning to, the season they are in.

Phase 2 builds that memory — **transparent, verse-anchored, user-ownable** — and, first, the safety floor that has to exist before an AI gets more intimate with someone's journal.

## Settled upstream — restated, not reopened

From the brainstorm's §14 decision log and working defaults:

- **The crisis layer ships before personalization deepens** (§9, §5). It is a prerequisite, not a parallel track.
- **Crisis detection runs on all note saves**, not only at AI entry points (§13.12 default).
- **Season inference proposes; the user confirms or renames** (§13.8). Agency is the anti-horoscope stance.
- **Callback quotes are permitted at ≤15 words, dated, with a note citation** (§13.9) — hard seasons still witnessed, not reopened.
- **Transparency and control are non-negotiable** (§5): a "What Lamplight carries" page, per-item delete, full opt-out, and an explicit covenant at the point of AI use.
- **Weekly Insight stays deferred** until the Thread exists, then gets revisited (§13.10).
- **Source visibility by surface** (§14.2): devotional surfaces stay in Lamplight's voice, sources in the transparency panel.

## What exists, checked against the code

| Thing | State |
|---|---|
| `note_distillates`, `journey_thread` | **Do not exist.** No table, no code, no references |
| Crisis handling of any kind | **Does not exist.** A repo-wide search for `988`, crisis lines, self-harm terms returns only hex colours |
| `lamplight_jobs` | **Exists** (migration 008) — `kind`/`status`/`payload`/`attempts`/`scheduled_at`, with a claim RPC |
| `embed-note` | **Exists** — fires per save from the browser *and* on a pg_cron sweep. The natural hook |
| Today's Lamp note budget | **3 notes** (`noteLimit: 3`) |
| `lamplight_artifacts` | Exists, but its `type` check admits only `daily_devotion`, `weekly_insight`, `reflection_recap`, `tier_celebration` |
| `LamplightProvenancePanel` | **Exists** — the transparency surface to extend rather than replace |
| `_shared/voice.ts` | Holds `BANNED_PHRASES`, `CONTESTED_PASSAGES`, `TRADITION_TERMS`, `GROWTH_BANNED_PHRASES` — the house's home for lists like these |

---

## 1. The crisis layer, and the two things that decide it

This is the half with a person on the other end of it, so it gets the real argument.

### 1.1 The gate belongs at the point of USE, not the point of ingest

The obvious design is: classify on save, write a flag, done. It is wrong on its own, and the reason is a race.

`embed-note` is **asynchronous** — a queue job, swept by pg_cron. A note saved at 07:59 may not be classified when the 08:00 devotion runs. If generation reads `notes` directly, as it does today, an unclassified note reaches the model and the guarantee — *never generate normal AI reflection on that entry* — is best-effort. A guarantee that holds except under timing is not a guarantee; it is a default.

So: **the flag written at ingest is a cache, and every pipeline that reads notes must ask.** The check is a filter in `retrieveNoteContext` and in the monthly loader, not a promise made upstream.

### 1.2 Unclassified fails CLOSED — the failure modes are not symmetric

If a note has no classification yet, it is **excluded from AI generation**. Not included-pending-review.

The asymmetry is the whole argument:

- Excluding a not-yet-classified note costs a devotion that is slightly less current. The note is minutes old; the next day's devotion has it.
- Including one costs precisely the thing this layer exists to prevent — a generated reflection on an entry written in crisis.

**This never blocks the user's own writing.** The note saves, renders, syncs, and is searchable exactly as now. Fail-closed applies only to what the model is shown.

The cost is bounded and should be stated plainly rather than discovered: a note written moments before a generation will not be in it. Given Today's Lamp runs once daily and the queue drains on a one-minute cron, the window is small — but it is real, and it is the price of the guarantee being a guarantee.

### 1.3 ⚠️ Lament is not crisis, and this is the hard part

**This app exists for people writing their worst days.** Its voice is Brueggemann's — orientation, *disorientation*, new orientation. Its corpus is the Psalter, a book containing "my God, my God, why have you forsaken me" and an entire psalm (88) that ends in darkness with no resolution.

A naive detector fires on all of it. That failure is not a nuisance — it would gut the product, replacing the app's most important moments with a resource card, and it would teach users that writing honestly gets them a canned response. **The most likely way this feature fails is by working too well.**

So the detector's job is not "detect distress". It is to distinguish **lament** — pain brought into words, often God-ward, which is the app functioning — from **risk to self**, which is not.

Design consequences:

1. **Two stages, not one.** A cheap deterministic prefilter tuned for recall (it may over-trigger freely, it decides nothing), then a classifier whose *entire* job is the lament/risk distinction. The prefilter never suppresses anything on its own; only the classifier's verdict does.
2. **Fixtures made of lament that must NOT trip it.** This is the eval discipline the repo already runs on prompts, pointed at safety. Psalm 88, Psalm 42, Lamentations 3, Job 3 — rendered as a journal entry in a user's own voice. **If Psalm 88 in someone's own words trips the detector, the detector is wrong**, and that is a checked-in test rather than a hope.
3. **Confirm, then resource** (Woebot's protocol, per the brainstorm). The response is not an assertion about the person. It asks, and it offers.

### 1.4 What the reader actually gets

**Static, human-written, never generated.** The one moment where an AI must not improvise is this one — a model that "sounds caring" is precisely the failure mode, and a generated response cannot be reviewed before it is read.

So the copy is authored, reviewed by the doctrinal review board (whose remit already covers voice and rule lists), version-controlled, and rendered from a constant. Alongside it: real resources, and an explicit **"Lamplight is not a crisis service"** disclosure carried at consent, not buried.

The note itself is untouched. Nothing is deleted, hidden, or flagged to the user as a problem with what they wrote.

---

## 2. Note distillates

Per-note structured signals, extracted once, cheap.

**Rides the existing `lamplight_jobs` queue.** A second queue would be a second thing to sweep, retry, and monitor; `embed-note` already fires on exactly the event distillation needs. A new job `kind`, not new infrastructure.

Extracted per the brainstorm §5: themes (controlled vocabulary + free), posture (lament / thanksgiving / petition / wrestling …), open questions the note asks, scripture engaged, people mentioned (first names only), season markers.

Two constraints worth fixing now:

- **`note_distillates` is under the same RLS as `notes`** — same owner, same delete cascade. A distillate is derived personal data and inherits every protection the source has.
- **The crisis classification lands here too**, as a column on the distillate rather than a separate table. One row per note, one place to look, one place to delete.

Cost, from the brainstorm's envelope: ~$0.001–0.003 per note.

---

## 3. The Journey Thread — rows, not a blob

The rolling ~800–1,500-token profile: recurring questions, active themes with scripture anchors, current season, the user's own vocabulary, trajectory deltas, prayer patterns. Built from distillates + Waymarks structs — **never a raw re-read of the vault**, which is the cost and privacy bound.

**Decision: the Thread is stored as structured rows, not one JSON blob.**

The transparency contract is what forces it. "Per-item delete" is non-negotiable (§5), and per-item delete over a blob means surgery on a document — fiddly, easy to get wrong, and impossible to present legibly without re-deriving the items. As rows, the same requirement is a `delete` and the "What Lamplight carries" page is a list.

It also makes the prompt block a *render* of the rows rather than a stored string, so a deleted item cannot survive in a cached copy — which a blob-plus-rendered-cache design would let happen.

**Not `lamplight_artifacts`.** That table's `type` check does not include a Thread kind, its uniqueness is `(user_id, type, period_key)` — a period-keyed log, not a rolling current-state — and the Thread is read on nearly every generation while artifacts are written once and read rarely. Different access pattern, different table.

---

## 4. Where the Thread flows

Injected as a **cached system-prompt block** (explicit cache breakpoints — the expensive habit to avoid is un-cached long contexts):

- **Today's Lamp** — the biggest lever, since it currently sees three notes;
- **both chats** — currently per-question retrieval only;
- **Waymarks** — "this month *against* the journey so far";
- later, Witnesses matching (Pillar C, Phase 4) and connection whys (Pillar D, Phase 3).

**Timeline callbacks with receipts** are the payoff users actually feel — *"In early June you wrote about the interview with an open hand — Psalm 37 was open that week."* Per §13.9 these may quote the user's own words at ≤15 words, dated, always paired with the note citation. **Hard seasons stay witnessed, not reopened**: a callback marks the stone, it does not replay the battle.

---

## 5. Season taxonomy and agency

Brueggemann's frame at the top (orientation → disorientation → new orientation — unranked, cyclical, native to the Psalter), with ~8 named seasons beneath it: calling, wilderness, waiting, testing, grief, doubt, return, renewal.

**Inference proposes; the user disposes** (§13.8). They can see their season and rename it. This is the anti-horoscope stance, and it doubles as the highest-quality training signal the system will ever get — a correction is worth more than an inference.

---

## 6. Transparency: "What Lamplight carries"

A page rendering the Thread legibly, with per-item delete and full opt-out. Extends `LamplightProvenancePanel`'s posture rather than inventing a second vocabulary for the same idea.

The covenant is explicit at the point of AI use: *your notes are read to write your reflections; never to train models; never sold.* Day One's lesson, recorded in the brainstorm, is that privacy architecture which makes the AI shallow kills the feature — **the answer is transparency and control, not opacity.**

---

## 7. Slices

Matching Phase 1's shape (1a–1d), each with its own plan:

| Slice | What | Gated on |
|---|---|---|
| **2a — the crisis layer** | Prefilter, classifier, the use-point gate, static response, consent disclosure, lament fixtures | Nothing. **Ships first and alone** |
| **2b — note distillates** | `note_distillates` + RLS, the job kind, extraction prompt, backfill | 2a (the classification column lands with it) |
| **2c — the Thread + seasons** | `journey_thread` rows, monthly refresh, season inference + rename | 2b |
| **2d — surfaces + transparency** | Injection into Today's Lamp / chats / Waymarks, callbacks, "What Lamplight carries" | 2c |

**2a ships alone, and that ordering is the point** — it is the prerequisite the brainstorm names twice (§5, §9). Nothing in 2b–2d should land before it.

---

## 8. What Phase 2 does not do

- **No Witnesses** (Pillar C) — Phase 4, and it consumes the Thread's seasons rather than producing them.
- **No Connections Engine** (Pillar D) — Phase 3.
- **No Weekly Insight.** Deferred until the Thread exists, then revisited (§13.10) — which is *after* this phase, not during it.
- **No raw-vault re-reads.** The Thread is built from distillates and Waymarks structs, by construction.
- **No tradition lens.** `tradition_hint` stays dormant (§14.6).

## 9. Open items

1. **The crisis response copy itself** — authored by Myles, reviewed by the board. Engineering ships the mechanism and the placeholder; the words are not an engineering artifact.
2. **Which resources, for which regions.** A US-only helpline list is wrong for a global app, and a wrong number is worse than none.
3. **Refresh cadence** — monthly after Waymarks, or quarterly. Monthly is the working assumption; the cost envelope (~$0.05–0.15/user/month) supports it.
4. **Budget ceiling** (§13.11 / P1-4), still unset from Phase 1. The Thread's injection cost makes it worth setting here.

---

*Prepared 2026-08-07. Brainstorm: `2026-08-04-lamplight-depth-brainstorm.md` (§5 Pillar B, §14 decision log). Phase 1: `2026-08-04-lamplight-library-and-reasoning-design.md`.*
