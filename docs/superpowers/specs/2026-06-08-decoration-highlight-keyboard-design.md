# Decoration & Highlight Keyboard Support — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)

## Problem

Notepad decorations and text highlights are mouse-only today. Users want keyboard
control: delete a selected decoration from the keyboard, move it, deselect it, and
apply/remove highlights and navigate the highlight swatch picker without the mouse.

## Current state (for reference)

- **Decorations** are discrete selectable objects. `Editor` holds
  `selectedDecoration: string | null`. When selected, `DecorationItem` renders a
  selection "chrome" overlay (outline + handles + action bar) at `SELECTED_Z`.
  The action bar already exposes Delete / Duplicate / Bring-to-front /
  Send-to-back / Rotate ±15° / Flip H/V. `DecorationItem` receives `contentWidth`
  and uses the `moveTo(d, { dxPx, dyPx, contentWidth })` geometry helper (clamps
  to bounds). The chrome is NOT focusable; there is no keyboard handling.
- **Highlights** are TipTap marks (`styleHighlight`, attribute `swatchId`), applied
  to a text selection. `HighlightSwatchPopover` appears on text selection and calls
  `editor.chain().focus().setStyleHighlight(id)` / `unsetStyleHighlight()`. There is
  no keyboard shortcut and no popover keyboard navigation. The editor is a
  contenteditable, so any decoration keys must not interfere with typing.

## Decisions

1. **Decoration keys (when one is selected):** Delete/Backspace removes; Escape
   deselects; arrow keys nudge position (1px, or 10px with Shift). No duplicate /
   layer / rotate / flip shortcuts in this pass.
2. **Highlight keys:** `Mod-Shift-H` toggles highlight on the selection using the
   last-used swatch (or a default), removing it if already highlighted; the swatch
   popover is fully keyboard-navigable when focused.
3. **Architecture (Approach A):** decoration keys are handled by focusing the
   selection chrome (no global listener); highlight toggle lives in the
   `styleHighlight` TipTap extension; popover nav lives in the popover component.

## Architecture

### Unit 1 — Decoration keyboard (`DecorationItem.tsx`, with prop threading)

The selection chrome becomes the keyboard target. Because typing requires editor
focus, moving focus to the chrome on selection makes decoration keys conflict-free
by construction.

- The chrome `<div>` (already rendered only when `selected`) gains: `tabIndex={0}`,
  `role="group"`, `aria-label="Decoration selected — arrow keys move, Delete removes, Escape deselects"`,
  and a `ref`. A `useEffect` focuses it when `selected` transitions to true.
- `onKeyDown` on the chrome (each branch calls `e.preventDefault()`):
  - `Delete` / `Backspace` → `onDelete(d.id)`
  - `Escape` → `onDeselect()`  (new prop)
  - `ArrowLeft/Right/Up/Down` → `onChange(moveTo(d, { dxPx, dyPx, contentWidth }))`
    where the moving axis delta is `±step`, `step = e.shiftKey ? 10 : 1`, other axis 0.
- New prop `onDeselect: () => void` on `DecorationItem`, passed from `DecorationLayer`
  (which already receives `onDeselect` from `Editor`).
- `Editor` returns focus to the editor after keyboard delete and deselect so focus
  is not orphaned on `<body>` when the chrome unmounts:
  - `onDelete={(id) => { decorationsApi.remove(id); setSelectedDecoration(null); editor?.commands.focus(); }}`
  - `onDeselect={() => { setSelectedDecoration(null); editor?.commands.focus(); }}`
  (Refocusing on click-deselect is harmless — the click already targeted the editor.)

Interface: `DecorationItem` gains one prop (`onDeselect`); behavior is otherwise
unchanged. No global listeners; nothing fires unless a decoration is selected and
its chrome holds focus.

### Unit 2 — Highlight toggle (`extensions/style-highlight.ts`, `editor/use-note-editor.ts`)

- Add to the extension:
  - `addOptions()` → `{ defaultSwatchId: null as string | null }`.
  - `addStorage()` → `{ lastSwatchId: null as string | null }`.
  - In `setStyleHighlight(swatchId)` (and `toggleStyleHighlight`), record
    `this.storage.lastSwatchId = swatchId` so applying from popover OR keyboard keeps
    "last used" current.
  - `addKeyboardShortcuts()` → `{ 'Mod-Shift-h': () => { ...apply nextHighlightAction... } }`.
- Pure helper (same file or a sibling), unit-testable without a live editor:
  ```ts
  type HighlightAction = { type: 'unset' } | { type: 'set'; swatchId: string } | { type: 'none' };
  function nextHighlightAction(isActive: boolean, lastSwatchId: string | null, defaultSwatchId: string | null): HighlightAction;
  // isActive -> {unset}; else swatchId = lastSwatchId ?? defaultSwatchId; swatchId ? {set, swatchId} : {none}
  ```
  The shortcut calls `nextHighlightAction(editor.isActive(name), storage.lastSwatchId, options.defaultSwatchId)`
  and runs `unsetStyleHighlight()` / `setStyleHighlight(swatchId)` / no-op (`return false`).
- `use-note-editor.ts` configures `StyleHighlight.configure({ defaultSwatchId })` where
  `defaultSwatchId` = first `'highlight'`-category asset id from the manifest
  (`filterAssets('highlight')[0]?.id ?? null`).
- `Mod` resolves to Cmd (mac) / Ctrl (win/linux) via TipTap. TipTap intercepts the
  combo inside the editor (preventing browser default when handled).

### Unit 3 — Highlight popover keyboard navigation (`HighlightSwatchPopover.tsx`, `Editor.tsx`)

- The swatch grid is a roving-`tabIndex` group (exactly one swatch is `tabIndex 0`,
  the rest `-1`; the active index is component state). Keys when focus is inside the
  popover:
  - `ArrowLeft/Right/Up/Down` → move the roving index linearly through the swatch
    list (Left/Up = previous, Right/Down = next), clamped to the ends. (Linear, not
    grid-row math, to keep it simple and unambiguous.)
  - `Enter` (or `Space`) → `onPick(focusedSwatchId)`.
  - `Delete` / `Backspace` → `onRemove()`.
  - `Escape` → `onClose()`.
- Focus-entry rule (avoids stealing focus during keyboard text-selection):
  - Track last interaction with a ref updated by `pointerdown` ('pointer') and
    `keydown` ('keyboard') listeners (in `Editor`, where the popover open-state lives).
  - When the popover opens: if last interaction was 'pointer', auto-focus the first
    swatch (keyboard-ready immediately); if 'keyboard', leave focus in the editor.
    Either way the user can `Tab` into the popover, and `Mod-Shift-H` always works.
  - `onPick` / `onRemove` / `onClose` re-focus the editor (existing `onPick`/`onRemove`
    already do; `onClose` will call `editor?.commands.focus()`), restoring the stored
    selection so the action targets the right text.

## Testing

- **DecorationItem keyboard** (`DecorationItem.test.tsx`, jsdom):
  - Chrome is focused when `selected` becomes true.
  - `ArrowRight` → `onChange` with `xPct === 0.5 + 1/contentWidth`; `Shift+ArrowRight`
    → `+10/contentWidth`; `ArrowUp`/`ArrowDown` adjust `yPx` by ∓1 / ±1 (and ×10 with Shift).
  - `Delete` and `Backspace` → `onDelete('a')`.
  - `Escape` → `onDeselect()`.
- **`nextHighlightAction`** (pure unit test): active → `{unset}`; inactive + lastSwatchId
  → `{set, lastSwatchId}`; inactive + only defaultSwatchId → `{set, defaultSwatchId}`;
  inactive + neither → `{none}`. Plus: `setStyleHighlight(id)` sets
  `extension.storage.lastSwatchId` (small editor-or-storage test).
- **HighlightSwatchPopover** (`HighlightSwatchPopover.test.tsx`, jsdom): arrow keys move
  roving focus; `Enter` → `onPick(focusedId)`; `Delete` → `onRemove`; `Escape` → `onClose`;
  pointer-vs-keyboard auto-focus rule.
- Full notepad suite stays green except the known pre-existing
  `Editor.toolbar-placement` baseline (unrelated tiptap mock).

## Out of scope

- Decoration shortcuts for duplicate / bring-to-front / send-to-back / rotate / flip
  (action bar remains the way to do those).
- Persisting `lastSwatchId` across reloads (in-memory per editor session is enough).
- Changing the highlight swatch set, decoration model, or any non-keyboard behavior.
