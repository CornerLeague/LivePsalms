# Handoff: Study Insights B4 — the handoff seam, mobile parity, and the `opener` rename

**Date:** 2026-08-07
**Status:** READY TO DESIGN. B3 shipped and is live; all three doors are registered and reachable in production. **There is no B4 design or plan yet — writing the design is the first task**, following the shape of `2026-08-07-study-insights-b3-design.md`.
**Branch:** cut from `origin/main`. Everything B1–B3 needs is merged — #112, #113, #114, #115, #117, #118, #119, #120.

## Read these first, in this order

1. **Parent design:** `docs/superpowers/specs/2026-08-06-study-insights-design.md` — **§8 is B4's spine** (the three context-passing seams), §2 has the mobile behaviour, §10 defines the rename, and §12 names B4.
2. **B2's design + plan:** `2026-08-06-study-insights-b2-design.md` (**D4 explains why the handoff was deferred to here**) and `2026-08-06-study-insights-b2.md`.
3. **B3's design + plan:** `2026-08-07-study-insights-b3-design.md` and `2026-08-07-study-insights-b3.md` — the door-generic architecture B4 builds on, and a decision log worth reading before repeating anything in it.
4. **The runbook:** `docs/runbooks/passage-insight.md` — operational state, and §5's table of what is and is not verified. **Two rows are still open and they are B4's to close** (§ below).

## What B4 is

Three things, from the parent design's §12 and B2's D4:

**1. The Lamplight handoff seam** (parent §8) — the substantial half.
**2. Mobile parity** (parent §2, §7).
**3. The `mode: 'insight'` → `mode: 'opener'` rename** (parent §10) — mechanical, and the smallest.

### 1. The handoff seam

Parent §8 defines three seams; **one is already done**, which is worth knowing before you plan:

- **Reader → Insights: DONE.** `selectedVerse` reaches the overlay in both workspaces (`StudyWorkspace.tsx:228`, and the mobile twin). The scope chip and the whole-chapter toggle work off it.
- **Insights → Chat: NOT STARTED.** A seeded-prompt seam carrying `{ text, scope: { book, chapter, verse? }, section }`. **Prefills, never auto-sends** — the reader stays the author of their question. **Appends to the passage's existing thread**; threads are keyed `(user_id, passage_ref, surface='study', archived=false)`, so a new thread per handoff would fragment history.
- **Section → retrieval steering: NOT STARTED.** The section travels with the prompt so a hermeneutics question biases differently from a theology one.

Today `LamplightStudyPanel` takes exactly `{ book, chapter, userId }` (`panes/LamplightStudyPanel.tsx:55`). That is the seam to widen. Every section footer is meant to carry 2–3 seeded prompts scoped to that section.

**B3 makes this cheaper than the parent design assumed.** Section keys and labels now live in a client registry (`src/notepad/study/insights/insight-doors.ts`) with a parity test against the server's. A seeded prompt per section is a field on the section view, not a new lookup table — but see the landmine about that parity test before adding one.

### 2. Mobile parity

**Less remains than the parent design implies.** `MobileStudyWorkspace` already registers all three doors and renders `InsightsOverlay` with `selectedVerse` — B3 wired it. What is unproven:

- The overlay's behaviour **over the mobile tab bar**, and the back affordance (parent §2).
- The handoff's mobile path: close the overlay, switch to the Study tab, land in Chat with the draft present. **Panes stay mounted, so the draft survives — the seam is shared draft state, not a remount** (parent §8).
- `MobileStudyWorkspace.test.tsx` mentions Insights, but **nobody has opened the overlay on a real phone viewport**. Check what that test actually asserts before trusting it.

### 3. The rename

`mode: 'insight'` still means "the chat-opening observation" in `lamplight-study/index.ts` (eight sites), `prompts/study-insight.ts`, `study-chat-client.ts` and `LamplightStudyPanel.tsx`. The feature is called Insights now, so the collision is real. Parent §10: **`mode: 'insight'` becomes `mode: 'opener'`**; the etymology table keeps its name.

It is mechanical, but it crosses the client/edge boundary and `study-insight`'s prompt is version-stamped at `study-insight-…-v5`. **A rename that changes no emitted bytes should not bump that version** — see how B3 proved Door 1 unchanged.

## Decisions already made — do not relitigate

- **Handoff prefills, never auto-sends**, and appends to the passage's existing study thread (parent decision 7, §8).
- **Cross-references stay shown, never explained.** No generated "why they connect" until Pillar D of the depth overhaul.
- **Both generated doors keep the blanket contested-passage rejection.** Study chat keeps its `allowContestedRefs` exemption. If a seeded prompt lands a reader in chat on a contested passage, chat's exemption is the correct behaviour — that is the whole reason the two differ.
- **Insights are global and carry no per-user content** — the handoff must not change that. The seeded prompt is composed client-side from a cached public door; nothing per-reader enters the cache.
- **Door names are still placeholders** (parent open item 1). "The Passage" / "Deeper In" / "Sources & Reference" want a pass in the app's voice. B4 is the natural place, and it is a Myles call, not an engineering one.

## What already exists that B4 reuses

| Thing | Where | State |
|---|---|---|
| Door registry, client | `src/notepad/study/insights/insight-doors.ts` | Section keys + labels, parity-tested against the server |
| Door registry, server | `supabase/functions/lamplight-study/insight-doors.ts` | Prompt module, sections, per-door `libraryK` / `registers` |
| The generic door renderer | `insights/PassageDoor.tsx` | Renders any door from its view; a section footer would go here |
| The overlay | `insights/InsightsOverlay.tsx` | Doors are data; chooser wakes at >1; focus/escape/scroll handling cloned from `RegionMapFullscreen` |
| Study chat transport | `study-chat-client.ts`, `LamplightStudyPanel.tsx` | Where a seeded draft has to land |

## ⚠️ Landmines

- **The client/server section-key parity test is load-bearing.** `insight-doors.parity.test.ts` compares the client registry to the server's directly — ids, keys, and order. Adding a client-only field (a seeded prompt) is fine; **renaming or reordering a key is not**, and the test is what stops a drift that would otherwise fail silently by never hitting the cache.
- **Door 1's prompt is pinned byte-for-byte** by `passage-insight-bytes.test.ts` against a checked-in fixture. If B4 touches anything under `prompts/`, expect that gate to fire, and read its header before regenerating the fixture — regenerating it alone, to make the red go away, is the one response that is always wrong.
- **`hasAccess` short-circuits on the global promo before it considers who is asking.** That is what produced B3's live regression: a signed-out reader offered a generate button that dead-ends. `canGenerateInsights` fixes it for the doors, **but the same pattern is in every other `hasAccess` call site** — check the seam you are building before you trust it.
- **A generation outlives what it was started for.** `usePassageInsight` carries an id + AbortController because the overlay's scope toggle changes `scope` without unmounting. Any new async work hung off the overlay needs the same guard.
- **The eval harness's `AnonClient` is deliberately minimal** so it can only reach `bible_passages`. A new query shape earns a new branch on that type, not a widening to `SupabaseClient`.

## Not verified — inherited, and B4's to close

Two rows in the runbook's §5 table are still open, and **both need a browser and an authenticated Plus/promo session**. §6 has the procedure.

- **Door 2 has never generated through the deployed function.** The eval drives `runPassageInsightPipeline` directly, so the whole edge path — quota bucket, entitlement, streaming, cache write on the terminal beat — is unproven for `door=deeper`. Warming one real Door 2 door closes this and gives the first true cost figure against the **$0.066/door** the fixtures measured.
- **An interrupted generation leaving the door uncached.** Unit-tested only. Easier now than at B2: there are real rows to diff against.

Both are one sitting. Doing them first would de-risk everything B4 builds on top.

## Watch items

- **Door 1 names no voice on some passages.** 3 of 4 Door 1 fixtures name a supplied source somewhere; `passage-psalm-27-v4` names none. Door 2 does not have the problem — its theology section names 1–4 voices on 5/5. **The cause is not isolated:** Door 2 differs in both its brief's phrasing *and* its register steering, so a prompt change to Door 1 is a guess with a confound until someone A/Bs it. Every snapshot reports a `voices named` line per section, so the number is visible without re-running anything.
- **Read With Care's §9 rule fails the whole door**, rather than dropping the section. Repair-by-deletion was designed and deliberately deferred pending a measured violation rate. If B4's fixtures ever trip `tradition_caution`, that is the evidence that was missing.
- **Monthly-reflection usage should now be recording.** #119 fixed a silent data loss; it cannot be verified from the repo because `lamplight_usage` is admin-gated. Check the admin dashboard for `monthly_reflection` rows with a real `model` and non-zero tokens.
- **The A1 anchor-channel limit carries:** rows are ordered by verse, so truncating a flooding source drops the chapter's tail, and a verse-scope anchor late in a huge chapter can miss that source. The real fix pushes the verse-overlap filter into SQL.

## Corpus and cache state

**111,637 chunks, 8 sources**, fully embedded — registers `devotional` 3 / `exegetical` 4 / `confessional` 1. Door 2 steers to `exegetical` + `confessional` at `libraryK: 6`; Door 1 is unsteered at 4. Both measured, not assumed (`2026-08-07-b3-deeper-*`).

`bible_passage_insight` holds **8 rows** — two Door 1 doors on Leviticus 1, both grains, **stale** against Door 1's `passage-insight-2026-08-07-v2`. That staleness is D2 working (serve stale, refresh deliberately), not a bug; `refresh-passage-insights.ts --stale` reports them at ~$0.11.

## Gate

`npx tsc -b` clean · `npx vitest run` green (**4,171** at handoff) · `npx eslint .` at its **163-problem baseline**, not zero.

**`tsc -b` now covers the whole repo** — `src`, `scripts`, and every `supabase/functions` module including the ten Deno shells (#119). The hand-run `tsc --noEmit` step earlier slices prescribed is retired.

**Do not trust numbers quoted in prose — check them against the code.** That rule has now caught three things: a "1.6–2×" ratio that survived three documents and a merged PR, a "0 rows" corpus claim that was 8, and a "six type errors" measurement that was 13 because it was taken with looser flags than the project uses. **A measurement of an ungated thing is itself ungated.**

---

## Cold-start prompt

> Start Study Insights B4 — the Lamplight handoff seam, mobile parity, and the `mode: 'opener'` rename.
>
> Read `docs/superpowers/handoffs/2026-08-07-study-insights-b4.md` first, then the docs it lists in order.
>
> There is no B4 design or plan yet — write the design first, in the shape of `docs/superpowers/specs/2026-08-07-study-insights-b3-design.md`. The main question is how much of §8's seeded-prompt seam is worth building before a reader has ever used one; decide it deliberately.
>
> Do not relitigate: the handoff prefills and never auto-sends, it appends to the passage's existing thread, and cross-references stay shown rather than explained.
>
> Branch off `main`. Gate: `npx tsc -b`, `vitest run`, `eslint .` (baseline 163 problems, not zero).
