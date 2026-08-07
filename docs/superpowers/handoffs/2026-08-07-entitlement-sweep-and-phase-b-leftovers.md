# Handoff: the entitlement sweep, and what Phase B left

**Date:** 2026-08-07
**Status:** READY TO BUILD. **§1 is DONE — the live defect it opens with is fixed** (see §1). What remains is §2's three live checks and §3's ranked backlog. There is no design or plan yet, and §3 mostly wants triage rather than design.
**Branch:** cut from `origin/main`. Everything through B4 is merged — #112, #113, #114, #115, #117, #118, #119, #120, #122.

## Read these first, in this order

1. **This document's §1.** Already done, and read anyway — its lesson about mocks governs everything else here.
2. **`docs/runbooks/passage-insight.md`** — operational state. §5's verification table is the authority on what is and is not proven; §9 carries B4's deploy rule and the `chat-mode` tolerance.
3. **`docs/superpowers/specs/2026-08-07-study-insights-b4-design.md`** — §1 for why section→retrieval steering was deferred (the decision most likely to be reopened by accident), §6 for what B4 declined and why.
4. **The parent design** `2026-08-06-study-insights-design.md` — §11 (the eval hazard cases still uncovered) and §13 (open items 1 and 2, both Myles calls).

## Where Phase B ended

**All of Phase B is shipped and deployed.** Three doors live, the handoff seam live, the `opener` rename done.

| | |
|---|---|
| Functions | `lamplight-study` **v10**, `lamplight-chat` **v14**, `passage-insight` **v5** — all deployed 2026-08-07 and boot-checked |
| Migrations | 060 + 061 applied |
| Cache | `bible_passage_insight` holds **12 rows** — Door 1 on `lev.1` and `lev.1.1`, Door 2 on `lev.1` |
| Gate at merge | `tsc -b` clean · **4,251** tests · eslint at its **163** baseline |

---

## 1. ✅ The entitlement sweep — DONE (a live defect, reproduced and fixed)

**`hasAccess` short-circuits on the global promo before it considers who is asking:**

```ts
// src/notepad/hooks/useLamplightEntitlement.ts
if (promoActive) return true;
```

`lamplight_promo_active` is on. #120 fixed the consequence **for the Insights doors only**, via `canGenerateInsights`, and both #120 and B4's handoff flagged that the same pattern sits in every other call site. **Nobody swept them.** Here is the audit, done against the code:

| Call site | Guarded? |
|---|---|
| `study/StudyWorkspace.tsx:66` | ✅ `canGenerateInsights` (#120) |
| `study/mobile/MobileStudyWorkspace.tsx:55` | ✅ `canGenerateInsights` (#120) |
| `bible/BibleStudyPane.tsx:84` | ✅ `if (!user) return <SignInGate />` at :73 |
| `components/lamplight/LamplightTabPanel.tsx:66` | ✅ `if (!user) return <SignInGate />` at :25 |
| `components/waymarks/waymarks-routes.tsx:22` | ✅ consumer bails — `if (!adapter || !userId) return null` |
| **`study/lexicon/EtymologyPanel.tsx`** | ✅ **FIXED** — was `const canGenerate = hasAccess('inline');` with no `userId` check |

**One unfixed instance — now fixed.** It was live, and it was reproduced rather than inferred. In a browser, signed out, on the Study workspace's ETYMOLOGY panel:

- the card offered **"Ask Lamplight about this verse"**;
- **no sign-in affordance rendered anywhere** on the panel;
- pressing it **fired a real request** to `etymology-insight` (confirmed in the console), which could not succeed — the function does `deriveUserId` → `401 unauthorized` at `index.ts:40` with no bearer token;
- nothing on screen changed. No spinner, no error copy. **This is worse than #120's failure**, which at least said *"That didn't finish. Try again."*

**The correct code was already there.** `EtymologyPanel.tsx` renders exactly the right blocked affordance — `userId == null ? <SignInGate /> : <PaywallCard />` — and it was unreachable while the promo runs, because `canGenerate` was `true`.

**Fixed by `entitledAndSignedIn` in `src/notepad/hooks/useLamplightEntitlement.ts`**, which both `EtymologyPanel` and `canGenerateInsights` now call, so the rule has one home rather than two copies. Verified in the browser, signed out, scoped to the panel: the generate button is gone and the gate's own *Sign in / Sign up* links render in its place.

The predicate is deliberately **not** folded into `hasAccess` itself. That short-circuit is correct for what it answers — *does this feature exist for this session* — and `waymarks-routes.tsx` relies on the consumer guarding. Tightening the hook would relocate the blast radius rather than shrink it. **Who is asking is the caller's question.**

### Why no test caught it, which is the part worth carrying forward

`EtymologyPanel.test.tsx` mocks the entitlement hook wholesale:

```ts
vi.mock('@/notepad/hooks/useLamplightEntitlement', () => ({
  useLamplightEntitlement: () => ({ isLoading: false, tier: 'plus', promoActive: false, hasAccess }),
}));
```

**`promoActive: false` is the bug's precondition, negated in the mock**, and `hasAccess` is a stub that returns whatever the test wants — so the real short-circuit is never executed anywhere in this component's suite. There is also **no signed-out case at all**: no test passes `userId: null`, and none asserts `SignInGate`.

This is #120's lesson repeating with a sharper edge. There it was *"the component's own test asserted the right behaviour and passed, because it sets `canGenerate` directly — the defect was always in the caller."* Here the mock does not merely bypass the caller; **it encodes the assumption the defect lives in.** A mock that hardcodes the safe branch of a condition cannot fail on the unsafe one.

**So the sweep was two things, and the second is the durable one:**

1. ✅ Fix `EtymologyPanel`.
2. ✅ **Make the promo case testable rather than mocked away.** `EtymologyPanel.promo.test.tsx` drives the **real** `useLamplightEntitlement` with a `FakeLamplightAdapter` whose promo is on and a null `userId` — no entitlement mock at all. The three files that *did* mock the module wholesale now spread `importActual` so the real predicate survives, and one of them broke loudly the moment it did, which is the point.

3. ✅ **The shared check** — `src/notepad/hooks/entitlement-guards.contract.test.ts`, in the shape of `bible/prefs/single-instance.test.ts` and `onboarding/tour/anchors.contract.test.ts`.

**Deliberately structural rather than one behavioural test per surface**, because a per-surface test cannot catch the third instance — the surface that bites next is the one nobody wrote a test for, and EtymologyPanel is the proof: it *had* a test file the whole time, and that file mocked the defect's own precondition. So the sweep walks `src/`, and **a new `hasAccess` call site fails it until somebody classifies the guard**, which puts the question in front of the person adding the surface rather than the person debugging it later. It also bans outright the literal line that shipped twice — `const canX = hasAccess(…)`.

Three guard kinds, each *verified* rather than declared: `entitledAndSignedIn` (or a wrapper proven to delegate to it), a signed-out early return that must appear **before** the `hasAccess` line, and consumer-guards. All three failure modes were confirmed to fire by temporarily breaking each one.

---

## 2. Phase B's open live checks — three rows, all human-only

Runbook §5 and §6. Each needs a browser and, for the first two, an authenticated Plus/promo session.

- **An interrupted generation leaves the door uncached.** Unit-tested only, and inherited from B2. Easier now than ever: there are **12 real rows** to diff against. Runbook §6 step 6.
- **The true per-door cost.** `lamplight_usage` is admin-gated, so **$0.066/door** still rests on nine eval fixtures rather than on a real door. The row to look for is `passage_insight`, stamped **2026-08-07 19:35:29 UTC** — the Door 2 generation on `lev.1`.
- **The B4 mobile checks, on a real phone.** Runbook §6 steps 11–12: the overlay over the tab bar, safe areas at the notch and the home indicator, the header at 360px on a long book name, and — the one this document cannot settle — **whether the keyboard covers the seeded draft** when a handoff lands in Chat. jsdom asserts the CSS; only a device asserts the keyboard.

**Also unread from the repo:** whether `monthly_reflection` usage rows are now recording. #119 fixed a silent data loss and it cannot be verified from here for the same admin-gating reason.

---

## 3. The named follow-ups, ranked

Everything below was deferred deliberately, with a reason. The reason matters more than the item — read it before deciding the work is obvious.

### Worth doing soon

- **Parent §11's remaining eval fixtures.** Named in B4 design §6 as its own slice. The nine existing fixtures cover a dense psalm, a verse grain, a thin OT chapter, a contested chapter and denominational bait. **Still uncovered: superscriptions** (a known live hazard — `docs/lamplight/evals/2026-08-06-superscriptions/` — and verse-scope grounding is more exposed than chapter-scope chat), **disputed authorship** (Hebrews, 2 Peter, Daniel, Isaiah, for §9's hedge-inheritance rule), and **genre extremes** (genealogy, legal code, one-line proverb, where several sections legitimately have nothing to say and padding is the temptation). Each live fixture costs a real ~$0.066 sweep.
- **Door 1 names no voice on some passages.** 3 of 4 fixtures name a supplied source; `passage-psalm-27-v4` names none. Measured every sweep as a `voices named` line, deliberately **not gated**. ⚠️ **The cause is not isolated** — Door 2 differs from Door 1 in *both* its brief's phrasing and its register steering, so a prompt change to Door 1 is a guess with a confound. This wants its own A/B, not a prompt tweak. (Production is more encouraging than the fixtures: the warmed Door 2 door names a voice in **all four** sections.)
- **A `popstate` overlay pattern.** Parent §2 asks for a "route-like overlay … with a back affordance"; B4 gave it a touch-sized in-overlay control and stopped there. No `popstate` overlay pattern exists in the repo to follow, it interacts with `useRouteTransition`, and **`RegionMapFullscreen` has the identical shape and the identical gap** — so this is one pattern serving two surfaces, which is what makes it worth a slice.

### Evidence-gated — do not start these without the measurement

- **Widening seeded prompts to 2–3 per section.** B4 shipped one per section, eight total, deliberately (design §1). `autocapture: true` is mounted app-wide and each prompt is a `<button>` with distinctive text, so **which prompts get pressed is already being captured**. Read that before writing sixteen more strings.
- **Section → retrieval steering** (parent §8's third seam). ⚠️ **Deferred with an argument, not for lack of time** — read B4 design §1 before reopening. What it buys is a *hard* `registers` filter (measured and rejected for Door 1 twice) applied to a reader's own editable question; most of what it would buy is already free, because study chat uses the message as its retrieval query and a section-scoped prompt's own words carry the steering. It also costs a `prompt_version` bump and a fresh live baseline on a surface that has one.
- **Repair-by-deletion for Read With Care.** A §9 violation currently fails the whole door. Designed and deferred **pending a measured violation rate**, which is still zero across all fixtures and the one production door.

### Myles calls, not engineering

- **Door names.** "The Passage" / "Deeper In" / "Sources & Reference" are still parent open item 1's placeholders. B4 made this a one-file edit: `passageDoor`, `deeperDoor` and the client registry all read `label`/`blurb` from `src/notepad/study/insights/insight-doors.ts`.
- **A2 rights acquisition** (parent §3.2). Each item lands independently as a `library_sources` row plus an adapter. The one design constraint that must survive: **no section hardcodes a tradition list.**

### Known limits, recorded rather than scheduled

- **The A1 anchor-channel limit.** Rows are ordered by verse, so truncating a flooding source drops the chapter's tail, and a verse-scope anchor late in a huge chapter can miss that source. The real fix pushes the verse-overlap filter into SQL.
- **`scripts/refresh-passage-insights.ts` writes no usage row**, so its spend reaches neither the admin dashboard nor the global daily ceiling. `lamplight_usage.user_id` is `not null references profiles(id)` and a maintenance sweep has no user. Wants a nullable `user_id` or a service-actor row — never a fabricated id.

---

## Decisions already made — do not relitigate

- **The handoff prefills and never auto-sends**, and appends to the passage's existing thread (parent decision 7).
- **Cross-references stay shown, never explained** until Pillar D of the depth overhaul.
- **Both generated doors keep the blanket contested-passage rejection**; study chat keeps its `allowContestedRefs` exemption. A seeded prompt landing a reader in chat on a contested passage gets that exemption, and that is the point of the difference.
- **Insights are global and carry no per-user content.** Seeded prompts are composed client-side from a cached public door.
- **Generation is Plus/promo-gated but not charged to the reader's quota** — a cached door is a public asset.
- **Cached rows serve stale across prompt bumps.** Two readers seeing prose from different prompt versions is acceptable; a correct Overview of Psalm 27 does not rot.

## ⚠️ Landmines

- **`_shared/chat-mode.ts`'s tolerance of `mode: 'insight'` is NOT dead code**, even though every client now sends `'opener'`. There is no service worker, but a reader with the app open in a tab runs the bundle they loaded until they reload, and the journaling opener fires on every passage open. Dropping it would fall those requests through to `chat`, meet an empty message, and `400`. **Every client that has *reloaded* sends `'opener'`. That is not every client.**
- **The client deploys before the edge functions do, always.** Vercel ships on merge; `supabase functions deploy` is run by hand. Any wire-value change needs server tolerance first, client second.
- **Two `prompt_version` strings deliberately contain the word "insight"** — `study-insight-2026-08-06-v5` and `bible-insight-2026-06-10-v3`. They are stored values stamping `lamplight_usage`; the B4 rename changed no emitted byte, so bumping them would assert a change that did not happen. Byte-identity fixtures in each `prompts/__fixtures__/` enforce this. **If one of those gates fails: revert, or bump the version *and* re-baseline *and* regenerate the fixture in the same commit. Never the fixture alone.**
- **The client/server section-key parity test is load-bearing.** `insight-doors.parity.test.ts` compares the two registries directly. A client-only field is safe; **renaming or reordering a key is not**, and the failure is silent — the cache simply never hits and every reader pays to generate a door already in the table.
- **A generation outlives what it was started for.** `usePassageInsight` carries an id + AbortController because the overlay's scope toggle changes `scope` without unmounting. `useApplyHandoff` carries an id for the same class of reason. **Any new async or event-shaped work hung off the overlay needs the same guard.**
- **Redeploy `passage-insight` whenever anything under `supabase/functions/lamplight-study/` changes**, not just its own shell — it imports across directories, including `parse-body.ts`.

## Watch items

- **Read With Care's §9 rule fails the whole door** rather than dropping the section. If a fixture ever trips `tradition_caution`, that is the measured violation rate repair-by-deletion has been waiting for.
- **`registers` is a hard filter, not a bias.** A register nothing matches yields no excerpts rather than falling back. It has now decided three separate questions; treat it as measured-or-not-applied.
- **Clarke can take the slate.** 23,797 chunks against Catena's 2,966. On `deeper-romans-9` at `libraryK: 6` both extra slots went to Clarke. Adopted anyway because it never cost a voice — revisit if a later sweep shows it on more than one fixture.

## Gate

`npx tsc -b` clean · `npx vitest run` green (**4,251** at handoff) · `npx eslint .` at its **163-problem baseline**, not zero.

`tsc -b` covers the whole repo — `src`, `scripts`, and every `supabase/functions` module including the ten Deno shells (#119).

**Do not trust numbers quoted in prose — check them against the code or the live table.** That rule has now caught four things: a "1.6–2×" ratio that survived three documents and a merged PR, a "six type errors" count that was 13, a "0 rows" corpus that was 8, and an **"8 rows / Door 2 has never generated" claim that was 12 rows with Door 2 warm — written stale 30 minutes after the handoff that stated it.** A measurement of an ungated thing is itself ungated.

---

## Cold-start prompt

> Sweep the `hasAccess` promo short-circuit and clear what Phase B of Study Insights left behind.
>
> Read `docs/superpowers/handoffs/2026-08-07-entitlement-sweep-and-phase-b-leftovers.md` first, then the docs its §"Read these first" lists in order.
>
> §1 is already done — read it anyway, because its lesson governs the rest: a mock that hardcodes the safe side of a condition cannot fail on the unsafe one, and that is now twice this codebase has shipped a signed-out reader a button that dead-ends. The one piece of §1 left is the *shared* signed-out-during-promo assertion, so the next surface added is checked rather than the two that have already bitten.
>
> Then §2's three live checks and §3's ranked backlog.
>
> Do not relitigate: the handoff prefills and never auto-sends, cross-references stay shown rather than explained, and section → retrieval steering is deferred with an argument in B4 design §1 rather than for lack of time.
>
> Branch off `main`. Gate: `npx tsc -b`, `vitest run`, `eslint .` (baseline 163 problems, not zero).
