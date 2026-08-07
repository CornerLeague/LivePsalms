# Study Insights B3 — the *Deeper In* door

> Phase B3 of `2026-08-06-study-insights-design.md`. B1 shipped the overlay and the free Sources & Reference door (#112); B2 shipped Door 1, the first generated door (#115); A1 took the corpus from three sources to eight (#117) so this door has breadth to be deep about. Product decisions from the parent design and from A1's sequencing note are restated, not reopened.

## Purpose

Door 1 answers *what is going on in this passage?* Door 2 answers the questions a reader arrives at once they know: **how do I read this, where did it come from, what does it carry, and how does it get misused?**

Four sections (parent design, decision 3):

| Section | `section` key | What it does |
|---|---|---|
| **How to Read This Passage** | `hermeneutics` | The genre's own rules — what this kind of writing is doing and what it is not claiming |
| **Historical & Cultural Setting** | `historical_setting` | The world the passage came out of, and what a first audience would have heard |
| **Theological Significance** | `theology` | What the passage carries doctrinally, **and whose reading that is** (§3) |
| **Read With Care** | `read_with_care` | The interpretive moves this passage invites and does not support (§2) |

The distinction from Door 1 is not depth of tone but **kind of claim**. Door 1's sections are readable off the passage and the chapter; three of Door 2's four are not — they need voices, and that is precisely what A1 bought.

## Settled upstream — restated, not reopened

- **Door 2 keeps the blanket contested-passage rejection.** It does not take study chat's `allowContestedRefs` exemption (Myles, 2026-08-07; recorded in A1's plan). Same reasoning as Door 1: descriptive, generated once, served to everyone from a shared cache. §5 states the consequence, which is sharper here than it was for Door 1.
- **§9's Read With Care constraint is a hard rule, not a style note.** Permitted: interpretive moves — context-stripping, etymology-as-meaning, genre errors, anachronism. Forbidden: any caution aimed at a tradition, denomination, or group. A caution with no warrant in the supplied sources or the passage's own literary data is omitted. §2 is how that becomes mechanical.
- **Global shared cache, explicit generate, public free reads, two grains, prefill-never-autosend, omission first-class** — parent design decisions 4–9, unchanged.
- **B2's own settled points** carry: derived ceilings (`ceilingFor`), the validator stack reused wholesale, library excerpts never widen `allowedVerseRefs`, `displayRefs: true` on every reader-facing surface.

---

## 1. The architectural call: how much of Door 1's machinery becomes door-generic

This is B3's one real design question, and the handoff is right that it should be settled deliberately rather than by drift.

### What the coupling actually is

Read against the code rather than the handoff's table, the machinery is **already close to generic, and its Door-1 coupling is mostly import-site rather than shape**:

| Module | Actual state |
|---|---|
| `prompts/passage-insight.ts` | The SYSTEM string *and* the tool schema are both **generated from `PASSAGE_INSIGHT_SECTIONS`**. Only the surrounding prose is Door-1 specific. |
| `passage-insight-cache.ts` | `readPassageDoor` / `writePassageDoor` **already take an optional `door`**, defaulting to `PASSAGE_DOOR`. Only the section list is a hardcoded import. |
| `passage-insight-pipeline.ts` | Validators, retry, streaming, outcome-mapping are all door-agnostic. It imports Door 1's constants at six sites and nothing else ties it down. |
| `passage-insight-stream.ts` | Cache read → entitlement → quota → stream → write is door-agnostic in shape; it just never passes a `door`. |
| `InsightsOverlay.tsx` / `doors.tsx` | **Already generic.** Doors are data; the chooser wakes up on its own at two doors. B1 built this correctly. |
| `usePassageInsight.ts`, `PassageDoor.tsx`, `passage-insight-stream-client.ts` | `const DOOR = 'passage'` and a mirrored section list. Rendering logic is otherwise door-agnostic. |
| `scripts/eval-lamplight.ts` | `checkSections` reads a module-level `PASSAGE_SECTION_KEYS`; the fixture has no door dimension. |

So the choice is not *build an abstraction vs. don't*. B2 already built one — a door is a section list plus some prose — and only stopped short of passing it in.

### Decision: generalise, along one line

**Generic if it is mechanism. Per-door if it is editorial.**

That line is the decision, and it resolves each module without further argument:

**Generic** (moves to shared modules, parameterised by the door):
- `InsightSection`, `CHARS_PER_WORD`, `ceilingFor()` — the ceiling derivation is the anti-truncation rule and must not be re-derived per door.
- Tool construction from a section list, and the three load-bearing tail sentences (stay in range and finish the sentence · an empty section is a legitimate answer · list what you leaned on in `citations`). These are the two-bound design and the omission rule; a second copy is a second thing to drift.
- The whole pipeline: `sectionsOf`, flattening, the validator composition, per-section Scripture verification, the retry, the buffered and streaming entries, `textFields`.
- Cache read/write, the stream orchestration, the request/cache-key contract, the SSE shell.
- The client's transport, cache-read hook, and section renderer.

**Per-door** (stays plainly readable in its own file):
- The section list, with each section's brief and word target.
- The system prompt's own prose — its opening framing, its contested-passage sentence, its door-specific rules (Door 2 has two that Door 1 does not: §2's tradition rule and §3's attribution requirement).
- `promptVersion`.
- Retrieval knobs: `registers`, `libraryK` (§4).
- The client's label, blurb, and section headings.

**The prose stays per-door on purpose.** A builder that assembles system text from fragments would be the wrong kind of reuse here: prompt prose is editorial content that this repo reviews line by line and version-stamps, and burying it behind a `buildSystem(spec)` makes the one thing that most needs reading the hardest thing to read. Sharing the *mechanism* gets every safety property; sharing the *prose* would only get fewer characters.

### Why not duplicate-then-diverge

The real alternative was to copy `passage-insight-*.ts` to `deeper-insight-*.ts` and change the constants. Rejected:

- It duplicates ~700 lines of server logic and ~300 of client for a difference that is a section array and four paragraphs of prose. Every future fix — a validator, an SSE beat, the cache contract — then has two homes, and the second is the one that gets missed.
- The properties most worth protecting are exactly the shared ones. `ceilingFor` exists because a hand-set ceiling truncated a reply mid-word; the cache-key composer is pinned by test on both sides because a drift there silently re-bills every reader. Duplicating those is duplicating the bugs they were written to prevent.
- The parent design's whole door model is "each door is one generation batch and one cache group." Two engines contradicts it.

### The one real risk, and its gate

**Door 1 is live, registered, and has a checked-in eval baseline at `passage-insight-2026-08-06-v1`.** A refactor that shifts its emitted SYSTEM string by one character changes its output without a version bump, and the change would not be visible in any test that asserts behaviour rather than bytes.

So: **the refactor lands under a byte-identity gate.** Before touching anything, snapshot Door 1's `PASSAGE_INSIGHT_PROMPT.system` and its serialized `tool` schema; after, assert both are byte-identical, and that `promptVersion` is unchanged. This is not a new discipline — B2 did exactly this when it extracted `STUDY_GROUNDING_RULES` ("verified byte-identical after extraction, 2,870 chars before and after, which is why study-chat's `promptVersion` legitimately did not bump"). If a byte moves, either the move is wrong or Door 1 needs a version bump and a fresh baseline; there is no third option and no judgement call.

### One edge function, not two

`passage-insight` (the table, the function, the quota kind, the eval artifact kind) already names *insight about a passage*, not *the Passage door* — the table has carried a `door` column since migration 060. So the deployed surface does not get renamed, and Door 2 does not get its own function.

`door` joins the request body, defaulting to `'passage'` so existing clients keep working, and is validated against the registry rather than trusted. One function to deploy, one boot check, one runbook. The per-door variation the shell needs — prompt module, `registers`, `libraryK` — is a registry lookup.

---

## 2. Read With Care, made mechanical

§9 is a hard rule. A prompt sentence is not a hard rule; it is a request that usually works.

### The rule has two halves, and only one is checkable

1. **No caution aimed at a tradition, denomination, or group.** Checkable against a term list.
2. **No caution without warrant in the supplied sources or the passage's own literary data.** Not checkable — warrant is a judgement about grounding, not a property of the string. This half stays a prompt instruction plus the omission rule, and is measured by eval rather than enforced by validator.

### Half one becomes a section-scoped content rule

`TRADITION_TERMS` joins `BANNED_PHRASES` / `CONTESTED_PASSAGES` / `GROWTH_BANNED_PHRASES` in `_shared/voice.ts` — the house's existing home for lists like this. It holds **modern tradition and denomination names**: Reformed, Calvinist, Arminian, Catholic, Orthodox, Baptist, Methodist, Wesleyan, Lutheran, Anglican, Presbyterian, Pentecostal, charismatic, dispensational, evangelical, fundamentalist, and the "liberal/progressive/mainline + scholars/Christians/churches" constructions.

Two boundaries that keep it honest:

- **It runs against `read_with_care` only, never the flattened door.** *Theological Significance* is required to name whose reading it is giving (§3), and *Historical & Cultural Setting* legitimately discusses groups. A door-wide check would forbid in one section exactly what another section demands. This means the pipeline grows one genuinely new capability: **per-section content rules**, alongside today's flatten-then-check.
- **It is hardcoded, not derived from `library_sources.tradition`.** Deriving it would be clever and wrong: an A2 source arriving would silently change what is forbidden, and the corpus's tradition strings ("Reformed (Continental)", "Methodist (Wesleyan)") are ingest metadata, not a policy list.

Biblical-era groups — Pharisees, the circumcision party — are deliberately absent. §9 is about aiming a caution at a living tradition; a passage's own cast is the passage's own data.

### A violation is fatal to the door, and that is the intended failure mode

It records as `family: 'banned'`, `rule: 'tradition_caution'`, so it rides the existing stricter-retry channel and the model gets a real second chance with a specific instruction. If it survives the retry, the door fails and no rows are written — which is loud. The reader sees *Study this passage* still on offer rather than a door that quietly lost a section.

**Considered and deferred:** repairing by deletion — blanking `read_with_care` and keeping the other three sections, which §9's own "is omitted" phrasing suggests. `validate` already supports `repaired`, so the shape exists. It is deferred because it needs attempt-awareness inside `validate` to avoid suppressing the retry entirely, and because a silently-missing section is exactly the invisible shortfall #114 was about. Revisit **with a measured violation rate**, not before.

### Bait fixtures are the only real proof

A rule like this cannot be validated on passages that never provoke it. B3's eval set includes at least one fixture chosen because it *invites* a denominational caution — a passage whose misreadings are habitually denominational rather than merely careless. The check is not "did the door pass" but "did the door say something true about the interpretive move without naming who makes it."

---

## 3. Attribution: A1's watch item lands here

A1's completion sweep measured, per study-chat reply: `study-hebrews-11` grounded on 4 sources named Calvin, Geneva and Jamieson; `study-romans-9` on 3 named Wesley; **`study-genesis-1` on 3 and `study-psalm-27` on 2 named nobody.** `STUDY_GROUNDING_RULES` already says the reader is owed the source of a reading.

Door 1's own baseline shows the same pattern in miniature: `passage-psalm-27` names Spurgeon and Jamieson — in *Reflection & Application*, the last section — and `passage-nahum-1` names nobody at all.

**And so does real production output.** The two Door 1 doors warmed on Leviticus 1 (§11) name a voice in **2 of 8 sections** — Jamieson/Fausset/Brown in `lev.1`'s Overview, Clarke in `lev.1.1`'s In the Chapter. Every door names somebody, no section names anyone twice, and three-quarters of the prose a reader actually sees carries no attribution at all. That is the pattern to improve on, measured on the surface itself rather than inferred from study chat.

**Theological Significance is the section where an anonymous verdict does the most damage.** "This passage teaches X" with no voice behind it is precisely the thing the rule exists to prevent, and it is the section a reader is most likely to take as settled.

Three moves, in this order — the order is the point, per `eval-harness-discipline`:

1. **Build the check before changing the prompt.** `checkAttribution(prose, ctx.libraryExcerpts)` — does the section name any supplied source? The nameable token comes from real data, not a regex guess: `library_sources` holds `author` per source, and `sourceLabel` is `title · author, era`. So the check asks whether the prose contains a supplied source's author surname or, for `geneva-notes` (author: "Geneva Bible translators"), its title token.
2. **Measure the baseline** on Door 2's fixtures before any prompt change, so the effect of the change is attributable to the change.
3. **Then change the prompt** — Door 2's `theology` brief requires the reading be attributed — and re-measure.

**Do not make attribution a pipeline validator.** A hard "name someone or fail" pushes the model toward naming a voice it did not lean on, which violates a rule that matters more ("never attribute a claim to a voice that did not make it") and is undetectable from outside. It is an eval check whose number must not regress, not a gate.

---

## 4. Retrieval steering: measure, then apply

Parent design §7 wants Door 2 biased to `exegetical` + `confessional`. After A1 that is finally a real option, and the register census is measured from the live table:

| register | sources |
|---|---|
| `exegetical` | `adam-clarke`, `calvin-commentaries`, `catena-aurea`, `jfb` — **4** |
| `confessional` | `geneva-notes` — **1** |
| `devotional` | `matthew-henry-concise`, `treasury-of-david`, `wesley-notes` — 3 |

So Door 2's filter would admit **5 of 8 sources**, against the 3 that made the same filter destructive for Door 1.

But `registers` is a **hard filter, not a bias** — the fact that decided Door 1 twice — so it gets measured before it gets applied. Door 1's post-A1 unsteered grounding (`2026-08-07-a1-embedded`) is the starting point:

| fixture | sources, unsteered, post-A1 |
|---|---|
| `passage-psalm-27` (chapter) | `treasury-of-david`, `jfb` |
| `passage-psalm-27-v4` (verse) | `adam-clarke`, `calvin-commentaries`, `wesley-notes` |
| `passage-nahum-1` (chapter) | `treasury-of-david`, `jfb`, `adam-clarke` |

Two things that table says about Door 2:

- **On Psalms, Treasury's specificity dominance still crowds the slate**, and Treasury is devotional. Steering is the one thing that breaks that grip and lets Calvin, Clarke, Catena and Geneva onto a psalm — which is the entire reason A1 ran.
- **On Nahum, Treasury is present only through the `psa 91:1` cross-reference anchor** — Spurgeon on a psalm, informing a Nahum door. For Door 1's reflective register that is defensible; for Door 2's hermeneutics and theology it is close to noise.

**The gate:** a free `--grounding-only` A/B on Door 2's fixtures, steered vs. unsteered, scored on **source spread**, not excerpt count. Apply the filter only if it holds or widens spread on every fixture. Watch specifically for Clarke crowding out the rest — Clarke has 23,797 chunks against Catena's 2,966, and an unsteered top-k already tends toward whoever has the most rows on the chapter.

`libraryK` is a second knob in the same spec. Door 1 uses 4. Door 2 asks three of its four sections to lean on voices, so 6 is the candidate — also measured on the same free sweep, and also only adopted if it buys spread rather than more of the same source.

### Measured, 2026-08-07 — steering ADOPTED, and `libraryK: 6` with it

Three free sweeps: `2026-08-07-b3-deeper-unsteered`, `-steered`, `-steered-k6`. The harness now reports **per-source counts** rather than a deduped list, because "4 — clarke, calvin, geneva" hides whether that is 2/1/1 or 1/1/2, and the question the decision turns on is exactly whether one high-volume source is taking the slate.

| fixture | unsteered (k=4) | steered (k=4) | steered (k=6) |
|---|---|---|---|
| `deeper-psalm-27` | **treasury×3**, jfb×1 | jfb×1, geneva×1, clarke×2 | jfb×2, geneva×1, clarke×2, calvin×1 |
| `deeper-psalm-27-verse-4` | clarke×2, calvin×1, wesley×1 | clarke×2, calvin×1, geneva×1 | clarke×3, calvin×1, geneva×2 |
| `deeper-nahum-1` | treasury×2, jfb×1, clarke×1 | jfb×1, clarke×2, geneva×1 | jfb×1, clarke×2, geneva×1, calvin×2 |
| `deeper-romans-9` | clarke×1, calvin×2, wesley×1 | clarke×1, calvin×2, geneva×1 | **clarke×3**, calvin×2, geneva×1 |
| `deeper-james-2` | wesley×1, calvin×2, geneva×1 | calvin×2, geneva×1, clarke×1 | calvin×2, geneva×1, clarke×2, jfb×1 |

**Steering is a clear win, and the counts are what make it clear.** Unsteered, Psalm 27 gives **three of four slots to Treasury** — one devotional source, on the door whose hermeneutics and theology sections want exegetical and confessional ones. That is A1's specificity dominance, and the deduped view ("treasury, jfb") understated it badly. Steered, no source exceeds two of four. The filter **never narrowed the distinct-source count on any fixture**, and it took a confessional voice from **1 of 5 fixtures to 5 of 5** — which is precisely what parent design §7 asked for and what A1 bought Geneva for. On Nahum it also drops Treasury, which reaches that book only through a psalm cross-reference anchor.

**`libraryK: 6` adopted, with a caveat worth keeping.** It adds a fourth distinct source on 3 of 5 fixtures and never reduces the count. But on `deeper-romans-9` both extra slots went to Clarke, taking it from 1/4 to 3/6 — the crowding this section said to watch for. Adopted because it never costs a voice; revisit if a later sweep shows Clarke taking the slate on more than one fixture.

**Door 1 is unchanged**, verified rather than assumed: `2026-08-07-b3-door1-regression` returns the same sources in the same order as `2026-08-07-a1-embedded` on all three of its fixtures.

**`displayRefs: true` is not a knob.** Every reader-facing surface sets it, and Door 2's prose is reader-facing.

---

## 5. Consequences of keeping the contested rejection

The decision is settled; its consequence for *this* door is sharper than for Door 1 and needs stating rather than discovering.

`CONTESTED_PASSAGES` covers Romans 9:11–23, Ephesians 1:4–5, 1 Corinthians 11:2–7 and 14:34–35, 1 Timothy 2:11–15, Daniel 9 and 12, Revelation 13 and 17, Matthew 24, Mark 13, 2 Thessalonians 2. **These are disproportionately the chapters whose *Theological Significance* a reader would most want** — and a contested violation fails the whole door, so the failure mode is "the deepest door is unavailable on the deepest chapters."

That is not a reason to reopen the decision. It is a reason to make the prompt steer around it deliberately rather than walk into it: describe what the text plainly says, name that the question is disputed, stop — the same sentence Door 1 carries, which is doing real work there.

**It needs a fixture.** A contested chapter (Romans 9 is the obvious one, and already a study-chat fixture) asserting that the door **generates successfully** while adjudicating nothing. Without it, B3 could ship a door that fails on exactly the passages that justify it, and the eval set would stay green because no fixture ever asked.

---

## 6. Data model — migration 061

Two changes, both to `bible_passage_insight`.

```sql
-- widen the door check: B2 kept it narrow on purpose until B3 arrived
check (door in ('passage', 'deeper'))

-- and put `door` in the key
primary key (scope, ref_id, door, section)
```

**The PK widening is the landmine B2 wrote down and left.** `primary key (scope, ref_id, section)` makes `('chapter','psa.27','overview')` unique across *all* doors, so a section name shared between two doors would have the second door's write silently overwrite the first's row — and the first door's read, filtered on `door`, would come back with three sections instead of four. B3's four keys do not collide with B2's, and they are chosen not to, but "no collision today" is not a constraint.

**Widen it rather than rely on non-collision.** The table holds **8 rows** — two Door 1 doors on Leviticus 1, warmed by hand on 2026-08-07 (§11) — all under `door = 'passage'`. Widening the key over eight rows is still free: no rewrite, no dedup, no backfill, and no possibility of a conflict. It will never be cheaper than it is now.

Three details the migration must get right, because it is applied by hand through the SQL Editor:

- **`writePassageDoor`'s `onConflict` moves in lockstep** — `'scope,ref_id,section'` → `'scope,ref_id,door,section'`. Postgres requires the conflict target to match a real unique constraint, so a mismatch fails the upsert loudly rather than corrupting anything. That is the good failure, but it means **the migration and the deploy must land together**: between applying 061 and deploying the function, Door 1's generate path is broken. With 0 rows and no reader having ever generated, the window is harmless — but it is stated so nobody discovers it.
- **The check constraint's real name is looked up, not guessed.** An inline `check` in `create table` gets an auto-generated name; the migration reads `pg_constraint` for it rather than assuming `bible_passage_insight_door_check`.
- **The `(scope, ref_id, door)` index becomes redundant** — the new PK's index covers that prefix. Dropping it is optional and worth doing.

Everything else in the table is unchanged: public-read RLS, service-role write, `prompt_version` and `model_used` stamped per row, `sources` carrying the library snapshot.

**Cost.** Door 1 measured **$0.17 for three doors ≈ $0.057 per door** (`2026-08-06-b2-passage-door`), including a stricter retry on one fixture. Door 2's section ceilings total 6,700 characters against Door 1's 6,500, so the same order: **~$0.06 per passage, ever.** The `PASSAGE_INSIGHT_MAX_TOKENS = 6144` budget covers Door 2's ~710 ceiling-words with room for reasoning; it does not need raising.

---

## 7. Section bounds

Same two-bound rule as B2, and the same authority: **`ceilingFor(maxWords)` derives every ceiling from its word target.** The table below is a rendering of that function and goes stale if the constants change.

| Section | Word target (prompt) | Ceiling (derived) |
|---|---|---|
| How to Read This Passage | 110–180 | 1700 |
| Historical & Cultural Setting | 120–200 | 1900 |
| Theological Significance | 120–200 | 1900 |
| Read With Care | 70–130 | 1200 |

*Read With Care* is deliberately the shortest. It is a list of moves the passage does not support, and a long one is a prompt to invent the fourth and fifth.

`minLength: 0` on every field, as in Door 1: a section with no warrant must be able to come back empty, and Door 2 will hit that more often than Door 1 did — *Historical & Cultural Setting* on a one-line proverb, *Read With Care* on a genealogy.

---

## 8. Eval coverage

The harness gains a door dimension: `checkSections` takes the section keys rather than importing Door 1's, and the fixture's `passageInsight` block gains `door`. `--artifact=passage-insight` runs both doors' fixtures; `--door=` narrows.

Fixtures, each chosen for a property rather than for variety:

| Fixture | Why |
|---|---|
| A densely-covered psalm, chapter grain | The best-supplied case, and where Treasury's dominance makes §4's steering question visible |
| A verse grain | Both grains exercised, and `grounding_focus_verses` guards against a silent degrade to chapter |
| A thin non-Psalm OT chapter | Where a section legitimately has nothing to say, and padding is the temptation |
| **A contested chapter** | §5 — the door must still generate |
| **A denominational-bait passage** | §2 — the tradition rule proved on a passage that provokes it |

Checks carried from Door 1 unchanged: grounding floors, per-section presence and mid-word truncation, `checkDisplayRefs` (no OSIS codes in reader-facing prose), `checkProperties`. Added: **`checkAttribution` on `theology`** (§3).

**The ordering from B2's Task 9 is not negotiable and is the whole lesson of #114:** the live baseline goes green *before* Door 2 is registered in `doors.tsx`. Server work is independently verifiable; a reader must not reach a surface with no baseline.

---

## 9. What B3 does not do

- **No Lamplight handoff.** The seeded-prompt seam is still B4 (B2's D4), for both doors.
- **No precompute sweep.** Warming stays on-demand.
- **No cache invalidation on a prompt bump.** Serve stale, refresh deliberately (B2's D2). `scripts/refresh-passage-insights.ts` gains a `--door` filter and nothing else.
- **No rename of the deployed surface** — table, function, quota kind and artifact kind keep their names (§1).
- **No door names pass.** "Deeper In" is still the parent design's placeholder (open item 1); naming is B4's, with Waymarks and Today's Lamp.

## 10. Sequencing

1. **Migration 061** — PK widening + door check, applied by hand, with `onConflict` moved in the same change.
2. **The generic seam** — extract mechanism from `prompts/passage-insight.ts`, parameterise the pipeline / cache / stream, **under the byte-identity gate** (§1). Door 1 must be provably unchanged before Door 2 exists.
3. **Door 2's prompt module** — sections, briefs, bounds, and the two door-specific rules (§2, §3).
4. **Per-section content rules** + `TRADITION_TERMS` (§2).
5. **Door registry + `door` in the request contract**, server and client, both cache keys pinned by test.
6. **The free grounding sweep** — steering and `libraryK` decided on measurement (§4).
7. **`checkAttribution`, then the prompt's attribution requirement, then re-measure** (§3) — in that order.
8. **Live eval baseline, checked in. Then registration** (§8).
9. Runbook extended; `refresh-passage-insights` gains `--door`.

Steps 1–7 are server-only and independently verifiable; the door stays unregistered until step 8 is green.

---

## 11. Two things B3 inherits that are not B3's

Both are recorded here because B3 rides them and would inherit any breakage.

- **Two of B2's three outstanding live checks are now actually done — the handoff, the runbook and the B2 plan all say "0 rows", and all three are stale.** Measured against the live table on 2026-08-07: `bible_passage_insight` holds **8 rows**, two complete Door 1 doors on Leviticus 1 — `lev.1` at chapter grain (00:57 UTC) and `lev.1.1` at verse grain (06:24 UTC), both `passage-insight-2026-08-06-v1` on `gpt-5.6-sol`, all eight sections non-empty and none ending mid-word. So **end-to-end generation through the deployed function works, on both grains**, and the deployed prose carries **no OSIS leaks** and names voices (Jamieson/Fausset/Brown on `lev.1`, Clarke on `lev.1.1`). The **public cached read is verified too**: the exact query the client hook issues, sent with no bearer token, returns `200` and all four sections. What is left of that check is only what needs a browser — that a signed-out reader sees it with no spinner and no entitlement prompt — plus the interrupted-generation case, which remains untested. `docs/runbooks/passage-insight.md` §6 is the procedure.
- **`tsc -b` does not typecheck `supabase/functions` at all.** `tsconfig.app.json` includes only `src`, so the gate covers none of the edge functions; the logic modules are at least exercised by vitest, the Deno shells by nothing. This is not theoretical — **it is how `passage-insight/index.ts` came to reference an undefined `DOOR_REGISTERS` on the generate path**, added in `a7572bc8` alongside a comment block explaining that Door 1 deliberately takes no register filter. The successful `lev.1.1` generation *after* that commit existed confirms the reading: the line was committed but never deployed, so **B3's own redeploy is exactly when it would have gone live**, on the first door anyone generated afterwards. Fixed on this branch in `867445b0`; **PR #117 still carries it.** A standing typecheck for `supabase/functions` is worth its own slice.

---

*Prepared 2026-08-07. Parent: `2026-08-06-study-insights-design.md`. Builds on #112 (B1), #115 (B2), #117 (A1). Door 2's contested-rejection decision: Myles, 2026-08-07.*
