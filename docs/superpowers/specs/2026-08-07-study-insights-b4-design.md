# Study Insights B4 — the handoff seam, mobile parity, and the `opener` rename

> Phase B4 of `2026-08-06-study-insights-design.md`. B1 shipped the overlay and the free Sources & Reference door (#112); B2 shipped Door 1 (#115); A1 took the corpus to eight sources (#117); B3 shipped Door 2 and made the machinery door-generic (#118). All three doors are registered and reachable in production. Product decisions from the parent design are restated, not reopened.

## Purpose

Three things the parent design named and the last three slices deferred:

1. **The Lamplight handoff seam** (parent §8) — a reader who has just read a section can carry a question about it into study chat, prefilled and unsent.
2. **Mobile parity** (parent §2, §7) — the overlay behaves like a destination on a phone, and the handoff works there too.
3. **The `mode: 'insight'` → `mode: 'opener'` rename** (parent §10) — clearing a name that now means three things.

The first is the substantial half. The third turns out to be twice the size the handoff describes, and to have a live wire running through it.

## Settled upstream — restated, not reopened

- **The handoff prefills and never auto-sends.** The reader stays the author of their question (parent decision 7, §8).
- **It appends to the passage's existing study thread.** Threads are keyed `(user_id, passage_ref, surface='study', archived=false)`; a new thread per handoff would fragment history.
- **Cross-references stay shown, never explained.** No generated "why they connect" until Pillar D.
- **Both generated doors keep the blanket contested-passage rejection; study chat keeps its `allowContestedRefs` exemption.** A seeded prompt that lands a reader in chat on a contested passage gets chat's exemption, and that is the correct behaviour — it is the whole reason the two surfaces differ.
- **Insights are global and carry no per-user content.** The handoff must not change that.
- **Global shared cache, explicit generate, public free reads, two grains, omission first-class** — parent decisions 4–9, unchanged.

---

## 1. The design question: how much of §8's seeded-prompt seam to build

Parent §8 names three context-passing seams and ends with one sentence — *"Every section footer carries 2–3 seeded prompts, scoped to that section"* — that hides most of the work. This section decides how much of it B4 builds, before any reader has pressed one.

### Where the three seams actually stand

| Seam | State | B4 |
|---|---|---|
| **Reader → Insights** | **Done.** `selectedVerse` reaches the overlay in both workspaces | — |
| **Insights → Chat** | Not started | **Built in full, both workspaces** |
| **Section → retrieval steering** | Not started | **Not built.** The prompt's own words already carry it (below) |

### Decision: build the whole transport, seed it thin, ship no steering

The split is between the half that is **expensive and knowable now** and the half that is **cheap and unknowable now**.

- The **transport** — a press in the overlay closing it, landing the reader in Chat on the right tab with an editable draft in the box, on desktop and on mobile — touches four pieces of component state across two workspaces (§2). It is why B2's D4 called this its own scope. Nothing about the feature can be learned until it exists, and it does not get cheaper by waiting.
- The **content** — how many prompts per section and what they say — is one registry file. It is the half that is impossible to get right blind and trivial to change once it isn't.

So: **the transport ships complete. The content ships at one prompt per section, eight in total, across the two generated doors.**

**Not 2–3 per section.** The count in §8 is prose, not a logged decision — decision 7 settles prefill-and-append and says nothing about quantity. Three per section is 12 buttons under a four-section document, which competes with the prose the door exists to deliver, and it is 24 strings written blind across both doors. One per section is still **eight doorways out of a surface that today has zero**, and it is the smallest thing that can teach us which sections readers actually want to leave from.

**And the learning is already instrumented.** `src/main.tsx` mounts `PostHogProvider` with `autocapture: true` app-wide (`src/lib/posthog.ts`), gated only on the project key being present in the deployed env. A seeded prompt is a `<button>` with distinctive text, so which prompts get pressed is captured without a line of new instrumentation. Widening to three per section later is an evidence-backed edit to one file, not a re-plumb.

### Why not generated seeded prompts

The alternative shape is a fifth field on each door's generation — a per-passage prompt written by the model alongside the section. Rejected:

- It is a prompt-module change on both doors, which means a `promptVersion` bump on each, a fresh live baseline for each, and eight cache rows going stale — the whole B3 gate, spent on a feature with no usage evidence.
- It buys specificity a template already gets most of the way to. "What would the first hearers of Psalm 27 have already known?" is not meaningfully worse than a generated variant, and it cannot hallucinate.
- B3's own note is the pointer: *"A seeded prompt per section is a field on the section view, not a new lookup table."* A field on the **client** view costs nothing, because the client already renders section by section from a registry.

### Why not seam 3 — section → retrieval steering

This is the one worth arguing rather than deferring by default.

**What seam 3 mechanically buys is a hard `registers` filter on study chat's library retrieval, chosen from the section.** That is the same knob that was *measured and rejected for Door 1 twice*, and adopted for Door 2 only after a five-fixture A/B (B3 §4). `registers` is a hard filter, not a bias: a filter that matches nothing yields no excerpts rather than falling back. Applying it to a **reader's own question** is strictly riskier than applying it to a door, because a door's subject is fixed and known and a reader's is not — the reader edits the draft before sending, which is the whole point of prefilling.

**And most of what it buys is already bought for free.** `buildStudyContext` uses the message as the retrieval query. A section-scoped seeded prompt *is* section-scoped text: "Where else in Scripture does this kind of writing appear?" embeds toward hermeneutical sources on its own, without a filter, without a contract change, and without the failure mode. **The section travels in the prompt.** An explicit `section` parameter adds only the hard filter on top.

**The cost side is a live surface.** Study chat has a checked-in baseline (`2026-08-07-study-display-refs`, 4/4). This repo's own rule, applied when `displayRefs` flipped, is that a **grounding** change bumps `prompt_version` even when the SYSTEM text does not — `study-chat` went v6→v7 for exactly that. So seam 3 is a version bump, a fresh live baseline, and a harness fixture shape that does not exist (study-chat fixtures have no section dimension), spent steering a path no reader has walked.

**And `eval-harness-discipline` closes it:** build the fixture before changing a live prompt. B4 cannot build that fixture honestly, because what it would measure — whether section steering improves the answer to a seeded prompt — needs seeded prompts in readers' hands first. Seam 3 is not deferred because it is hard. It is deferred because **B4 is the slice that produces the evidence it needs.**

### The same argument, applied to the verse

Study chat grounds at chapter granularity: `sendStudyMessage` takes `{ book, chapter, … }` and has no verse. `buildStudyContext` has had verse-scope support since B2, so threading a verse through is small — and it is the same kind of change as seam 3: a grounding change to a live surface, for a request shape nobody sends yet.

So a verse-scope handoff carries the verse **in the prompt's own words** — "What is the hardest thing to understand in Psalm 27:4?" — and the grounding stays chapter-shaped. The reader gets the question they meant; the surface keeps the baseline it has.

---

## 2. The transport: how a draft crosses from the overlay to the chat box

### Four pieces of state, in three components

A single press has to move all four:

| # | What | Where it lives today |
|---|---|---|
| 1 | Close the overlay | `insightsOpen` — workspace. **Exists** |
| 2 | *(mobile)* switch to the Study tab | `tab` — `MobileStudyWorkspace`. **Exists** |
| 3 | Switch the side panel to Chat | `tab` — `StudySidePanel`, local, no prop |
| 4 | Put the text in the chat box | `draft` — `LamplightStudyPanel`, local, no prop |

1 and 2 are already reachable from the workspace, which is where the door array is built. 3 and 4 are not reachable from anywhere.

### Decision: a one-shot handoff value, applied once by id

The workspace mints a `StudyHandoff` and drills it down the path `onOpenInsights` already takes. Each consumer applies it exactly once.

```ts
// src/notepad/study/insights/study-handoff.ts
export interface StudyHandoff {
  /** Monotonic. The same prompt pressed twice is two handoffs. */
  id: number;
  /** The prefilled draft. Never sent on its own. */
  text: string;
}
```

The consumer side is one shared hook, because getting it right twice by hand is how it drifts:

```ts
const seen = useRef(handoff?.id ?? 0);   // ← initialized to the CURRENT id
useEffect(() => {
  if (!handoff || handoff.id === seen.current) return;
  seen.current = handoff.id;
  apply(handoff);
}, [handoff]);
```

**`seen` is seeded with the current id on mount, not with 0**, and that one line is the whole correctness argument. On desktop the side panel unmounts when the reader collapses it (`sideMode === 'collapsed'`); re-expanding remounts `LamplightStudyPanel`. Seeded with 0, that remount would re-apply the last handoff and resurrect a draft the reader had deliberately cleared. Seeded with the current id, a remount applies nothing. It also makes the effect idempotent under StrictMode's double-invoke, so no "consume and clear" callback has to bounce back up to the workspace.

### Why not lift the draft to the workspace

Parent §8 says the mobile seam is *"shared draft state, not a remount."* That is a statement about **why it works** — the panes are `display`-toggled, so whatever draft is set survives the tab switch — not a prescription that `draft` must live at the workspace level.

Lifting it is the wrong trade: `draft` changes on every keystroke and the handoff fires once per press. Hoisting the high-frequency state to the top of a subtree that holds the reader and the apparatus rail makes the common case pay for the rare one, and it changes a live component's contract to carry a wire that fires seconds apart. The one-shot value keeps `draft` where it is.

### The payload is `{ id, text }` — and what is deliberately not in it

§8 describes the seam as carrying `{ text, scope, section }`. B4 carries neither of the other two, and each has a reason rather than an omission:

- **`scope`** — the panel is already grounded on it. Both the overlay and `StudySidePanel` read the same `passage` state in the same workspace, so `book`/`chapter` are identical by construction. The verse rides in the prompt's own text (§1).
- **`section`** — nothing in B4 consumes it. Seam 3 is not built, and PostHog identifies the pressed prompt by its button text anyway. A field with no reader is a field that goes stale without anything turning red.

If seam 3 is later built on measurement, `section` joins the payload then, next to the thing that reads it.

### The reopened-thread trap

`LamplightStudyPanel` grounds on `groundBook`/`groundChapter`, which come from its **selection**, not its props, whenever the reader has reopened a thread from history — and that thread may be on another passage entirely. A handoff applied in that state would ground the seeded prompt on the wrong chapter and append it to the wrong thread, quietly violating the one thing decision 7 settles.

So applying a handoff also does `setSelection({ mode: 'passage' })` and `setShowHistory(false)`. It is two lines and it is the failure this seam is most likely to ship with, because it only reproduces when the reader has been in history first.

### Focus

The input is focused, with the caret at the end. The seam's promise is that the reader is the author; a focused editable field says that, an unfocused one says "press send." On mobile this raises the keyboard over a bottom-docked input, which is ordinary chat behaviour rather than a regression — but it is on §4's browser list, because it is a claim about a phone and this document cannot make those.

---

## 3. Seeded prompts — content, and where they live

### One field on the client registry

`InsightSectionView` gains a prompt builder alongside `key` and `label`:

```ts
export interface InsightSectionView {
  key: string;            // the cache contract — must equal the server's
  label: string;          // presentation
  seededPrompt: (ref: InsightPromptRef) => string;   // B4
}
```

A **function**, not a template string with `{passage}` tokens: one of the eight wants the book name alone rather than the full reference, and a function gets that without inventing a mini-language and a parser to test. The registry stays as readable as it was.

`InsightPromptRef` carries the reader-form label the overlay already computes for its scope chip (`bookByAbbrev(book)?.name`), plus the book name, so "Psalm 27:4" and "Psalms" both come from one place and neither can print an OSIS code at a reader.

### The parity test boundary

`insight-doors.parity.test.ts` compares the client registry to the server's **on section keys and their order only** — verified against the test, not assumed. A client-only field is therefore safe by construction, which is exactly what the landmine note says. B4 adds one assertion in the same file: **every section in every registered door carries a seeded prompt**, so a Door 3 added later cannot ship a section with a footer that renders nothing.

Nothing about the server registry moves. Renaming or reordering a key remains the thing that must not happen.

### What a seeded prompt has to be

- **A question the section provokes, not the one it answered.** A footer prompt that restates its own section is a dead end dressed as a door.
- **In the reader's voice**, not an instruction to the model.
- **Answerable from the grounding study chat already has** — the apparatus, the cross-references, the library.
- **Section-scoped in its own words**, because those words are the retrieval query (§1).
- **Sound on a door the reader has not read**, since the prompt is on screen from the moment the door renders.

### The eight

| Door | Section | Seeded prompt |
|---|---|---|
| The Passage | Overview | *What is the hardest thing to understand in {passage}?* |
| | In the Chapter | *Why does {passage} come where it does?* |
| | The Chapter's Shape | *How does this chapter fit into the rest of {book}?* |
| | Reflection & Application | *How have Christians through history applied {passage}?* |
| Deeper In | How to Read This Passage | *Where else in Scripture does this kind of writing appear?* |
| | Historical & Cultural Setting | *What would the first hearers of {passage} have already known?* |
| | Theological Significance | *Do Christians read {passage} the same way?* |
| | Read With Care | *What is {passage} not saying?* |

*Do Christians read {passage} the same way?* is the one worth reading twice. On a contested chapter it lands a reader in the surface that holds `allowContestedRefs` — deliberately, and it is why the two surfaces differ. The door describes; the chat may say the question is disputed and name who disputes it. `TRADITION_TERMS` is scoped to `read_with_care` on the Deeper door and does not reach chat, so nothing here contradicts §9.

### Where the footer renders

`PassageDoor` already maps `door.sections` and renders nothing for an empty body. The footer follows the same rule: **an omitted section has no footer.** A prompt under a heading that isn't there would advertise a door into a room the grounding could not build.

Door 3 gets no seeded prompts in B4. Its sections are components rather than cached keys and have no `section` contract, so a footer there is a different plumbing path — cheap once the transport exists, and not on the critical path to learning anything.

---

## 4. Mobile parity — what is actually unproven

**Less remains than the parent design implies, and a different set of things than the handoff lists.** B3 already wired `MobileStudyWorkspace`: all three doors registered, `InsightsOverlay` rendered with `selectedVerse`, `canGenerateInsights` applied.

### What the mobile test does not assert

`MobileStudyWorkspace.test.tsx` **mocks `InsightsOverlay` entirely** (a `<div data-testid="insights-overlay">` with a close button). Its six Insights assertions cover the wiring — the overlay opens, receives `book`/`chapter`/`selectedVerse`, closes back to the Study tab, panes stay mounted. Every one is worth having and **none of them says anything about the overlay's behaviour**, because the real overlay never renders. The handoff's instruction to check what it asserts before trusting it was correct.

### The overlay covers the tab bar by construction

`InsightsOverlay` portals to `document.body` at `position: fixed; inset: 0; z-index: 1000`. The mobile workspace container is `position: fixed` with **no z-index** (so `auto`), and `StudyTabBar` sits in normal flow inside it. A body-level portal at 1000 paints above an `auto` sibling. So this is a property of the code, not a thing to hope for — the browser check confirms it rather than discovers it.

### Safe areas are a real, code-visible gap

`StudyTabBar` pads `env(safe-area-inset-bottom)`. `InsightsOverlay` pads a flat `10px 16px` on its header and `20px 16px 48px` on its scroll container, with no safe-area inset anywhere. On a device with a home indicator or a notch, the overlay's header can sit under the status bar and its last section under the indicator — on the one surface in the app that is deliberately full-bleed. This is B4's to close, and it is a stylesheet change, not a redesign.

### Touch targets and a 360px header

- The close ✕ is 28×28. The "All insights" back control is 12px text with `4px 8px` padding. Both are below a 44px touch target, on the two controls that get a reader *out* of a full-screen surface.
- The header lays out `[back] [scope + chapter toggle] [spacer] [✕]` as a single flex row with `gap: 10`. At 360px with a long book name ("2 Thessalonians 3"), a "Whole chapter" toggle and an "All insights" back control, it has three text runs and no wrapping rule. This wants checking at a real narrow viewport, not reasoning about.
- "Study this passage" is `10px 18px` — about 40px tall. Marginal on the door's primary action.

### The handoff's mobile path

One press does three things: close the overlay, switch the workspace tab to Study, switch the side panel to Chat — and the draft is there because the panes are `display`-toggled and never unmounted. That is the seam parent §8 describes, and it is the mobile assertion worth pinning in a test rather than in prose.

### What B4 does not do: the system back gesture

Parent §2 asks for a "route-like overlay … with a back affordance." B4 gives it a **touch-sized in-overlay** back affordance and does **not** bind the Android/browser back gesture. The repo has no `popstate` overlay pattern to follow — the only history handling is `src/transitions/route-transition.ts` — so pushing a history entry on open means designing double-push-on-remount, back-after-close, and the interaction with `useRouteTransition` from scratch. That is its own slice, and it applies equally to `RegionMapFullscreen`, which has the same shape and the same gap. Named rather than smuggled in.

---

## 5. The rename — twice the size the handoff says, with a live wire through it

The handoff names `lamplight-study/index.ts` (eight sites), `prompts/study-insight.ts`, `study-chat-client.ts` and `LamplightStudyPanel.tsx`. Checked against the code, that is **half the sites**, and the missing half is the half that can break a reader.

### The shared type is why it cannot stop at Study

`streamBibleChat` — in `lamplight-chat/bible-chat-stream.ts` — takes `args: { mode: 'chat' | 'insight'; … }`, and **both** `lamplight-study/index.ts` and `lamplight-chat/index.ts` call it. `lamplight-chat` carries the same mode through roughly ten sites of its own, plus `BIBLE_INSIGHT_PROMPT`.

There is no half-rename that typechecks. Renaming only the Study side leaves `streamBibleChat` either still saying `'insight'` (so Study passes a value the type rejects) or widened to three values, which is worse than both. **The rename is repo-wide across both chat surfaces, or it is not done** — and that is the right answer anyway, because the collision §10 exists to clear is on the journaling surface too.

### ⚠️ The journaling opener is a LIVE wire

`requestStudyInsight` is parked — `LamplightStudyPanel` holds a bare `void requestStudyInsight;` and nothing calls it. **Its journaling twin is not.** `requestOpeningInsight` is called from `LamplightChat.tsx` on every passage open, and it POSTs `{ book, chapter, mode: 'insight' }` with **no message**.

`lamplight-chat/index.ts` reads `body.mode === 'insight' ? 'insight' : 'chat'` and then rejects a chat-mode request with an empty message: `400 bad payload`. So a client that ships `mode: 'opener'` to a function that has not been redeployed **breaks the opening reflection for every reader, on every passage open**, with a 400.

Two rules follow, and they are the load-bearing part of this section:

1. **The wire accepts both spellings.** Both parsers map `'opener'` *and* `'insight'` to the internal `'opener'`. The old spelling stays accepted — cost, one `||`; benefit, no deploy-ordering window at all.
2. **The functions deploy before the client ships.** `supabase functions deploy lamplight-chat` and `lamplight-study` are two hand-run commands in this repo, released independently of the app bundle. With rule 1 the order is belt and braces rather than the only thing standing between a rename and a broken surface — which is precisely why rule 1 exists.

### `prompt_version` strings do not move

`study-insight-2026-08-06-v5` and `bible-insight-2026-06-10-v3` are **stored values** — they stamp `lamplight_usage` rows and identify which prompt produced what. Renaming the module does not change a byte the model sees, so bumping them would assert a change that did not happen and orphan the history that reads them.

They stay verbatim, including the word "insight" inside them. The identifier is renamed; the version string it carries is data.

### The byte gate

The handoff's instruction — *"a rename that changes no emitted bytes should not bump that version — see how B3 proved Door 1 unchanged"* — becomes the same mechanism B3 used. Before any renaming, a checked-in fixture pins `STUDY_INSIGHT_PROMPT.system`, its serialized tool, and its `promptVersion`; same for `BIBLE_INSIGHT_PROMPT`. After, byte-identical. B3's gate caught a seven-character drift on its first run in exactly this situation, and every other test in that directory stayed green through it, because they assert that a prompt *says* things rather than what it says.

Two adjacent things get the same treatment, because they are what a careless mode rename would move without changing a string:

- `STUDY_EFFORT`, `STUDY_MAX_TOKENS` and `LIBRARY_K` are keyed **by mode**. Their values per mode must be identical after the key is renamed — `LIBRARY_K.opener === 2` is the difference between the opener's grounding and study chat's.
- `allowContestedRefs` stays `true` on both opener prompts and absent on both doors'.

**Nothing persists `mode`.** No migration, no column, no stored string — checked. The rename is wire and code only, which is what makes a byte gate a sufficient proof rather than a partial one.

### `requestStudyInsight` stays parked

Parent Scope/In pairs the rename with "un-park `requestStudyInsight`". B4 renames it to `requestStudyOpener` and **leaves it parked**, because un-parking it is a product decision rather than a rename: it fires an unprompted, per-reader, per-open generation that answers *"what is going on in this passage?"* — which is now Door 1's question, answered once and cached globally for everyone. Putting a billed-per-open opener next to a shared cached door is a call for Myles, not a consequence of clearing a name. Neither parent §12's B4 line nor the handoff asks for it.

---

## 6. Eval and verification

### B4 adds no new generated-door fixtures, and that is a decision

Parent §12 lists "eval fixtures" under B4. B4 declines it, with a reason: **B4 changes no prompt that produces door prose and no grounding that feeds one.** The seeded prompts are client strings; the handoff is client state; the rename is proved by byte identity. A fixture added by a slice that changed nothing measures nothing new, and each live door fixture costs a real ~$0.066 sweep.

What parent §11 genuinely still lacks — a superscription fixture, a disputed-authorship fixture (Hebrews, 2 Peter, Daniel, Isaiah), a genre-extreme fixture (genealogy, legal code, one-line proverb) — is real and is **its own slice**, named here rather than half-done. The nine existing fixtures cover dense psalm, verse grain, thin OT chapter, contested chapter and denominational bait.

The rename's proof is the byte gate (§5). The handoff's proof is unit tests over the transport, plus the browser checks below.

### The two inherited live checks — do these first

Runbook §5 has two open rows and the handoff is right that both are B4's, and right that doing them first de-risks everything built on top. Both need a browser and an authenticated Plus/promo session; runbook §6 is the procedure.

- **Door 2 has never generated through the deployed function.** The eval drives `runPassageInsightPipeline` directly, so the whole edge path for `door=deeper` — quota bucket, entitlement, streaming, cache write on the terminal beat — is unproven. Warming one real Door 2 door closes it and gives the first true cost figure against the **$0.066/door** the fixtures measured.
- **An interrupted generation leaving the door uncached.** Unit-tested only, and easier now than at B2: there are real rows to diff against.

They also give the handoff seam something to hand off *from*. Eight cache rows on one book is a thin surface on which to check that a section footer looks right.

### New browser checks B4 owes

On a real phone viewport, signed in: the overlay covers the tab bar with no bleed-through; header and last section clear the notch and the home indicator; the header does not overflow at 360px on a long book name; a seeded prompt closes the overlay, lands on Study → Chat with the draft present and editable, and the keyboard does not hide it; Send appends to the passage's existing thread rather than opening a new one.

---

## 7. Sequencing

1. **The two inherited live checks** (§6) — first, because they are the only thing that proves the surface B4 decorates.
2. **The handoff value and its consumer hook** — `study-handoff.ts`, tests first, including the remount guard and the reopened-thread reset.
3. **Wire it through `StudySidePanel` and `LamplightStudyPanel`** — tab switch and draft application, with the selection reset.
4. **Wire it through both workspaces** — desktop closes the overlay; mobile closes it and switches tab. `DoorDeps` gains the handler.
5. **Seeded prompts in the client registry** + the footer in `PassageDoor`, omitted sections included. Parity test gains its one assertion.
6. **Mobile parity** — safe areas, touch targets, the narrow header.
7. **The rename, under the byte gate** — fixture and gate committed *first*, on their own, so the history shows they existed before the rename. Then both prompt modules, both parsers (accepting both spellings), both edge shells, both stream types, both clients.
8. **Deploy `lamplight-chat` and `lamplight-study`**, re-verify boot on both, *then* the client.
9. **Runbook + doc updates**; make `passageDoor` read its label and blurb from the registry, so open item 1's naming pass is one file.

Steps 2–6 are client-only and independently verifiable. Step 7 is the only one that touches a deployed surface, and step 8 is why it is last.

---

## 8. What B4 deliberately does not do

- **No section → retrieval steering** (§1). The section travels in the prompt's words; the hard filter waits for evidence B4 is the slice that produces.
- **No generated seeded prompts** — a prompt-module change on both doors, for specificity a template mostly already has.
- **No verse-grain grounding for study chat.** Same argument as steering; the verse rides in the prompt text.
- **No system back gesture binding** (§4). No `popstate` overlay pattern exists to follow, and it applies equally to `RegionMapFullscreen`.
- **No un-parking of the opener** (§5) — a Myles call, and one that now overlaps Door 1.
- **No door names pass.** Still open item 1, still a Myles call; B4 makes it a one-file edit.
- **No Door 3 footers** — different plumbing, no section contract, not on the path to learning anything.
- **No new generated-door eval fixtures** (§6). Parent §11's remaining hazard cases are their own slice.
- **No `prompt_version` bumps.** If one moves, the rename was not a rename.

## 9. Watch items carried in

Recorded because B4 rides them and would inherit any breakage:

- **`hasAccess` short-circuits on the global promo before it considers who is asking.** `canGenerateInsights` fixes it for the doors; the same pattern is in every other `hasAccess` call site. The handoff seam adds no new entitlement gate — a seeded prompt is a draft, and the send path is study chat's own gate — but nothing here should be built on `hasAccess` directly.
- **A generation outlives what it was started for.** `usePassageInsight` carries an id + AbortController because the overlay's scope toggle changes `scope` without unmounting. The handoff's id-based application is the same lesson in a different shape: **a low-frequency event delivered through state needs an identity, or it fires at the wrong time.**
- **Door 1 names no voice on some passages** (3 of 4 fixtures name one; `passage-psalm-27-v4` names none). Measured, not gated; cause not isolated. Untouched by B4.
- **Read With Care's §9 rule fails the whole door** rather than dropping the section. Repair-by-deletion still deferred pending a measured violation rate.
- **The A1 anchor-channel limit carries** — rows ordered by verse, so truncating a flooding source drops the chapter's tail. The real fix pushes the verse-overlap filter into SQL.

---

*Prepared 2026-08-07. Parent: `2026-08-06-study-insights-design.md`. Builds on #112 (B1), #115 (B2), #117 (A1), #118 (B3), #120, #121.*
