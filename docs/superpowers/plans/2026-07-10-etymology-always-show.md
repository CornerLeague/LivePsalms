# Etymology Panel — Always-Show + Disclaimer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `EtymologyPanel` always render its collapsible header (like the sibling `OriginalLanguagePanel`) with a two-tier empty-state instead of vanishing when a verse has no etymology, and add a verbatim disclaimer above the cards.

**Architecture:** A single-component behavior change in `src/notepad/study/lexicon/EtymologyPanel.tsx`. Remove the two `return null` guards, and replace the open-body with a four-branch cascade (no-verse prompt / loading skeleton / no-etymology message / disclaimer + deck). The panel is mounted only in `ApparatusRail.tsx`, rendered by both the desktop and mobile Study workspaces with identical props, so one edit covers both. No data, hook, edge-function, or deck-builder changes.

**Tech Stack:** React 18 + TypeScript (Vite), Vitest + @testing-library/react (jsdom), ESLint. Inline-style components; CSS custom properties for color.

## Global Constraints

- **Spec of record:** `docs/superpowers/specs/2026-07-10-etymology-always-show-design.md` (commit `c8696b6`). It supersedes §7/§8 of the original feature spec.
- **Branch:** work stays on `feat/etymology-always-show` (base `65d46f6`). Do **not** touch local `main 37be6b7` (a diverged onboarding branch that lacks `EtymologyPanel`).
- **Files touched:** only `EtymologyPanel.tsx` and `EtymologyPanel.test.tsx`. Nothing else.
- **Default collapsed (D3):** preserve `useState(false)` for `open`. "Always shown" = header always present, never always expanded.
- **Verbatim strings** (tests assert character-for-character):
  - Disclaimer: `All etymological notes here reflect traditional, often speculative lexicon explanations and do not claim to represent settled historical-linguistic conclusions.`
  - No verse: `Tap a verse in the reader to see its etymology.` (italic)
  - No etymology: `No etymology available for this verse.`
- **Disclaimer styling (spec §6):** `fontSize: 11`, `color: 'var(--silica)'`, `lineHeight: 1.5`, `margin: '0 0 10px'`, regular weight, upright (not italic).
- **Deck gated on `hasLexical`, not `current`** — a particle-only verse (lexical tokens exist but no reviewed entry, or only function words) must show the empty-state, not a particle-only deck.
- **Gates (all three, from repo root):** `npx tsc -b` **and** `npx vitest run` **and** `npx eslint .`. `tsc -b` does not cover `scripts/` or `supabase/functions/`. The pre-existing `garden-scene.test.tsx` failure is not ours — confirm it also fails on base `65d46f6` before attributing it here.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/notepad/study/lexicon/EtymologyPanel.tsx` | The panel component (header + open-body cascade + card/deck/nav) | Remove 2 guards; add `muted`/`disclaimer` style consts; replace open-body with the 4-branch cascade; add disclaimer |
| `src/notepad/study/lexicon/EtymologyPanel.test.tsx` | Behavior tests for the panel | Invert 1 test; add 2 tests |

No other file is mounted against, imports, or asserts the panel's absence: `ApparatusRail.test.tsx` mocks `EtymologyPanel` with a stub, so it is unaffected.

---

## Task 1: Always-show — guards → empty-state cascade

Remove the two `return null` guards and render the collapsible header on every verse, with a two-tier empty-state inside the open body. Deck rendering moves under a `hasLexical` gate. **No disclaimer yet** (Task 2).

**Files:**
- Modify: `src/notepad/study/lexicon/EtymologyPanel.tsx` (remove guards ~L53–54; add `muted` const after L16; replace `{open && (…)}` body ~L75–99)
- Test: `src/notepad/study/lexicon/EtymologyPanel.test.tsx` (invert the L37 test; add one new test)

**Interfaces:**
- Consumes (unchanged): `useVerseLexicon(verseId) → { words }`, `useReviewedEtymologyEntries(lexicalKeys) → { entries, loading }`, `buildEtymologyDeck(words, entries) → { cards, firstStarredIndex }`. `hasLexical = cards.some(c => c.kind === 'lexical')`.
- Produces: same `EtymologyPanel` export and props (`verseId, reference, userId, adapter`). No signature change. Behavioral contract: header always renders; open body shows exactly one of {no-verse prompt, skeleton, no-etymology message, deck}.

- [ ] **Step 1: Invert the out-of-scope test and add the no-verse test**

In `EtymologyPanel.test.tsx`, **replace** the existing test (currently `it('renders null when no lexical card exists (out-of-scope verse)', …)`, ~L37–42) with the two tests below:

```tsx
  it('renders the header + empty-state when no lexical card exists (out-of-scope verse)', () => {
    useVerseLexicon.mockReturnValue({ words: [words[1]], language: 'hebrew', loading: false, error: null });
    useReviewedEtymologyEntries.mockReturnValue({ entries: new Map(), loading: false, error: null });
    render(<EtymologyPanel {...props} />);
    const header = screen.getByRole('button', { name: /etymology/i });
    expect(header).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('No etymology available for this verse.')).toBeInTheDocument();
    expect(screen.queryByText(/traditional, often speculative/i)).not.toBeInTheDocument();
  });

  it('renders the header + prompt when no verse is selected', () => {
    render(<EtymologyPanel {...props} verseId={null} />);
    const header = screen.getByRole('button', { name: /etymology/i });
    expect(header).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('Tap a verse in the reader to see its etymology.')).toBeInTheDocument();
    expect(screen.queryByText(/traditional, often speculative/i)).not.toBeInTheDocument();
  });
```

(`words[1]` is the particle לֹא, morph `HTn` — a function word — so the deck has zero lexical cards: the particle-only → empty-state path. The `queryByText(/traditional…/)` assertion is trivially true now and stays true after Task 2, guarding against the disclaimer leaking into an empty-state.)

- [ ] **Step 2: Run the two tests to verify they fail**

Run: `npx vitest run src/notepad/study/lexicon/EtymologyPanel.test.tsx -t "no lexical card|no verse is selected"`
Expected: FAIL — the current component returns `null` for both cases, so `getByRole('button', { name: /etymology/i })` throws "Unable to find an accessible element…".

- [ ] **Step 3: Add the `muted` style const**

In `EtymologyPanel.tsx`, immediately after the `verified` const (~L16), add:

```tsx
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--silica)', margin: 0 };
```

- [ ] **Step 4: Remove the two guards**

Delete these two lines (~L53–54):

```tsx
  if (verseId == null) return null;
  if (!loading && !hasLexical) return null; // panel-activation gate (spec §7)
```

Leave `const hasLexical = …` (L52) and the `goNext`/`goPrev`/`current` lines (L56–58) exactly as they are. `current = cards[currentIndex]` is safe: it is only *read* inside the `hasLexical` branch (Step 5), where `cards` is non-empty and `currentIndex` is clamped.

- [ ] **Step 5: Replace the open-body with the four-branch cascade**

Replace the entire `{open && ( … )}` block (~L75–99) with:

```tsx
      {open && (
        <div style={{ marginTop: 10 }}>
          {verseId == null && (
            <p style={{ ...muted, fontStyle: 'italic' }}>Tap a verse in the reader to see its etymology.</p>
          )}

          {verseId != null && loading && (
            <div data-testid="etymology-skeleton" style={{ height: 120, background: 'var(--cream, #F4F1EA)', borderRadius: 8 }} />
          )}

          {verseId != null && !loading && !hasLexical && (
            <p style={muted}>No etymology available for this verse.</p>
          )}

          {verseId != null && !loading && hasLexical && (
            <>
              {current.kind === 'lexical'
                ? <LexicalCard card={current} verseId={verseId} userId={userId} adapter={adapter} />
                : <FunctionCard card={current} />}

              <DeckStrip cards={cards} currentIndex={currentIndex} onSelect={setCurrentIndex} />

              {isMobile && <p style={{ fontSize: 10, color: 'var(--silica)', margin: '6px 0 0' }}>Swipe the strip to move through the verse.</p>}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button type="button" aria-label="next word" onClick={goNext} disabled={currentIndex >= cards.length - 1}
                  style={navBtn}><ChevronLeft className="w-4 h-4" /></button>
                <span style={{ ...label, letterSpacing: 0 }}>word {currentIndex + 1} of {cards.length}</span>
                <button type="button" aria-label="previous word" onClick={goPrev} disabled={currentIndex <= 0}
                  style={navBtn}><ChevronRight className="w-4 h-4" /></button>
              </div>
            </>
          )}
        </div>
      )}
```

(`verseId != null && … && (<LexicalCard verseId={verseId} … />)` — TypeScript narrows `verseId` to `string` across the `&&` chain, satisfying `LexicalCard`'s `verseId: string` prop. The card/deck/nav markup is unchanged from the original; only its guard condition changed from `!loading && current` to `verseId != null && !loading && hasLexical`.)

- [ ] **Step 6: Run the full panel test file to verify green**

Run: `npx vitest run src/notepad/study/lexicon/EtymologyPanel.test.tsx`
Expected: PASS — the 2 changed/added tests plus the 7 unchanged tests (collapsed-by-default, skeleton, lexical card, inline insight, Ask→generate, RTL nav, swipe hint). 9 passing.

- [ ] **Step 7: Run the gates**

Run: `npx tsc -b`
Expected: no errors.

Run: `npx eslint src/notepad/study/lexicon/EtymologyPanel.tsx src/notepad/study/lexicon/EtymologyPanel.test.tsx`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/study/lexicon/EtymologyPanel.tsx src/notepad/study/lexicon/EtymologyPanel.test.tsx
git commit -m "feat(etymology): always render panel with two-tier empty-state

Remove the two return-null guards; render the collapsible ETYMOLOGY
header on every verse (like OriginalLanguagePanel) with a no-verse
prompt / no-etymology empty-state. Deck gated on hasLexical so a
particle-only verse shows the empty-state, not a bare deck.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Disclaimer above the cards

Add the fixed verbatim disclaimer at the top of the `hasLexical` branch, above the first card. Shown only when etymology cards exist (D2).

**Files:**
- Modify: `src/notepad/study/lexicon/EtymologyPanel.tsx` (add `disclaimer` const after `muted`; add one `<p>` at the top of the `hasLexical` branch)
- Test: `src/notepad/study/lexicon/EtymologyPanel.test.tsx` (add one new test)

**Interfaces:**
- Consumes: the `hasLexical` branch and `muted` const from Task 1.
- Produces: disclaimer `<p>` rendered as the first child of the `hasLexical` branch, so DOM order is disclaimer → card → deck → nav.

- [ ] **Step 1: Add the disclaimer test**

In `EtymologyPanel.test.tsx`, add this test inside the `describe('EtymologyPanel', …)` block (e.g. after the "renders the lexical card" test):

```tsx
  it('shows the disclaimer verbatim, above the first card, when etymology exists', () => {
    render(<EtymologyPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /etymology/i }));
    const disclaimer = screen.getByText(
      'All etymological notes here reflect traditional, often speculative lexicon explanations and do not claim to represent settled historical-linguistic conclusions.',
    );
    expect(disclaimer).toBeInTheDocument();
    // DOM order: the card (its root gloss) must follow the disclaimer.
    const card = screen.getByText(/to tend, graze/);
    expect(disclaimer.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

(The default `beforeEach` mocks give a shepherd lexical card + a particle, so `hasLexical` is true. `no-bitwise` is not configured, so the `&` mask is lint-clean.)

- [ ] **Step 2: Run the disclaimer test to verify it fails**

Run: `npx vitest run src/notepad/study/lexicon/EtymologyPanel.test.tsx -t "disclaimer verbatim"`
Expected: FAIL — the disclaimer text is not yet rendered, so `getByText(…full disclaimer…)` throws "Unable to find an element with the text".

- [ ] **Step 3: Add the `disclaimer` style const**

In `EtymologyPanel.tsx`, immediately after the `muted` const (added in Task 1), add:

```tsx
const disclaimer: React.CSSProperties = { fontSize: 11, color: 'var(--silica)', lineHeight: 1.5, margin: '0 0 10px' };
```

- [ ] **Step 4: Render the disclaimer at the top of the `hasLexical` branch**

Inside the `{verseId != null && !loading && hasLexical && ( <> … </> )}` fragment, add the disclaimer `<p>` as the **first** child, immediately above the card ternary:

```tsx
            <>
              <p style={disclaimer}>All etymological notes here reflect traditional, often speculative lexicon explanations and do not claim to represent settled historical-linguistic conclusions.</p>

              {current.kind === 'lexical'
                ? <LexicalCard card={current} verseId={verseId} userId={userId} adapter={adapter} />
                : <FunctionCard card={current} />}
```

(Leave the rest of the fragment — `DeckStrip`, swipe hint, nav — unchanged.)

- [ ] **Step 5: Run the full panel test file to verify green**

Run: `npx vitest run src/notepad/study/lexicon/EtymologyPanel.test.tsx`
Expected: PASS — 10 tests. The new disclaimer test passes; the two empty-state tests still confirm the disclaimer is absent; the 7 unchanged behavior tests stay green (their queries do not match the disclaimer text).

- [ ] **Step 6: Run the gates**

Run: `npx tsc -b`
Expected: no errors.

Run: `npx eslint src/notepad/study/lexicon/EtymologyPanel.tsx src/notepad/study/lexicon/EtymologyPanel.test.tsx`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/study/lexicon/EtymologyPanel.tsx src/notepad/study/lexicon/EtymologyPanel.test.tsx
git commit -m "feat(etymology): add speculative-notes disclaimer above the cards

Verbatim disclaimer at the top of the expanded body, shown only when
etymology cards exist (empty states show just the empty message).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full-suite gate + real-app verification

Confirm the whole change is green across the full suite and behaves in the running app.

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate trio**

```bash
cd /Users/newmac/Downloads/Psalms_app
npx tsc -b && npx vitest run && npx eslint .
```
Expected: `tsc -b` clean; vitest all green **except** the pre-existing `garden-scene.test.tsx` failure; eslint clean. If `garden-scene` fails, confirm it also fails on base `65d46f6` (`git stash && git switch --detach 65d46f6 && npx vitest run src/**/garden-scene*` … then return) before attributing it here — it is not ours.

- [ ] **Step 2: Real-app verification (per spec §10)**

Start the app and open the Study apparatus. Because the panel is collapsed by default, verify via the header's `aria-expanded` and the expanded content's `offsetHeight` / accessible text — **not** `innerText` on a collapsed panel. Confirm:
  1. The **ETYMOLOGY** header renders on a verse that *has* etymology (e.g. Psalm 23:1), and expanding shows the disclaimer above the first card.
  2. The **ETYMOLOGY** header renders on a verse with *no* etymology, and expanding shows "No etymology available for this verse." with **no** disclaimer.
  3. With no verse selected, expanding shows "Tap a verse in the reader to see its etymology."

- [ ] **Step 3: Proceed to review**

Hand off to `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch` (PR against `main`; **confirm with Nat before merging** — live feature).

---

## Self-Review

**1. Spec coverage:**
- §5.1 remove guards → Task 1 Step 4. ✓
- §5.2 four-branch cascade → Task 1 Step 5. ✓
- §5.2 deck gated on `hasLexical` (particle-only correctness) → Task 1 Step 5 condition; exercised by the inverted test's `words[1]` particle fixture. ✓
- §5.3 header always renders → Task 1 Step 5 (header outside the cascade, unchanged). ✓
- §6 disclaimer verbatim + styling + only-with-cards → Task 2 Steps 3–4; D2 (absent in empty states) asserted in Task 1 tests. ✓
- §9 invert 1 + 3 new assertions (no-verse, disclaimer-above-card, disclaimer-absent) → Task 1 Steps 1 (invert + no-verse + absent) & Task 2 Step 1 (above-card). ✓
- §9 7 tests stay green → Task 1 Step 6 / Task 2 Step 5. ✓
- §10 gates + real-app verify → Task 3. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete code. ✓

**3. Type consistency:** `hasLexical`, `current`, `cards`, `currentIndex`, `goNext`, `goPrev`, `muted`, `disclaimer`, and props (`verseId, reference, userId, adapter`) are used consistently with their definitions in `EtymologyPanel.tsx`. `verseId` is narrowed to `string` inside the `hasLexical` branch. ✓
