# Etymology Panel — Always-Show + Disclaimer — Design Spec

**Date:** 2026-07-10
**Status:** Design approved (brainstorming complete) — pending implementation plan
**Feature:** A follow-up change to the shipped Etymology Study feature. Make the **`EtymologyPanel`** always render (like the sibling **Original Language** panel) instead of disappearing on verses with no etymology cards, and add a fixed disclaimer at the top of the expanded panel body.

Supersedes two rules in the original feature spec (`2026-07-08-etymology-study-design.md`): §7 "panel-activation gate" and §8 "empty deck → panel absent." See §7 below.

---

## 1. Overview

Today the `EtymologyPanel` is **absent** (`return null`) whenever the selected verse has no lexical etymology card — an out-of-scope verse, a non-Psalms verse, or a verse whose lemmas aren't reviewed yet. The user wants the panel to behave like `OriginalLanguagePanel`, which **always renders** its collapsible header and shows a graceful empty-state message inside when there's no data.

Two changes, both inside a single component:

1. **Always-show.** Remove the two `return null` guards so the collapsible **ETYMOLOGY** header is always present. Inside the open body, show an empty-state message (mirroring `OriginalLanguagePanel`) when there's no verse or no etymology.
2. **Disclaimer.** Add a fixed, verbatim disclaimer at the top of the expanded body, above the cards, whenever etymology cards are present.

Nothing else about the feature changes: data model, hooks, edge function, deck construction, star ranking, the Ask flow, and RTL nav are all untouched.

---

## 2. Goals & non-goals

**Goals**
- The **ETYMOLOGY** panel header is always visible in the Study apparatus, on every verse, exactly like Original Language — desktop and mobile.
- On a verse with no etymology (or no verse selected), the expanded body shows a short, calm empty-state instead of vanishing.
- A fixed disclaimer frames the etymology notes whenever notes are shown.

**Non-goals**
- No change to how the deck is built, ranked, or navigated.
- No change to the default collapsed state (the panel stays collapsed by default — a deliberate prior decision, commit `7bba051`). "Always shown" = the header is always present, not always expanded.
- No change to data, hooks, tables, the edge function, or entitlement/gating.
- No new mobile-specific code — desktop and mobile already share the one component through `ApparatusRail`.

---

## 3. Resolved decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | **Empty-state content** | **Mirror Original Language** — two-tier: *"Tap a verse in the reader to see its etymology."* when no verse is selected; *"No etymology available for this verse."* when a verse has none. |
| D2 | **Disclaimer scope** | **Only with cards** — the disclaimer renders above the cards only when etymology notes exist. Empty / no-verse states show just the empty message (no "these notes are speculative" over "no notes available"). |
| D3 | **Default open/closed** | **Keep collapsed** — preserve collapse-by-default (`7bba051`). This change affects presence, not expansion. |

---

## 4. Mount topology (why this is a single-file change)

- `EtymologyPanel` is mounted in exactly one place: `ApparatusRail.tsx`, directly beneath `OriginalLanguagePanel`.
- `ApparatusRail` is rendered by **both** `StudyWorkspace.tsx` (desktop) and `mobile/MobileStudyWorkspace.tsx` (mobile) with identical props.

Therefore, changing `EtymologyPanel.tsx` covers desktop and mobile simultaneously. The panel already has an internal `isMobile` branch (the swipe hint); that stays as-is.

---

## 5. Behavior

### 5.1 Remove the guards

Delete these two lines (`EtymologyPanel.tsx`, currently ~L53–54):

```js
if (verseId == null) return null;
if (!loading && !hasLexical) return null; // panel-activation gate (spec §7)
```

The hooks (`useVerseLexicon`, `useReviewedEtymologyEntries`) and the `currentIndex` reset logic already run **before** these guards and already handle `verseId == null` / empty inputs, so removing the guards does not change hook order or introduce a Rules-of-Hooks issue.

### 5.2 Open-body state cascade

The `<section>` + header always render (collapsed by default). When expanded, the body shows exactly one of:

| Condition | Body |
|---|---|
| `verseId == null` | muted **italic** — *"Tap a verse in the reader to see its etymology."* |
| verse selected, `loading` | existing skeleton (`data-testid="etymology-skeleton"`) — unchanged |
| verse selected, `!loading && !hasLexical` | muted — *"No etymology available for this verse."* |
| verse selected, `!loading && hasLexical` | **disclaimer** → current card → deck strip → (mobile swipe hint) → nav |

`hasLexical = cards.some((c) => c.kind === 'lexical')` (already computed).

**Correctness detail — gate the deck on `hasLexical`, not on `current`.** A verse can produce a `cards` array containing only function-word cards (particles) and zero lexical cards. The deck block must render only when `hasLexical` is true, so such a verse shows the empty-state rather than a particle-only deck. This preserves the original spec's rule (§6/§7) that function-word cards are companions *within* an active deck, never a standalone reason to show content. Within the `hasLexical` branch, `current = cards[currentIndex]` is guaranteed defined (cards non-empty), and may be a lexical **or** function card depending on nav position — both render as today.

### 5.3 Header

The chevron, the `ETYMOLOGY` label, and the reference badge (e.g. "Psalm 23:1", already `{reference && …}`) render in the header regardless of etymology availability. That is what "always shown" means.

---

## 6. The disclaimer

Rendered verbatim, above the first card, **only in the `!loading && hasLexical` branch** — tied to the deck, so it sits above whichever card is current:

> All etymological notes here reflect traditional, often speculative lexicon explanations and do not claim to represent settled historical-linguistic conclusions.

**Styling** — subordinate to the cards, consistent with the panel's existing muted captions (`--silica`, the same family as the Original Language attribution line):

- `fontSize: 11`
- `color: var(--silica)`
- `lineHeight: 1.5`
- `margin: 0 0 10px` (bottom gap before the first card)
- regular weight, upright (italic is reserved for the "tap a verse" prompt so the two muted styles stay distinct)

The exact text is a hard requirement — tests assert it character-for-character.

---

## 7. Relationship to the original feature spec

This change **intentionally reverses** two rules in `2026-07-08-etymology-study-design.md`:

- **§7 "Panel activation gate"** ("renders iff the deck contains ≥1 lexical card … zero lexical cards → the panel is absent") — the panel now always renders; zero lexical cards → empty-state message instead of absence.
- **§8 "Empty deck"** ("No lexical cards → panel absent entirely") — now shows the empty-state.

All other rules in that spec (deck construction, `reviewed=true` filter, star ranking, function-word companions, the Ask flow, concurrency, RTL/niqqud) remain in force.

---

## 8. Files changed

- `src/notepad/study/lexicon/EtymologyPanel.tsx` — remove the two guards; add the empty-state cascade and the disclaimer.
- `src/notepad/study/lexicon/EtymologyPanel.test.tsx` — invert one test; add new tests (see §9).

No other files. `ApparatusRail`, `StudyWorkspace`, `MobileStudyWorkspace`, hooks, deck builder, and data layer are untouched.

---

## 9. Testing (TDD — tests first)

**Inverts (was asserting absence):**
- The current `renders null when no lexical card exists (out-of-scope verse)` test (asserts `container` empty) becomes: header/`ETYMOLOGY` button **present**; when expanded, shows *"No etymology available for this verse."*; the disclaimer is **absent**.

**New:**
- `verseId == null` → header present; expanded body shows *"Tap a verse in the reader to see its etymology."*
- `hasLexical` → the disclaimer's verbatim text is present **and positioned above** the first card (DOM-order assertion, not just presence).
- Empty-state (no lexical card) → disclaimer text is **not** in the document.

**Stay green (unchanged behavior):**
- collapsed-by-default; skeleton while loading; lexical card (root + development + Ask); inline insight replaces Ask; Ask→`generate()`; RTL nav (word 1 → word 2, particle card, no Ask); mobile swipe hint. The disclaimer sits above the card and does not intersect these queries.

---

## 10. Gates & verification

- **Gates:** `npx tsc -b` + `npx vitest run` + `npx eslint .`. `tsc -b` does not cover `scripts/` or `supabase/functions/`. The pre-existing `garden-scene.test.tsx` failure is not ours — confirm it also fails on the base commit before attributing it to this change.
- **Real-app verification:** confirm the **ETYMOLOGY** header renders even on a verse with no etymology, and that the empty-state / disclaimer behave per §5–§6. Because the panel is collapsed by default, assert the header `<button>` `aria-expanded` and the expanded content's `offsetHeight`, **not** `innerText`.
- This is a UI/behavior change to a **live** feature: keep it isolated on `feat/etymology-always-show` and ship via PR against `main`; confirm before merging.
