# ScriptureRef: Keep Reference Pill Visible When Expanded — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inline `scriptureRef` node keep its `📖 Book C:V` pill visible when expanded, revealing the verse text directly beneath the pill (pill is the toggle), instead of replacing the pill with a verse card.

**Architecture:** `ScriptureRefCard` (presentational, unit-tested in isolation) renders a single span wrapper containing the always-present pill `<button>` plus, when expanded, a verse panel sibling that stacks below it via `inline-flex; flex-direction: column`. Expand/collapse stays React-local state (never serialized to the node). CSS retires the old replace-style `.scripture-ref-card*` rules and adds `.scripture-ref-inline` / `.scripture-ref-verse*` reusing the same visual vocabulary.

**Tech Stack:** React + TipTap NodeView, Vitest + React Testing Library (jsdom), plain CSS with design tokens.

**Spec:** `docs/superpowers/specs/2026-06-16-scripture-ref-keep-pill-on-expand-design.md`

---

## File Structure

- **Modify** `src/notepad/extensions/ScriptureRefView.tsx` — collapse the two-branch render into one path: persistent pill toggle + conditional verse panel. (`ScriptureRefNodeView` wrapper unchanged.)
- **Modify** `src/notepad/extensions/ScriptureRefView.test.tsx` — update the expand test to assert the pill stays; add a collapse-on-second-click test.
- **Modify** `src/notepad/extensions/scripture-ref.css` — add `.scripture-ref-inline` + `.scripture-ref-verse*`; remove `.scripture-ref-card*`; update the shared `--vs-ease-out` selector list and the reduced-motion block.

No other files reference these classes (verified via ripgrep). No node-attr/schema changes.

---

## Task 1: Component — pill stays visible, verse stacks below (TDD)

**Files:**
- Modify: `src/notepad/extensions/ScriptureRefView.tsx:42-58`
- Test: `src/notepad/extensions/ScriptureRefView.test.tsx:24-29` (update) and add a new test after it

- [ ] **Step 1: Update the expand test and add a collapse test (make them fail)**

In `src/notepad/extensions/ScriptureRefView.test.tsx`, replace the existing `it('expands to show verse text + BSB label on click', ...)` block (lines 24-29) with these two tests:

```tsx
  it('keeps the reference pill visible when expanded', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByText(/John 3:16/));
    // Pill stays AND the verse + translation are now revealed.
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    expect(screen.getByText('BSB')).toBeTruthy();
  });

  it('collapses again on a second click, hiding the verse but keeping the pill', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByText(/John 3:16/)); // expand
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    fireEvent.click(screen.getByText(/John 3:16/)); // collapse
    expect(screen.queryByText(/For God so loved/)).toBeNull();
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
  });
```

(Note: `getByText(/John 3:16/)` stays unambiguous — RTL's `getNodeText` only reads an element's *direct* text-node children, so the wrapper span and verse panel, whose direct children are elements, never match; only the pill button does. When expanded, the verse panel shows `attrs.text`, not the label, so "John 3:16" appears only in the pill.)

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx`
Expected: `collapses again on a second click...` FAILS — with the current code, the first click renders `.scripture-ref-card` (no pill), so the second `getByText(/John 3:16/)` throws "Unable to find an element with the text: /John 3:16/". (`keeps the reference pill visible` may also fail on the same lookup.)

- [ ] **Step 3: Rewrite the component render to a single path**

In `src/notepad/extensions/ScriptureRefView.tsx`, replace the `if (collapsed) { ... }` block and the `return (<span className="scripture-ref-card">...)` block (lines 42-58) with this single return (the `useState`, `useRef`, `useEffect`, and `refLabel` above are unchanged):

```tsx
  return (
    <span className={`scripture-ref-inline${collapsed ? '' : ' is-expanded'}`}>
      <button
        type="button"
        className="scripture-ref-link"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        {'📖 '}{refLabel(attrs)}
      </button>
      {!collapsed && (
        <span className="scripture-ref-verse">
          <span className="scripture-ref-verse__text">{attrs.text || refLabel(attrs)}</span>
          <span className="scripture-ref-verse__meta">{attrs.translation}</span>
        </span>
      )}
    </span>
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx`
Expected: PASS — all tests in the file (collapsed-default, lazy-fill, offline, the updated expand test, and the new collapse test) green.

- [ ] **Step 5: Typecheck the change**

Run: `npx tsc -b`
Expected: no new errors from `ScriptureRefView.tsx`. (Repo has a known pre-existing baseline of 4 tsc errors in `force-sphere.test.ts` — those are unrelated; confirm none are in `src/notepad/extensions/`.)

- [ ] **Step 6: Commit**

```bash
git add src/notepad/extensions/ScriptureRefView.tsx src/notepad/extensions/ScriptureRefView.test.tsx
git commit -m "feat(scripture-ref): keep reference pill visible when verse expands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: CSS — stack the verse below the pill, retire the replace-style card

**Files:**
- Modify: `src/notepad/extensions/scripture-ref.css` (shared ease-out list lines 13-18; expanded-card section lines 149-216; reduced-motion block lines 218-232)

- [ ] **Step 1: Update the shared `--vs-ease-out` selector list**

Replace the selector list at lines 13-18:

```css
.verse-suggest,
.scripture-ref-link,
.scripture-ref-card,
.scripture-ref-card__collapse {
  --vs-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}
```

with:

```css
.verse-suggest,
.scripture-ref-link,
.scripture-ref-verse {
  --vs-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}
```

- [ ] **Step 2: Replace the expanded-state card rules with the inline-stack + verse-panel rules**

Replace the whole block from `/* Expanded state — inline card... */` through the `.scripture-ref-card__collapse:focus-visible { ... }` rule (lines 149-216) with:

```css
/* Expanded state — pill stays in place; the verse stacks directly beneath it. */
.scripture-ref-inline {
  white-space: normal;
}

.scripture-ref-inline.is-expanded {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  vertical-align: baseline;
}

/* Verse panel revealed below the pill — reuses the card vocabulary. */
.scripture-ref-verse {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  max-width: min(440px, 100%);
  margin: 1px 1px 2px;
  padding: 4px 10px 5px 12px;
  border: 1px solid var(--pale-stone);
  border-left: 3px solid rgba(184, 132, 58, 0.55);
  border-radius: 8px;
  background: rgba(245, 240, 232, 0.7);
  font-family: 'Outfit', sans-serif;
  animation: scripture-ref-card-in 170ms var(--vs-ease-out);
}

.scripture-ref-verse__text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.95em;
  font-style: italic;
  line-height: 1.55;
  color: var(--deep-umber);
}

.scripture-ref-verse__meta {
  align-self: center;
  font-size: 0.7em;
  font-style: normal;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--silica);
}
```

(The `@keyframes scripture-ref-card-in` at lines 167-170 is reused as-is — leave it in place. The `.scripture-ref-link` pill rules and its hover/active/focus states are unchanged.)

- [ ] **Step 3: Update the reduced-motion block**

Replace the reduced-motion block (lines 218-232):

```css
/* ── Reduced motion — keep gentle opacity fades, drop movement/scale. ──── */
@media (prefers-reduced-motion: reduce) {
  .verse-suggest,
  .scripture-ref-card {
    animation: verse-suggest-fade 140ms ease;
  }
  .scripture-ref-link,
  .scripture-ref-card__collapse {
    transition-property: background-color, color;
  }
  .scripture-ref-link:active,
  .scripture-ref-card__collapse:active {
    transform: none;
  }
}
```

with:

```css
/* ── Reduced motion — keep gentle opacity fades, drop movement/scale. ──── */
@media (prefers-reduced-motion: reduce) {
  .verse-suggest,
  .scripture-ref-verse {
    animation: verse-suggest-fade 140ms ease;
  }
  .scripture-ref-link {
    transition-property: background-color, color;
  }
  .scripture-ref-link:active {
    transform: none;
  }
}
```

- [ ] **Step 4: Verify no stale references to the removed classes remain**

Run: `rg -n "scripture-ref-card" src`
Expected: no matches (all `.scripture-ref-card*` usages removed from both the component and the CSS).

- [ ] **Step 5: Build to confirm CSS + app still compile**

Run: `npx vitest run src/notepad/extensions/ScriptureRefView.test.tsx && npx tsc -b`
Expected: tests PASS; tsc shows no new errors outside the known `force-sphere.test.ts` baseline.

- [ ] **Step 6: Manual smoke (visual)**

Run the app (`npm run dev`), open the notepad, insert a verse via `/verse`, and confirm: the `📖 John 3:16` pill is visible; clicking it reveals the verse text indented below while the pill remains; clicking the pill again hides the verse. Check a reference placed mid-sentence wraps acceptably (trailing text flows under the expanded verse — expected per spec).

- [ ] **Step 7: Commit**

```bash
git add src/notepad/extensions/scripture-ref.css
git commit -m "style(scripture-ref): stack expanded verse below the pill, retire replace-style card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verification (whole feature)

- [ ] `npx vitest run src/notepad/extensions/` — ScriptureRefView + editor/suggestion tests green.
- [ ] `npx tsc -b` — no new errors vs. the known pre-existing baseline.
- [ ] `rg -n "scripture-ref-card" src` — zero matches.
- [ ] Manual smoke confirms pill-stays-on-expand and toggle-collapse behavior.
