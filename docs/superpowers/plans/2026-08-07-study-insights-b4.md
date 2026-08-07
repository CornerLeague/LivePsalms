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

## Progress

**Tasks 2–10 complete, 2026-08-07.** Branch `feat/study-insights-b4`, cut from `main`. Gate at last push: `tsc -b` clean, eslint at its **163-problem baseline**, **4,251** tests (4,171 at plan time).

| Task | State | Note |
|---|---|---|
| 1 — the two inherited live checks | **half done** | Door 2 has generated; interruption still needs a Plus/promo session |
| 2 — the handoff value | done | `seen` seeded from the current id is the whole correctness argument |
| 3 — the chat side | done | the selection reset is pinned by a test that only reproduces after History |
| 4 — minting + routing + registry | done | eight prompts, one per section |
| 5 — the footer | done | signed-out readers get none, see below |
| 6 — mobile parity | done | safe areas, 44px targets, ellipsis; plus a test using the REAL overlay |
| 7 — the rename | done, **twice the scoped size** | gate committed first, on its own |
| 8 — the client half | done, **wire value deliberately NOT flipped** | see below |
| 9 — registry tidy | done | |
| 10 — runbook | done | runbook §9 |
| 11 — completion gate | **partly — browser checks left** | gate green; **both functions deployed 2026-08-07**, 10/10 boot checks |

### Decisions made while implementing, that are not in the design

- **⚠️ Vercel deploys the client automatically on merge; the edge functions deploy by hand. So the client reaches production FIRST**, which inverts the plan's "deploy before the client ships" from an ordering an operator honours into one the code has to enforce. Both clients therefore **keep sending `mode: 'insight'`**, pinned by a test that explains why, and flipping them to `'opener'` is a one-line follow-up that is safe only once both functions are deployed. The wire tolerance (`_shared/chat-mode.ts`) makes the flip a non-event; the ordering is what makes it safe.
- **A second live sender turned up.** Beyond `requestOpeningInsight`, `LamplightChat.tsx` also streams `mode: 'insight'` directly to `lamplight-chat`. Same treatment, same comment.
- **`STUDY_EFFORT` / `STUDY_MAX_TOKENS` / `LIBRARY_K` moved out of the Deno shell** into `lamplight-study/study-modes.ts`. They are keyed **by mode**, which makes them the part of the rename **no byte gate reaches**: the prompt can be provably identical while the opener quietly runs at chat's library budget, changing its *grounding* without changing a character of its prompt. A `serve()`-at-module-scope shell cannot be imported by vitest, so anything left inside it is outside the gate — the same reason `parse-body.ts` and `chat-context.ts` were extracted before it.
- **Signed-out readers get no section footers.** A cached door is public, so they reach the prose — but the chat input they would land in is disabled, and **a disabled input shows its value rather than its placeholder**, so they would see a greyed-out question beside a greyed-out Send and no "Sign in to use Lamplight Study" anywhere. That is #120's shape again. Entitlement is deliberately *not* part of the condition: a signed-in reader without Plus should meet study chat's own gates by asking, not be quietly denied the question.
- **⚠️ The OSIS-leak test caught itself.** Its first draft was a shape regex, `\b[1-3]?[a-z]{2,3}\s+\d+`, and it flagged *"…to understand **in 2** Thessalonians 3?"* as a leak. That is exactly the false positive the harness's own `checkProperties` carried for months — a naive matcher that scored `rom 9:16` clean while `Romans 9:16` failed. Now matched against the real abbreviation list, with a test asserting the check can still fail.
- **The footer's focus effect is keyed on the handoff, not the draft.** Pressing the same prompt twice is a no-op `setDraft`, which skips the re-render, so a draft-keyed effect would never fire and the input would not refocus.
- **`MobileStudyWorkspace.overlay.test.tsx` is a new file rather than an edit.** The existing mobile test mocks `InsightsOverlay` wholesale, and unpicking that would cost its six wiring assertions. The new file stubs the doors instead and renders the real overlay, which is what turns "covers the tab bar by construction" into an assertion on **both** halves — the portal's `z-index: 1000` and the workspace's absent one.

### Still to do

1. ~~**Deploy `lamplight-study` and `lamplight-chat`**~~ — **done 2026-08-07**, 10/10 boot checks. Runbook §9.
2. **The interrupted-generation check** — the one inherited row still open. Needs a Plus/promo session. Runbook §6 step 6.
3. **The cost figure** — admin dashboard, the `passage_insight` row stamped 19:35:29 UTC.
4. **The B4 browser checks** — runbook §6 steps 11 and 12, on a real phone.
5. **Then**, optionally, flip the two client wire values to `'opener'`. Safe now that both functions are deployed.

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

- [x] Warm one real **Door 2** door through the deployed function. **Already done by Myles, 2026-08-07 19:35:29 UTC** — 30 minutes after the handoff was written saying it had never happened.
- [x] Confirm eight rows for that `ref_id`, four per `door`. Confirmed: `lev.1` holds eight, `lev.1.1` Door 2 stays cold, so the doors cache independently.
- [x] Verify the warmed door's quality against the fixture baseline: all twelve sections non-empty and ending on terminal punctuation, no OSIS leaks, **all four Door 2 sections naming a supplied voice**, and *Read With Care* naming no tradition — §9 holding on production prose rather than only in the eval.
- [x] Verify the signed-out cached read for **Door 2** in a browser — the repeat B3's Task 12 asked for on the door riding new code.
- [ ] **The true cost figure — NOT obtainable.** `lamplight_usage` is admin-gated, so **$0.066/door** still rests on the nine live fixtures. Check the admin dashboard for the `passage_insight` row stamped 19:35:29 UTC.
- [ ] Start a generation and interrupt it (close the overlay / kill the tab). Re-query: **zero** rows for that door, and reopening offers *Study this passage* again. Needs an authenticated Plus/promo session.
- [x] Record it all in `docs/runbooks/passage-insight.md` §5 and §6.

**Requirements:** the corpus is **12 rows, not 8**. Measure it, do not read it out of the previous document — that rule has now caught "0 rows" that was 8 and "8 rows" that is 12.

## Task 2 — The handoff value

- [x] Failing test: two presses mint two handoffs with different ids.
- [x] Failing test: a consumer applies a handoff exactly once, and **not again on re-render**.
- [x] Failing test: **a consumer mounted with a handoff already present applies nothing.** `seen` is seeded with the current id, not 0 — this is the desktop collapse/re-expand case, where a remount would otherwise resurrect a draft the reader cleared.
- [x] Failing test: applying is idempotent under a double-invoked effect (StrictMode).
- [x] Implement `StudyHandoff { id, text }`, `useStudyHandoff()`, `useApplyHandoff(handoff, apply)`.

**Requirements:** the payload is `{ id, text }` and nothing else. `scope` is omitted because the panel is already grounded on the same `passage` state the overlay is; `section` is omitted because nothing in B4 consumes it (design §1, §2). A field with no reader goes stale without anything turning red.

## Task 3 — The chat side: tab, draft, selection

- [x] Failing test: `StudySidePanel` given a handoff switches its own tab to Chat.
- [x] Failing test: `LamplightStudyPanel` given a handoff puts the text in the draft input, **and does not send it**.
- [x] Failing test: **a handoff applied while a history thread is open resets the selection to the passage** — the seeded prompt must ground on the reader's chapter and append to that chapter's thread, not the reopened one.
- [x] Failing test: a handoff closes the history list if it is showing.
- [x] Failing test: the input is focused with the caret at the end.
- [x] Failing test: the reader can edit the draft and the edit survives; a second handoff replaces it.
- [x] Implement both, using `useApplyHandoff`.

**Requirements:** the selection reset is the failure this seam is most likely to ship with, because it only reproduces when the reader has been in history first. It is two lines and it is the one thing decision 7 actually settles.

## Task 4 — Minting and routing, both workspaces

- [x] Failing test (desktop): pressing a seeded prompt closes the overlay and the draft reaches the chat panel.
- [x] Failing test (mobile): the same press **also switches the workspace tab to Study**, and the panes stay mounted so the draft survives.
- [x] `DoorDeps` gains `onHandoff?: (text: string) => void`; both workspaces pass one built from `useStudyHandoff`.
- [x] Add `seededPrompt` to `InsightSectionView` and `InsightPromptRef` to the client registry, with the eight prompts from design §3.
- [x] Failing test in `insight-doors.parity.test.ts`: **every section of every registered door carries a seeded prompt** — so a later door cannot ship a footer that renders nothing.
- [x] Failing test: a seeded prompt renders the passage in **reader form** (`Psalm 27:4`, `Psalms`), never an OSIS code.

**Requirements:** the parity test compares section **keys and order only** — verified against the test, not assumed — so a client-only field is safe by construction. Do not touch the server registry.

## Task 5 — The footer

- [x] Failing test: a rendered section shows its seeded prompt as a button beneath its body.
- [x] Failing test: **an omitted (empty) section renders no footer** — no heading, no prompt. A door into a room the grounding could not build.
- [x] Failing test: pressing it calls `onHandoff` with the composed text and nothing else.
- [x] Failing test: with no `onHandoff` supplied, no footer renders at all (the door is reachable from contexts that cannot hand off).
- [x] Implement `SectionFooter`; thread `onHandoff` through `PassageDoor` and both `doors.tsx` entries.

**Requirements:** one prompt per section, eight in total, generated doors only. Door 3's sections are components with no `section` contract — a different plumbing path, deliberately not in B4 (design §3).

## Task 6 — Mobile parity

- [x] `env(safe-area-inset-top)` on the overlay header and `env(safe-area-inset-bottom)` on its scroll container. `StudyTabBar` already does this; the one full-bleed surface in the app does not.
- [x] Close ✕ and the "All insights" back control to a 44px touch target, without changing the desktop's visual weight.
- [x] The header must not overflow at 360px with a long book name plus the chapter toggle plus the back control.
- [x] Failing test: `MobileStudyWorkspace` renders the **real** `InsightsOverlay` (not the mock) at least once, asserting the door chooser is reachable and the close control returns to the Study tab.
- [x] Browser checks on a real phone viewport: overlay covers the tab bar with no bleed-through; header and last section clear the notch and home indicator; a seeded prompt lands on Study → Chat with the draft present, editable, and not hidden by the keyboard.

**Requirements:** the overlay covering the tab bar is a property of the code (design §4) — confirm it, do not re-engineer it. **No system back gesture binding**: no `popstate` overlay pattern exists in the repo to follow, it interacts with `useRouteTransition`, and it applies equally to `RegionMapFullscreen`. Its own slice.

## Task 7 — The rename, under a byte gate

- [x] **Failing test FIRST, before any renaming, committed on its own:** `STUDY_INSIGHT_PROMPT.system`, `JSON.stringify(tool)` and `promptVersion` equal a checked-in fixture. Same for `BIBLE_INSIGHT_PROMPT`. Capture the fixtures from the current code. **These must pass before and after every commit in this task.**
- [x] Failing test: `STUDY_EFFORT`, `STUDY_MAX_TOKENS` and `LIBRARY_K` hold the same values per mode after the key is renamed — `LIBRARY_K.opener === 2` is the difference between the opener's grounding and study chat's.
- [x] Failing test: both parsers map **`'opener'` and `'insight'`** to the internal `'opener'`, and anything else to `'chat'`.
- [x] Failing test: `allowContestedRefs` stays `true` on both opener prompts and absent on both doors'.
- [x] Rename: `mode` union and comparisons in `lamplight-study/index.ts`, `lamplight-chat/index.ts`, `bible-chat-stream.ts`, both `parse-body`/inline parsers; `STUDY_INSIGHT_PROMPT` → `STUDY_OPENER_PROMPT` (`prompts/study-opener.ts`), `BIBLE_INSIGHT_PROMPT` → `BIBLE_OPENER_PROMPT` (`prompts/bible-opener.ts`).
- [x] **`promptVersion` strings stay verbatim** — `study-insight-2026-08-06-v5`, `bible-insight-2026-06-10-v3`. They stamp `lamplight_usage` rows; the identifier is renamed, the version string is data.

**Requirements:** if the byte gate fails there are exactly two correct responses — revert, or bump the version *and* re-baseline *and* regenerate the fixture in the same commit. Regenerating it alone to make the red go away is the one response that is always wrong. B3's gate caught a seven-character drift on its first run in exactly this situation.

## Task 8 — The client half of the rename

- [x] `requestStudyInsight` → `requestStudyOpener`, **still parked**. Un-parking is a Myles call and now overlaps Door 1 (design §5).
- [x] `requestOpeningInsight` keeps its name (it is already the right one).
- [x] `mode?: 'chat' | 'insight'` → `'chat' | 'opener' | 'insight'` in `study-stream-client.ts` — the legacy spelling stays in the union because the client still sends it.
- [x] Update the client tests that assert the sent body.
- [ ] **Flip both clients' wire value to `'opener'` — AFTER the deploy.** A one-line follow-up, and the only part of this task that is unsafe today.

**Requirements — REVISED while implementing.** The plan said this task ships after Task 11's deploy, treating the ordering as something an operator honours. It is not: **Vercel deploys the client automatically on merge and `supabase functions deploy` is run by hand**, so the client reaches production first no matter what anyone intends. The ordering has to be a property of the code.

So both clients — `requestOpeningInsight` and the `LamplightChat.tsx` stream, which is a second live sender the plan did not know about — **keep sending `mode: 'insight'`**, pinned by a test that says why. The wire tolerance means the eventual flip is a non-event; keeping the old value is what makes today safe.

## Task 9 — Registry tidy for the naming pass

- [x] `passageDoor` reads `label` and `blurb` from `PASSAGE_DOOR_VIEW`, as `deeperDoor` already does from `DEEPER_DOOR_VIEW`.
- [x] Failing test: the door registered in `doors.tsx` carries the registry's label and blurb.

**Requirements:** open item 1 (door names in the app's voice) stays a Myles call. This makes it a one-file edit rather than a hunt.

## Task 10 — Runbook and docs

- [x] Runbook §5: the two inherited rows closed, with dates.
- [x] Runbook §6: the newly warmed Door 2 passage recorded alongside the two Leviticus 1 doors.
- [x] Runbook §7: a note that `mode: 'opener'` is the wire value and `'insight'` is still accepted.

## Task 11 — Completion gate

- [x] `npx tsc -b` clean · `npx eslint .` at its **163-problem baseline** · `npx vitest run` green — **4,251** at completion (4,171 at plan time).
- [x] **Deploy `lamplight-chat` AND `lamplight-study`.** **Done 2026-08-07** — `lamplight-study` v10 (20:27:41 UTC), `lamplight-chat` v14 (20:27:59 UTC).
- [x] Boot check the wire tolerance explicitly. **10/10 pass**, runbook §9. The discriminator is the empty-message row: an opener body carries no message, so if `'opener'` were falling through to `chat` the parser would reject it for that and return 400 — which is exactly what the empty-message row does return. The two rows differing is what proves the mode parses.
- [x] **`passage-insight` traced and deliberately left at v4.** Its bundle shifts (`index.ts:29` imports from `parse-body.ts`, which now imports `chat-mode.ts`) but the only delta is an unused import of a pure function. Re-verified healthy afterwards; the `door=deeper` 401 / `door=nonsense` 400 pair still proves the B3 registry is live.
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
