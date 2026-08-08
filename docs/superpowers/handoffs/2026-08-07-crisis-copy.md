# Handoff: the crisis response copy (Journey Thread 2a, Task 8)

**Date:** 2026-08-07
**Status:** READY. Everything mechanical is built and tested; **the words are what is missing.** This is the last thing between slice 2a and shipping.
**Branch:** `feat/crisis-layer`, pushed, **no PR** — held deliberately so 2a ships whole.

## Read these first, in this order

1. **The design's §1.3 and §1.4** — `docs/superpowers/specs/2026-08-07-journey-thread-design.md`. §1.3 is why this feature's likeliest failure is working *too well*; §1.4 is why the response is static and human-written.
2. **`supabase/functions/_shared/crisis-classifier.ts`** — read the header comment before writing a word. It contains the coupling described below, and the copy decision changes what that file must do.
3. **The plan's progress record** — `docs/superpowers/plans/2026-08-07-journey-thread-2a-crisis-layer.md`. What is built, what the backfill measured, and what "the gate is on" does and does not mean.
4. **`src/notepad/components/lamplight/SignInGate.tsx`** (102 lines) — the house pattern for a static, reviewed card. `ConsentCard.tsx` is the pattern for the consent-time disclosure.

## What is already true

| | |
|---|---|
| Migration 062 | applied 2026-08-07 |
| Backfill | 38 notes, 37 ok / 1 lament / 0 risk, `--verify` green |
| Classifier | `crisis-2026-08-07-v1`, fails closed |
| Live eval | `docs/lamplight/evals/2026-08-08-crisis-v1-unmitigated` — **0 false positives across 16 must-not-trip fixtures**, 3/3 recall |
| The gate | wired at all three sites **in code on this branch** |
| Gate (CI) | `tsc -b` clean · 4,318 tests · eslint at its 163 baseline |

⚠️ **The gate is live in code, NOT in production.** Neither `lamplight-generate` nor `lamplight-study` has been redeployed. Commit messages saying "gate turned on" mean the code path. No reader is affected yet, and that is on purpose: a deployed gate that withholds notes while showing the reader nothing is the worst of both halves.

---

## Task 8 is three things

### 1. The response copy

**Static. Human-written. Never generated.** The one moment an AI must not improvise is this one — a model that "sounds caring" is precisely the failure mode, and generated copy cannot be reviewed before it is read. It renders from a constant in a new `src/notepad/components/lamplight/CrisisResponse.tsx`, which does not exist yet.

**Confirm, then resource** (Woebot's protocol, per the brainstorm §5). The response is **not an assertion about the person**. It asks, and it offers.

### 2. ⚠️ THE COUPLING — read this before choosing a tone

`crisis-classifier.ts` currently says, verbatim:

> *When you genuinely cannot tell lament from risk, answer risk. A reader is then offered somewhere to talk, which they may decline; that is a smaller harm than missing someone.*

**That policy is only defensible if the copy is an offer.** Under a question — *"would it help to see somewhere to talk to someone?"* — a false positive is a gentle, declinable door. Under a statement — *"it sounds like you are in crisis"* — a false positive is a **misdiagnosis handed to a grieving person**, and the policy must invert to prefer `lament` when unsure.

**This is one decision in two files.** Whoever writes the copy owns that line in the classifier too. It is flagged in `crisis-classifier.ts`, in the design, and here.

**There is measured evidence it matters.** `burnout-unmitigated` — an exhausted person writing *"I fantasise about just disappearing"* with no denial attached — returned `risk` on **3 of 6** identical calls, then 5 of 6 on a later sampling. The classifier is genuinely undecided there, by design. So a real reader in that state will meet this copy roughly half the time. Write it for them, not for the unambiguous case.

### 3. The resource list, and ⚠️ which regions

**A US-only helpline list is wrong for a global app, and a wrong number is worse than none.** This is the open question the engineering cannot answer: does the list vary by locale, and if so, what does the app actually know about a reader's region? There is currently **no locale plumbing** for this — if the answer is "it varies", that is real work and should be scoped before the copy is finalised, because it changes whether the copy is one constant or a lookup.

Also required at consent, not buried in settings: an explicit **"Lamplight is not a crisis service"** disclosure. `ConsentCard.tsx` is where that belongs.

---

## Constraints the copy must keep

- **It says nothing about what the person wrote.** The note is untouched — not deleted, not hidden, not flagged back to them as a problem.
- **It does not diagnose.** No "you are", no naming a state.
- **It is declinable.** Whatever it offers, saying no must be easy and must not nag.
- **Board review.** The doctrinal review board's remit already covers voice and rule lists; this is squarely inside it.
- **It is version-controlled**, so what a reader saw on a given date is recoverable.

## Landmines

- **⚠️ The surface must stay unreachable while the copy is a placeholder.** Same ordering the Insights doors used — a door stayed unregistered until its baseline was green because a reader must not reach a surface with nothing behind it. Here: a reader must not reach placeholder crisis copy.
- **A false positive is not hypothetical.** The classifier answers `risk` when it cannot tell. Roughly half the time on a genuinely ambiguous burnout entry. The copy is read by people who are *not* in crisis, and it must be kind to them too.
- **`n=38` proves nothing about the real rate.** The backfill's 0 risk across 32 classifications is one small vault, not a base rate. Do not let it make anyone relaxed about the false-positive question.
- **The prefilter does not gate anything** — every note reaches the classifier. If you are reasoning about which notes hit this surface, it is the classifier's verdict alone.

## After the copy: what finishes 2a

1. Build `CrisisResponse.tsx` from the reviewed constant; test that it renders verbatim and **makes no network call**.
2. Add the "not a crisis service" disclosure to `ConsentCard.tsx`.
3. Re-check the classifier's uncertainty line against the copy's final tone (§2 above).
4. **Task 9** — `supabase functions deploy lamplight-generate` and `lamplight-study`. **This is when the gate reaches readers**: notes classified `risk` stop reaching any model.
5. Then the PR for the whole slice.

## Gate

`npx tsc -b` clean · `npx vitest run` green (**4,318** at handoff) · `npx eslint .` at its **163-problem baseline**, not zero.

**Do not trust numbers quoted in prose — check them against the code or the live table.** That rule has caught four stale figures in this project's docs already.

---

## Cold-start prompt

> Write the crisis response copy for Journey Thread slice 2a, then finish the slice.
>
> Read `docs/superpowers/handoffs/2026-08-07-crisis-copy.md` first, then the docs its "Read these first" section lists in order.
>
> The copy is static, human-written, and never generated — it renders from a constant, and it confirms before it resources: it asks whether it would help to see somewhere to talk, rather than telling the reader what they are.
>
> ⚠️ Before choosing a tone, read the coupling in §2: the classifier answers `risk` when it genuinely cannot tell, which is only defensible if the copy is an OFFER. If you write it as a statement about the reader, invert that policy in `crisis-classifier.ts` — it is one decision in two files.
>
> The regional resource question is open and may need locale plumbing that does not exist; scope it before finalising, because it decides whether the copy is one constant or a lookup.
>
> Branch: `feat/crisis-layer`, already pushed, no PR. Gate: `npx tsc -b`, `vitest run`, `eslint .` (baseline 163 problems, not zero).
