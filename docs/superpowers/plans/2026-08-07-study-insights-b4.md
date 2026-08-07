# Study Insights B4 — the handoff seam, mobile parity, and the `opener` rename, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader who has just read a section can carry a question about it into study chat — prefilled, unsent, appended to the passage's existing thread — on desktop and on a phone; the overlay behaves like a destination on a phone; and `mode: 'insight'` stops colliding with the feature called Insights. Design: `docs/superpowers/specs/2026-08-07-study-insights-b4-design.md`.

**Architecture:** The handoff is a **one-shot value drilled down the path `onOpenInsights` already takes**, applied exactly once by id — not lifted draft state, not a context. Seeded prompts are **client registry data**, one per section, eight in total. The rename is **repo-wide across both chat surfaces**, under a byte-identity gate, with both spellings accepted on the wire.

**Tech Stack:** React + TypeScript client · Supabase Edge Functions (Deno) for the rename's server half · vitest throughout.

## Global Constraints

_Every task's requirements implicitly include this section._

- **The handoff prefills and NEVER auto-sends.** Settled (parent decision 7). Nothing in this plan calls `send()`.
- **It appends to the passage's existing thread.** Which means applying a handoff must reset `LamplightStudyPanel`'s selection to `{ mode: 'passage' }` — see Task 3. A reopened history thread grounds on its own book/chapter.
- **No `prompt_version` moves.** If one does, the rename was not a rename. Task 7's byte gate is what makes that a test rather than a review.
- **The wire accepts BOTH `'opener'` and `'insight'`.** `requestOpeningInsight` is a live wire on every journaling passage open; a client that sends `'opener'` to a stale function gets `400 bad payload`. Deploy before the client ships anyway — the tolerance is belt and braces, not a licence to skip the ordering.
- **Cross-references stay shown, never explained.** Unchanged by B4.
- **Insights stay global and carry no per-user content.** Seeded prompts are composed client-side from a cached public door.
- **Section keys and their order do not move.** `insight-doors.parity.test.ts` is load-bearing; a client-only field is safe, a key rename is not.
- **TDD.** Write the failing test first; watch it fail; implement minimally; watch it pass; commit per task.
- **Branch:** `feat/study-insights-b4`, cut from `main`. Repo squash-merges.
- **Completion gate:** `npx tsc -b` clean · `npx vitest run` green (**4,171** at plan time) · `npx eslint .` at its **163-problem baseline**, not zero. `tsc -b` now covers `src`, `scripts` and every `supabase/functions` module including the Deno shells (#119), so the hand-run `tsc --noEmit` steps earlier slices prescribed are retired.
- **Do not trust numbers quoted in prose — check them against the code.** It has already caught a "1.6–2×" ratio, a "0 rows" corpus claim, and a "six type errors" measurement. **It caught two more while designing B4** — see below.

---

## ⚠️ Read before starting

**1. The handoff doc undercounts the rename by half, and the missing half is live.**

The handoff names `lamplight-study/index.ts`, `prompts/study-insight.ts`, `study-chat-client.ts` and `LamplightStudyPanel.tsx`. Checked against the code:

- `streamBibleChat` (`lamplight-chat/bible-chat-stream.ts`) takes `mode: 'chat' | 'insight'` and is called by **both** `lamplight-study/index.ts` and `lamplight-chat/index.ts`. One type, two surfaces — there is no half-rename that typechecks.
- `lamplight-chat/index.ts` carries the same mode through ~10 sites of its own, plus `BIBLE_INSIGHT_PROMPT`.
- **`requestOpeningInsight` is LIVE.** Called from `LamplightChat.tsx` on every journaling passage open, POSTing `{ book, chapter, mode: 'insight' }` with no message. `lamplight-chat/index.ts:52` reads `body.mode === 'insight' ? 'insight' : 'chat'`, and `:64` rejects chat-mode with an empty message → **`400 bad payload`**. A client shipping `'opener'` against a stale function breaks the opening reflection for every reader.

Its Study twin `requestStudyInsight` is genuinely parked (`LamplightStudyPanel.tsx:232` is a bare `void`), which is probably why the handoff read the whole mode as dormant. It is not.

**2. `MobileStudyWorkspace.test.tsx` mocks `InsightsOverlay` entirely.** Its six Insights assertions cover the wiring — opens, receives `book`/`chapter`/`selectedVerse`, closes back to the Study tab, panes stay mounted. All worth having; none says anything about the overlay's behaviour, because the real overlay never renders. The handoff's instruction to check before trusting it was right.

**3. The overlay covers the tab bar by construction, not by luck.** It portals to `document.body` at `position: fixed; inset: 0; z-index: 1000`; the mobile workspace container is `position: fixed` with no z-index (`auto`) and `StudyTabBar` is in its normal flow. The browser check confirms this rather than discovering it. What is *not* handled anywhere in the overlay is `env(safe-area-inset-*)` — Task 6.

**4. Do the two inherited live checks first.** Door 2 has never generated through the deployed function, and an interrupted generation has never been observed. Both need a browser and a Plus/promo session; runbook §6 is the procedure. They also give the seam something to hand off *from* — eight rows on one book is thin ground for checking a section footer.

---

## File Structure

**New (client):**
- `src/notepad/study/insights/study-handoff.ts` — the `StudyHandoff` value, the mint hook, and the apply-once hook (Task 2).
- `src/notepad/study/insights/study-handoff.test.ts` — remount guard, double-apply guard, id monotonicity (Task 2).
- `src/notepad/study/insights/SectionFooter.tsx` — the seeded-prompt footer (Task 5).

**New (server):**
- `supabase/functions/lamplight-study/prompts/__fixtures__/study-opener-v5.json` and
  `supabase/functions/lamplight-chat/prompts/__fixtures__/bible-opener-v3.json` — byte-identity fixtures (Task 7).
- `…/prompts/opener-bytes.test.ts` in each — the gate (Task 7).

**Modified (client):**
- `insights/insight-doors.ts` — `seededPrompt` on `InsightSectionView`, `InsightPromptRef` (Task 4).
- `insights/insight-doors.parity.test.ts` — one added assertion (Task 4).
- `insights/PassageDoor.tsx` — renders the footer per non-empty section (Task 5).
- `insights/doors.tsx` — `DoorDeps.onHandoff`; `passageDoor` reads label/blurb from the registry (Tasks 5, 9).
- `panes/StudySidePanel.tsx` — applies a handoff by switching to Chat (Task 3).
- `panes/LamplightStudyPanel.tsx` — applies a handoff: draft, selection reset, focus (Task 3).
- `StudyWorkspace.tsx`, `mobile/MobileStudyWorkspace.tsx` — mint and route (Task 4).
- `study-chat-client.ts` — `requestStudyInsight` → `requestStudyOpener`, still parked (Task 8).
- `study-stream-client.ts`, `bible/lamplight-chat-client.ts` — mode type + the sent value (Task 8).

**Modified (server):**
- `lamplight-study/parse-body.ts`, `lamplight-study/index.ts` — mode rename, both spellings accepted (Task 7).
- `lamplight-chat/index.ts`, `lamplight-chat/bible-chat-stream.ts` — the same (Task 7).
- `lamplight-study/prompts/study-insight.ts` → `study-opener.ts`; `lamplight-chat/prompts/bible-insight.ts` → `bible-opener.ts`. **`promptVersion` strings unchanged, verbatim** (Task 7).

**Modified (docs):**
- `docs/runbooks/passage-insight.md` — the live checks, the newly warmed passages (Tasks 1, 10).

---

## Task 1 — The two inherited live checks

- [ ] Warm one real **Door 2** door through the deployed function, signed in as Plus/promo. Runbook §6 steps 8–10.
- [ ] Confirm eight rows for that `ref_id`, four per `door`, and record the true cost against the fixtures' **$0.066/door**.
- [ ] Start a generation and interrupt it (close the overlay / kill the tab). Re-query: **zero** rows for that door, and reopening offers *Study this passage* again.
- [ ] Record both in `docs/runbooks/passage-insight.md` §5 and §6.

**Requirements:** human-only — a browser and an authenticated session. Doing these first means the seam is built on a surface known to work end to end rather than one assumed to.

## Task 2 — The handoff value

- [ ] Failing test: two presses mint two handoffs with different ids.
- [ ] Failing test: a consumer applies a handoff exactly once, and **not again on re-render**.
- [ ] Failing test: **a consumer mounted with a handoff already present applies nothing.** `seen` is seeded with the current id, not 0 — this is the desktop collapse/re-expand case, where a remount would otherwise resurrect a draft the reader cleared.
- [ ] Failing test: applying is idempotent under a double-invoked effect (StrictMode).
- [ ] Implement `StudyHandoff { id, text }`, `useStudyHandoff()`, `useApplyHandoff(handoff, apply)`.

**Requirements:** the payload is `{ id, text }` and nothing else. `scope` is omitted because the panel is already grounded on the same `passage` state the overlay is; `section` is omitted because nothing in B4 consumes it (design §1, §2). A field with no reader goes stale without anything turning red.

## Task 3 — The chat side: tab, draft, selection

- [ ] Failing test: `StudySidePanel` given a handoff switches its own tab to Chat.
- [ ] Failing test: `LamplightStudyPanel` given a handoff puts the text in the draft input, **and does not send it**.
- [ ] Failing test: **a handoff applied while a history thread is open resets the selection to the passage** — the seeded prompt must ground on the reader's chapter and append to that chapter's thread, not the reopened one.
- [ ] Failing test: a handoff closes the history list if it is showing.
- [ ] Failing test: the input is focused with the caret at the end.
- [ ] Failing test: the reader can edit the draft and the edit survives; a second handoff replaces it.
- [ ] Implement both, using `useApplyHandoff`.

**Requirements:** the selection reset is the failure this seam is most likely to ship with, because it only reproduces when the reader has been in history first. It is two lines and it is the one thing decision 7 actually settles.

## Task 4 — Minting and routing, both workspaces

- [ ] Failing test (desktop): pressing a seeded prompt closes the overlay and the draft reaches the chat panel.
- [ ] Failing test (mobile): the same press **also switches the workspace tab to Study**, and the panes stay mounted so the draft survives.
- [ ] `DoorDeps` gains `onHandoff?: (text: string) => void`; both workspaces pass one built from `useStudyHandoff`.
- [ ] Add `seededPrompt` to `InsightSectionView` and `InsightPromptRef` to the client registry, with the eight prompts from design §3.
- [ ] Failing test in `insight-doors.parity.test.ts`: **every section of every registered door carries a seeded prompt** — so a later door cannot ship a footer that renders nothing.
- [ ] Failing test: a seeded prompt renders the passage in **reader form** (`Psalm 27:4`, `Psalms`), never an OSIS code.

**Requirements:** the parity test compares section **keys and order only** — verified against the test, not assumed — so a client-only field is safe by construction. Do not touch the server registry.

## Task 5 — The footer

- [ ] Failing test: a rendered section shows its seeded prompt as a button beneath its body.
- [ ] Failing test: **an omitted (empty) section renders no footer** — no heading, no prompt. A door into a room the grounding could not build.
- [ ] Failing test: pressing it calls `onHandoff` with the composed text and nothing else.
- [ ] Failing test: with no `onHandoff` supplied, no footer renders at all (the door is reachable from contexts that cannot hand off).
- [ ] Implement `SectionFooter`; thread `onHandoff` through `PassageDoor` and both `doors.tsx` entries.

**Requirements:** one prompt per section, eight in total, generated doors only. Door 3's sections are components with no `section` contract — a different plumbing path, deliberately not in B4 (design §3).

## Task 6 — Mobile parity

- [ ] `env(safe-area-inset-top)` on the overlay header and `env(safe-area-inset-bottom)` on its scroll container. `StudyTabBar` already does this; the one full-bleed surface in the app does not.
- [ ] Close ✕ and the "All insights" back control to a 44px touch target, without changing the desktop's visual weight.
- [ ] The header must not overflow at 360px with a long book name plus the chapter toggle plus the back control.
- [ ] Failing test: `MobileStudyWorkspace` renders the **real** `InsightsOverlay` (not the mock) at least once, asserting the door chooser is reachable and the close control returns to the Study tab.
- [ ] Browser checks on a real phone viewport: overlay covers the tab bar with no bleed-through; header and last section clear the notch and home indicator; a seeded prompt lands on Study → Chat with the draft present, editable, and not hidden by the keyboard.

**Requirements:** the overlay covering the tab bar is a property of the code (design §4) — confirm it, do not re-engineer it. **No system back gesture binding**: no `popstate` overlay pattern exists in the repo to follow, it interacts with `useRouteTransition`, and it applies equally to `RegionMapFullscreen`. Its own slice.

## Task 7 — The rename, under a byte gate

- [ ] **Failing test FIRST, before any renaming, committed on its own:** `STUDY_INSIGHT_PROMPT.system`, `JSON.stringify(tool)` and `promptVersion` equal a checked-in fixture. Same for `BIBLE_INSIGHT_PROMPT`. Capture the fixtures from the current code. **These must pass before and after every commit in this task.**
- [ ] Failing test: `STUDY_EFFORT`, `STUDY_MAX_TOKENS` and `LIBRARY_K` hold the same values per mode after the key is renamed — `LIBRARY_K.opener === 2` is the difference between the opener's grounding and study chat's.
- [ ] Failing test: both parsers map **`'opener'` and `'insight'`** to the internal `'opener'`, and anything else to `'chat'`.
- [ ] Failing test: `allowContestedRefs` stays `true` on both opener prompts and absent on both doors'.
- [ ] Rename: `mode` union and comparisons in `lamplight-study/index.ts`, `lamplight-chat/index.ts`, `bible-chat-stream.ts`, both `parse-body`/inline parsers; `STUDY_INSIGHT_PROMPT` → `STUDY_OPENER_PROMPT` (`prompts/study-opener.ts`), `BIBLE_INSIGHT_PROMPT` → `BIBLE_OPENER_PROMPT` (`prompts/bible-opener.ts`).
- [ ] **`promptVersion` strings stay verbatim** — `study-insight-2026-08-06-v5`, `bible-insight-2026-06-10-v3`. They stamp `lamplight_usage` rows; the identifier is renamed, the version string is data.

**Requirements:** if the byte gate fails there are exactly two correct responses — revert, or bump the version *and* re-baseline *and* regenerate the fixture in the same commit. Regenerating it alone to make the red go away is the one response that is always wrong. B3's gate caught a seven-character drift on its first run in exactly this situation.

## Task 8 — The client half of the rename

- [ ] `requestStudyInsight` → `requestStudyOpener`, **still parked**. Un-parking is a Myles call and now overlaps Door 1 (design §5).
- [ ] `requestOpeningInsight` keeps its name (it is already the right one) and sends `mode: 'opener'`.
- [ ] `mode?: 'chat' | 'insight'` → `'chat' | 'opener'` in `study-stream-client.ts`.
- [ ] Update the client tests that assert the sent body.

**Requirements:** **this task ships after Task 11's deploy, not before.** The wire tolerates both spellings, so the ordering is belt and braces — which is exactly why it is cheap to honour.

## Task 9 — Registry tidy for the naming pass

- [ ] `passageDoor` reads `label` and `blurb` from `PASSAGE_DOOR_VIEW`, as `deeperDoor` already does from `DEEPER_DOOR_VIEW`.
- [ ] Failing test: the door registered in `doors.tsx` carries the registry's label and blurb.

**Requirements:** open item 1 (door names in the app's voice) stays a Myles call. This makes it a one-file edit rather than a hunt.

## Task 10 — Runbook and docs

- [ ] Runbook §5: the two inherited rows closed, with dates.
- [ ] Runbook §6: the newly warmed Door 2 passage recorded alongside the two Leviticus 1 doors.
- [ ] Runbook §7: a note that `mode: 'opener'` is the wire value and `'insight'` is still accepted.

## Task 11 — Completion gate

- [ ] `npx tsc -b` clean · `npx eslint .` at its **163-problem baseline** · `npx vitest run` green (**4,171** at plan time).
- [ ] **Deploy `lamplight-chat` AND `lamplight-study`.** Both change; both must ship before the client. Re-verify boot on each: 401 unauthenticated, 400 on a bad body.
- [ ] Boot check the wire tolerance explicitly — `mode: 'insight'` and `mode: 'opener'` must behave identically, and a bad mode must fall through to `chat`.
- [ ] Only then ship Task 8's client half.
- [ ] The browser checks from Task 6.

---

## What B4 deliberately does not do

- **No section → retrieval steering.** The section travels in the seeded prompt's own words, which are already the retrieval query; the hard `registers` filter waits for the evidence B4 is the slice that produces (design §1).
- **No generated seeded prompts** — a prompt-module change on both doors for specificity a template mostly already has.
- **No verse-grain grounding for study chat.** Same argument; the verse rides in the prompt text.
- **No system back gesture binding.**
- **No un-parking of the opener.**
- **No door names pass.**
- **No Door 3 footers.**
- **No new generated-door eval fixtures.** Parent §11's remaining hazard cases — superscriptions, disputed authorship, genre extremes — are their own slice.
- **No `prompt_version` bumps.**

## Follow-ups this plan may surface

- **Parent §11's remaining eval fixtures** (superscription, disputed authorship, genre extreme). Named in design §6.
- **A `popstate` overlay pattern**, shared by `InsightsOverlay` and `RegionMapFullscreen`.
- **Seeded prompts on Door 3**, once the transport exists.
- **Widening to 2–3 prompts per section**, on PostHog evidence rather than on §8's prose.
- **`hasAccess`'s promo short-circuit** is still in every other call site (#120 fixed it only for the doors).

---

*Prepared 2026-08-07. Design: `docs/superpowers/specs/2026-08-07-study-insights-b4-design.md`. Builds on #112 (B1), #115 (B2), #117 (A1), #118 (B3), #120, #121.*
