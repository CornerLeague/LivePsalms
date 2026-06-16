# ScriptureRef: keep the reference pill visible when expanded

**Date:** 2026-06-16
**Feature area:** Auto-verse-completion (`scriptureRef` inline node)
**Files:** `src/notepad/extensions/ScriptureRefView.tsx`, `src/notepad/extensions/scripture-ref.css`, `src/notepad/extensions/ScriptureRefView.test.tsx`

## Problem

The inline `scriptureRef` node renders a collapsed `📖 John 3:16` pill in prose. Clicking it currently **replaces** the pill with an expanded card that shows only the verse *text* + translation + a `✕` collapse button — the reference label disappears. Users want the reference to stay visible while the verse is revealed.

## Desired behavior

- Default state stays **collapsed** (pill only). State is local/ephemeral, never serialized to the doc (unchanged).
- Clicking the pill **toggles** expansion. The pill stays in place; the verse text appears **below** it inside the same inline node.
- Clicking the pill again collapses.
- The lazy verse-text fetch on mount (fills `text` when empty + online) is unchanged.

### Resolved decisions

- **Collapse affordance:** the pill is the single toggle. The separate `✕` button is **removed**.
- **Mid-sentence placement:** for a reference dropped mid-sentence, the trailing text wraps under the expanded verse. This is accepted as inherent to the "verse below" layout.

## Implementation

### Component — `ScriptureRefView.tsx`

Replace the two-branch (collapsed / expanded) render with a single render path:

- Always render the existing `.scripture-ref-link` pill as a `<button>` toggle.
  - `onClick` flips the local `collapsed` state.
  - Add `aria-expanded={!collapsed}` for accessibility.
- When **not** collapsed, additionally render a verse panel sibling containing:
  - the verse text (`attrs.text || refLabel(attrs)`),
  - the translation meta (`attrs.translation`).
- No `✕` button.

Sketch:

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

The `NodeViewWrapper` (`as="span" className="scripture-ref"`) and the attrs/options bridge in `ScriptureRefNodeView` are unchanged.

### Styling — `scripture-ref.css`

- Keep `.scripture-ref-link` (pill) as-is.
- Add `.scripture-ref-inline.is-expanded { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; vertical-align: baseline; }` so the verse stacks under the pill while the pill keeps its baseline alignment with surrounding prose. (The collapsed wrapper stays plain inline.)
- Add `.scripture-ref-verse` / `.scripture-ref-verse__text` / `.scripture-ref-verse__meta` reusing the existing card vocabulary: italic verse text, left gold accent border (`border-left: 3px solid rgba(184, 132, 58, 0.55)`), pale-stone surface, entrance animation, and the `prefers-reduced-motion` fallback.
- Retire the old `.scripture-ref-card` / `.scripture-ref-card__text` / `.scripture-ref-card__meta` / `.scripture-ref-card__collapse` rules (replace-style card no longer rendered). Reuse their values for the new `.scripture-ref-verse*` classes.

## Testing — `ScriptureRefView.test.tsx`

- **Collapsed default** (existing): still shows `John 3:16`, hides verse text, does not refetch present text. Unchanged.
- **Expand on click** (update): after clicking the pill, assert **both** `John 3:16` *and* the verse text + `BSB` are visible (today it only asserts verse text + label).
- **New — collapse on second click:** clicking the pill again hides the verse text while the pill remains.
- **Lazy-fill / offline** tests: unchanged.
- `scripture-ref.editor.test.ts` "node JSON has no collapsed attr": stays green — toggle state remains React-local, never written to node attrs.

## Out of scope

- No change to how references are detected, inserted, fetched, or serialized.
- No change to the `/verse` suggestion dropdown.
