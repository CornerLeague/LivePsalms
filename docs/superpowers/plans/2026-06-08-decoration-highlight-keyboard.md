# Decoration & Highlight Keyboard Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyboard control for notepad decorations (delete/deselect/arrow-nudge a selected decoration) and highlights (a toggle shortcut + keyboard-navigable swatch popover).

**Architecture:** Decoration keys are handled by focusing the selection chrome (no global listener, no contenteditable conflict). The highlight toggle lives in the `styleHighlight` TipTap extension (cross-platform `Mod-Shift-H` using a stored last-used swatch). Popover keyboard nav lives in `HighlightSwatchPopover` with a pointer-vs-keyboard auto-focus rule wired from `Editor`.

**Tech Stack:** React + TypeScript, TipTap (ProseMirror), Vitest + @testing-library/react (jsdom).

**Reference spec:** `docs/superpowers/specs/2026-06-08-decoration-highlight-keyboard-design.md`

---

## File Structure

- `src/notepad/decorations/DecorationItem.tsx` — selection chrome becomes focusable + `onKeyDown` (delete/escape/arrow-nudge); new `onDeselect` prop.
- `src/notepad/decorations/DecorationLayer.tsx` — pass `onDeselect` down to `DecorationItem`.
- `src/notepad/components/Editor.tsx` — refocus editor on decoration delete/deselect; track last interaction (pointer/keyboard); pass `autoFocus`/`onRequestEditorFocus` to the popover.
- `src/notepad/extensions/style-highlight.ts` — `nextHighlightAction` helper, options (`defaultSwatchId`), storage (`lastSwatchId`), `addKeyboardShortcuts` (`Mod-Shift-H`).
- `src/notepad/editor/use-note-editor.ts` — configure `defaultSwatchId` from the manifest.
- `src/notepad/components/HighlightSwatchPopover.tsx` — roving-focus keyboard nav + `autoFocus`/`onRequestEditorFocus` props.
- Tests: `DecorationItem.test.tsx`, `style-highlight.test.ts` (new), `style-highlight.editor.test.ts` (new), `HighlightSwatchPopover.test.tsx` (new).

---

## Task 1: Decoration keyboard (delete / escape / arrow-nudge)

**Files:**
- Modify: `src/notepad/decorations/DecorationItem.tsx`
- Modify: `src/notepad/decorations/DecorationLayer.tsx`
- Modify: `src/notepad/components/Editor.tsx`
- Test: `src/notepad/decorations/DecorationItem.test.tsx`

- [ ] **Step 1: Add failing tests for the decoration keyboard**

In `src/notepad/decorations/DecorationItem.test.tsx`, add `onDeselect: vi.fn()` to the object returned by `handlers()` (so the new prop is always supplied). Then add this block inside `describe('DecorationItem', ...)`:

```tsx
  it('focuses the selection chrome when it becomes selected', () => {
    const h = handlers();
    const { getByTestId } = render(<DecorationItem decoration={d} selected {...h} />);
    expect(document.activeElement).toBe(getByTestId('decoration-chrome-a'));
  });

  it('nudges position with arrow keys (Shift = larger step)', () => {
    const h = handlers(); // contentWidth: 1000, d.xPct 0.5, d.yPx 100
    const { getByTestId } = render(<DecorationItem decoration={d} selected {...h} />);
    const chrome = getByTestId('decoration-chrome-a');

    fireEvent.keyDown(chrome, { key: 'ArrowRight' });
    expect(h.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ xPct: expect.closeTo(0.501, 5) }));

    fireEvent.keyDown(chrome, { key: 'ArrowRight', shiftKey: true });
    expect(h.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ xPct: expect.closeTo(0.51, 5) }));

    fireEvent.keyDown(chrome, { key: 'ArrowUp' });
    expect(h.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ yPx: 99 }));

    fireEvent.keyDown(chrome, { key: 'ArrowDown' });
    expect(h.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ yPx: 101 }));
  });

  it('deletes with Delete and Backspace', () => {
    const h = handlers();
    const { getByTestId } = render(<DecorationItem decoration={d} selected {...h} />);
    const chrome = getByTestId('decoration-chrome-a');
    fireEvent.keyDown(chrome, { key: 'Delete' });
    fireEvent.keyDown(chrome, { key: 'Backspace' });
    expect(h.onDelete).toHaveBeenCalledTimes(2);
    expect(h.onDelete).toHaveBeenCalledWith('a');
  });

  it('deselects with Escape', () => {
    const h = handlers();
    const { getByTestId } = render(<DecorationItem decoration={d} selected {...h} />);
    fireEvent.keyDown(getByTestId('decoration-chrome-a'), { key: 'Escape' });
    expect(h.onDeselect).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/decorations/DecorationItem.test.tsx`
Expected: FAIL — `onDeselect` is not a prop, chrome is not focused/focusable, and keydown does nothing.

- [ ] **Step 3: Implement focus + keydown in `DecorationItem`**

In `src/notepad/decorations/DecorationItem.tsx`:

(a) Change the React import to add `useEffect`:
```ts
import { useEffect, useRef } from 'react';
```

(b) Add `onDeselect` to `Props` (after `onSendToBack`):
```ts
  onSendToBack: (id: string) => void;
  onDeselect: () => void;
```

(c) Add `onDeselect` to the destructured params:
```ts
export function DecorationItem({
  decoration: d, selected, contentWidth,
  onChange, onSelect, onDelete, onDuplicate, onBringToFront, onSendToBack, onDeselect,
}: Props) {
```

(d) Immediately after the `pinch` ref declaration (before `const twoPointerMetrics`), add the focus effect and the keydown handler:
```ts
  // Move focus to the selection chrome when a decoration becomes selected, so
  // keyboard events target the decoration (not the contenteditable text).
  useEffect(() => {
    if (selected) rootRef.current?.focus();
  }, [selected]);

  const onChromeKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        onDelete(d.id);
        break;
      case 'Escape':
        e.preventDefault();
        onDeselect();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dxPx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dyPx = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        onChange(moveTo(d, { dxPx, dyPx, contentWidth }));
        break;
      }
      default:
        break;
    }
  };
```

(e) On the chrome `<div>` (the one with `data-testid={`decoration-chrome-${d.id}`}`), add `tabIndex`, `role`, `aria-label`, and `onKeyDown`. It becomes:
```tsx
        <div
          ref={rootRef}
          data-testid={`decoration-chrome-${d.id}`}
          tabIndex={0}
          role="group"
          aria-label="Decoration selected — arrow keys move, Delete removes, Escape deselects"
          onKeyDown={onChromeKeyDown}
          style={{ ...geometry, height: renderedHeight, zIndex: SELECTED_Z, outline: '2px solid var(--deep-umber)', pointerEvents: 'none' }}
        >
```

- [ ] **Step 4: Pass `onDeselect` through `DecorationLayer`**

In `src/notepad/decorations/DecorationLayer.tsx`, find the `<DecorationItem ... />` render and add the `onDeselect` prop (the component already receives `onDeselect` in its own `Props` and destructures it):
```tsx
              onSendToBack={onSendToBack}
              onDeselect={onDeselect}
```

- [ ] **Step 5: Run DecorationItem tests to verify green**

Run: `npx vitest run src/notepad/decorations/DecorationItem.test.tsx`
Expected: PASS.

- [ ] **Step 6: Return focus to the editor on delete/deselect (`Editor.tsx`)**

In `src/notepad/components/Editor.tsx`, in the `<DecorationLayer>` usage, update the two handlers so focus returns to the editor when the chrome unmounts:
```tsx
            onDeselect={() => { setSelectedDecoration(null); editor?.commands.focus(); }}
            onChange={(next) => decorationsApi.update(next.id, next)}
            onDelete={(id) => { decorationsApi.remove(id); setSelectedDecoration(null); editor?.commands.focus(); }}
```

- [ ] **Step 7: Verify + commit**

Run: `npx vitest run src/notepad/decorations/` → all pass.
Run: `npx tsc --noEmit 2>&1 | grep -E "DecorationItem|DecorationLayer|Editor.tsx" || echo "NO TS ERRORS in touched files"` → NO TS ERRORS.
Run: `npx eslint src/notepad/decorations/DecorationItem.tsx src/notepad/decorations/DecorationLayer.tsx src/notepad/components/Editor.tsx src/notepad/decorations/DecorationItem.test.tsx` → clean.

```bash
git add src/notepad/decorations/DecorationItem.tsx src/notepad/decorations/DecorationLayer.tsx src/notepad/components/Editor.tsx src/notepad/decorations/DecorationItem.test.tsx
git commit -m "feat(notepad): keyboard delete/deselect/nudge for selected decorations"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: Highlight toggle shortcut (`Mod-Shift-H`)

**Files:**
- Modify: `src/notepad/extensions/style-highlight.ts`
- Modify: `src/notepad/editor/use-note-editor.ts`
- Test: `src/notepad/extensions/style-highlight.test.ts` (new), `src/notepad/extensions/style-highlight.editor.test.ts` (new)

- [ ] **Step 1: Write the failing pure-helper test**

Create `src/notepad/extensions/style-highlight.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { nextHighlightAction } from './style-highlight';

describe('nextHighlightAction', () => {
  it('returns unset when a highlight is active', () => {
    expect(nextHighlightAction(true, 'highlight-02', 'highlight-01')).toEqual({ type: 'unset' });
  });
  it('sets the last-used swatch when inactive', () => {
    expect(nextHighlightAction(false, 'highlight-02', 'highlight-01')).toEqual({ type: 'set', swatchId: 'highlight-02' });
  });
  it('falls back to the default swatch when none used yet', () => {
    expect(nextHighlightAction(false, null, 'highlight-01')).toEqual({ type: 'set', swatchId: 'highlight-01' });
  });
  it('returns none when neither last-used nor default exists', () => {
    expect(nextHighlightAction(false, null, null)).toEqual({ type: 'none' });
  });
});
```

- [ ] **Step 2: Write the failing storage/integration test**

Create `src/notepad/extensions/style-highlight.editor.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { StyleHighlight } from './style-highlight';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

describe('StyleHighlight storage', () => {
  it('records the last applied swatch id in storage', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, StyleHighlight],
      content: '<p>hello</p>',
    });
    editor.commands.selectAll();
    editor.commands.setStyleHighlight('highlight-03');
    expect(editor.storage.styleHighlight.lastSwatchId).toBe('highlight-03');
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `npx vitest run src/notepad/extensions/style-highlight.test.ts src/notepad/extensions/style-highlight.editor.test.ts`
Expected: FAIL — `nextHighlightAction` not exported; `editor.storage.styleHighlight.lastSwatchId` is undefined (no storage yet).

- [ ] **Step 4: Implement helper, options, storage, and keyboard shortcut**

In `src/notepad/extensions/style-highlight.ts`:

(a) Add the exported helper and types near the top (after the imports):
```ts
export type HighlightAction =
  | { type: 'unset' }
  | { type: 'set'; swatchId: string }
  | { type: 'none' };

// Decide what Mod-Shift-H should do: remove an active highlight, otherwise apply
// the last-used swatch (or a configured default). Pure so it can be unit-tested.
export function nextHighlightAction(
  isActive: boolean,
  lastSwatchId: string | null,
  defaultSwatchId: string | null,
): HighlightAction {
  if (isActive) return { type: 'unset' };
  const swatchId = lastSwatchId ?? defaultSwatchId;
  return swatchId ? { type: 'set', swatchId } : { type: 'none' };
}

export interface StyleHighlightOptions {
  defaultSwatchId: string | null;
}
export interface StyleHighlightStorage {
  lastSwatchId: string | null;
}
```

(b) Type the mark and add `addOptions`/`addStorage`. Change the `Mark.create({` line to:
```ts
export const StyleHighlight = Mark.create<StyleHighlightOptions, StyleHighlightStorage>({
  name: 'styleHighlight',

  addOptions() {
    return { defaultSwatchId: null };
  },

  addStorage() {
    return { lastSwatchId: null };
  },
```
(Leave `addAttributes`, `parseHTML`, `renderHTML` exactly as they are.)

(c) Update `addCommands` so `setStyleHighlight`/`toggleStyleHighlight` record the last-used swatch in storage:
```ts
  addCommands() {
    return {
      setStyleHighlight:
        (swatchId) =>
        ({ commands }) => {
          this.storage.lastSwatchId = swatchId;
          return commands.setMark(this.name, { swatchId });
        },
      unsetStyleHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleStyleHighlight:
        (swatchId) =>
        ({ commands }) => {
          this.storage.lastSwatchId = swatchId;
          return commands.toggleMark(this.name, { swatchId });
        },
    };
  },
```

(d) Add `addKeyboardShortcuts` immediately after `addCommands` (before the closing `});`):
```ts
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => {
        const action = nextHighlightAction(
          this.editor.isActive(this.name),
          this.storage.lastSwatchId,
          this.options.defaultSwatchId,
        );
        if (action.type === 'unset') return this.editor.commands.unsetStyleHighlight();
        if (action.type === 'set') return this.editor.commands.setStyleHighlight(action.swatchId);
        return false;
      },
    };
  },
```

- [ ] **Step 5: Configure the default swatch in `use-note-editor.ts`**

In `src/notepad/editor/use-note-editor.ts`:

(a) Extend the manifest import to include the helpers:
```ts
import { StyleHighlight } from '../extensions/style-highlight';
import { STYLE_ASSETS, filterAssets } from '../styles/manifest';
```
(If `STYLE_ASSETS`/`filterAssets` are not already imported in this file, add the line above; do not duplicate the `StyleHighlight` import.)

(b) Compute the default highlight swatch id once, above the `useEditor` call (inside `useNoteEditor`, near the top of the function body):
```ts
  const defaultHighlightSwatchId = filterAssets(STYLE_ASSETS, 'highlight', '')[0]?.id ?? null;
```

(c) In the `extensions` array, replace the bare `StyleHighlight,` entry with:
```ts
      StyleHighlight.configure({ defaultSwatchId: defaultHighlightSwatchId }),
```

- [ ] **Step 6: Run to verify green**

Run: `npx vitest run src/notepad/extensions/style-highlight.test.ts src/notepad/extensions/style-highlight.editor.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit 2>&1 | grep -E "style-highlight|use-note-editor" || echo "NO TS ERRORS in touched files"` → NO TS ERRORS.
Run: `npx eslint src/notepad/extensions/style-highlight.ts src/notepad/editor/use-note-editor.ts src/notepad/extensions/style-highlight.test.ts src/notepad/extensions/style-highlight.editor.test.ts` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/extensions/style-highlight.ts src/notepad/editor/use-note-editor.ts src/notepad/extensions/style-highlight.test.ts src/notepad/extensions/style-highlight.editor.test.ts
git commit -m "feat(notepad): Mod-Shift-H toggles highlight with last-used/default swatch"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 3: Highlight popover keyboard navigation

**Files:**
- Modify: `src/notepad/components/HighlightSwatchPopover.tsx`
- Modify: `src/notepad/components/Editor.tsx`
- Test: `src/notepad/components/HighlightSwatchPopover.test.tsx` (new)

- [ ] **Step 1: Write the failing popover tests**

Create `src/notepad/components/HighlightSwatchPopover.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HighlightSwatchPopover } from './HighlightSwatchPopover';
import type { StyleAsset } from '../styles/manifest';

const assets: StyleAsset[] = [
  { id: 'highlight-01', category: 'highlight', thumbUrl: 't1', displayUrl: 'd1', aspectRatio: 1 },
  { id: 'highlight-02', category: 'highlight', thumbUrl: 't2', displayUrl: 'd2', aspectRatio: 1 },
  { id: 'highlight-03', category: 'highlight', thumbUrl: 't3', displayUrl: 'd3', aspectRatio: 1 },
];

const baseProps = () => ({
  assets,
  query: '',
  onQueryChange: vi.fn(),
  onPick: vi.fn(),
  onRemove: vi.fn(),
  onClose: vi.fn(),
  onRequestEditorFocus: vi.fn(),
  anchor: { top: 0, left: 0 },
});

afterEach(cleanup);

describe('HighlightSwatchPopover keyboard', () => {
  it('auto-focuses the first swatch when autoFocus is true', () => {
    const p = baseProps();
    const { getByLabelText } = render(<HighlightSwatchPopover {...p} autoFocus />);
    expect(document.activeElement).toBe(getByLabelText('Highlight highlight-01'));
  });

  it('does not steal focus when autoFocus is false', () => {
    const p = baseProps();
    render(<HighlightSwatchPopover {...p} autoFocus={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('moves roving focus with arrows and applies with Enter', () => {
    const p = baseProps();
    const { getByLabelText } = render(<HighlightSwatchPopover {...p} autoFocus />);
    const first = getByLabelText('Highlight highlight-01');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(getByLabelText('Highlight highlight-02'));
    fireEvent.keyDown(getByLabelText('Highlight highlight-02'), { key: 'Enter' });
    expect(p.onPick).toHaveBeenCalledWith('highlight-02');
  });

  it('removes with Delete and closes with Escape (returning editor focus)', () => {
    const p = baseProps();
    const { getByLabelText } = render(<HighlightSwatchPopover {...p} autoFocus />);
    const first = getByLabelText('Highlight highlight-01');
    fireEvent.keyDown(first, { key: 'Delete' });
    expect(p.onRemove).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onRequestEditorFocus).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/notepad/components/HighlightSwatchPopover.test.tsx`
Expected: FAIL — `autoFocus`/`onRequestEditorFocus` props don't exist; no roving focus or key handling.

- [ ] **Step 3: Implement roving keyboard nav in `HighlightSwatchPopover`**

In `src/notepad/components/HighlightSwatchPopover.tsx`:

(a) Change the React import:
```ts
import { useEffect, useRef, useState } from 'react';
```

(b) Add the two new props to `Props` (after `onClose`):
```ts
  onClose: () => void;
  autoFocus: boolean;
  onRequestEditorFocus?: () => void;
```

(c) Add them to the destructured params:
```ts
export function HighlightSwatchPopover({
  assets, query, onQueryChange, onPick, onRemove, onClose, anchor, autoFocus, onRequestEditorFocus,
}: Props) {
```

(d) After `const shown = filterAssets(assets, 'highlight', query);` and the `rootRef` line, add roving state, refs, effects, and the key handler:
```ts
  const [activeIndex, setActiveIndex] = useState(0);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep the active index in range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  // Pointer-driven opens are keyboard-ready immediately; keyboard-driven opens
  // leave focus in the editor (so selection isn't interrupted).
  useEffect(() => {
    if (autoFocus) swatchRefs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSwatchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(shown.length - 1, activeIndex + 1);
      setActiveIndex(next);
      swatchRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(0, activeIndex - 1);
      setActiveIndex(prev);
      swatchRefs.current[prev]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const a = shown[activeIndex];
      if (a) onPick(a.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      onRequestEditorFocus?.();
    }
  };
```

(e) Update the swatch `<button>` inside `shown.map((a) => ...)` to wire roving focus. Replace it with (note `shown.map((a, i) => ...)`):
```tsx
        {shown.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => { swatchRefs.current[i] = el; }}
            aria-label={`Highlight ${a.id}`}
            tabIndex={i === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(i)}
            onKeyDown={onSwatchKeyDown}
            onClick={() => onPick(a.id)}
            style={{ height: 26, border: '1px solid var(--pale-stone)', borderRadius: 5, overflow: 'hidden', background: '#fff', cursor: 'pointer', padding: 0 }}
          >
            <img src={a.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
```

- [ ] **Step 4: Run popover tests to verify green**

Run: `npx vitest run src/notepad/components/HighlightSwatchPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `autoFocus` + `onRequestEditorFocus` from `Editor.tsx`**

In `src/notepad/components/Editor.tsx`:

(a) Add a last-interaction tracker. Near the other refs in `NotepadEditor` (e.g. just after `const decorationLayerRef = useRef<DecorationLayerHandle>(null);`), add:
```ts
  const lastInteractionRef = useRef<'pointer' | 'keyboard'>('pointer');
  useEffect(() => {
    const onPointer = () => { lastInteractionRef.current = 'pointer'; };
    const onKey = () => { lastInteractionRef.current = 'keyboard'; };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);
```

(b) In the `<HighlightSwatchPopover ... />` render, add the two new props (keep the existing ones):
```tsx
          onClose={() => {
            setSwatchDismissed(true);
            const { from, to } = editor.state.selection;
            dismissedRangeRef.current = { from, to };
          }}
          autoFocus={lastInteractionRef.current === 'pointer'}
          onRequestEditorFocus={() => editor.commands.focus()}
```

- [ ] **Step 6: Full verification**

Run: `npx vitest run src/notepad/ 2>&1 | tail -6`
Expected: only `src/notepad/components/Editor.toolbar-placement.test.tsx` fails (4 known pre-existing failures, unrelated tiptap mock). Everything else passes.

Run: `npx tsc --noEmit 2>&1 | grep -E "notepad" || echo "NO TS ERRORS in notepad"` → NO TS ERRORS.
Run: `npx eslint src/notepad/components/HighlightSwatchPopover.tsx src/notepad/components/HighlightSwatchPopover.test.tsx src/notepad/components/Editor.tsx` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/notepad/components/HighlightSwatchPopover.tsx src/notepad/components/HighlightSwatchPopover.test.tsx src/notepad/components/Editor.tsx
git commit -m "feat(notepad): keyboard-navigable highlight swatch popover"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-Review notes (reconciled against the spec)

- **Spec coverage:** decoration delete/escape/nudge + focus model (Task 1); highlight `Mod-Shift-H` toggle with last-used/default swatch via extension storage + `nextHighlightAction` (Task 2); popover roving nav + pointer-vs-keyboard auto-focus + Escape-returns-focus (Task 3). All covered.
- **Type/name consistency:** `onDeselect` (DecorationItem/DecorationLayer/Editor); `nextHighlightAction` / `HighlightAction` / `StyleHighlightOptions` / `StyleHighlightStorage` (extension + tests); `autoFocus` / `onRequestEditorFocus` (popover + Editor). Names match across tasks.
- **Known baseline:** `Editor.toolbar-placement.test.tsx` (4 failures) is the pre-existing, unrelated tiptap-mock baseline — not introduced or fixed here.
- **Focus-return:** decoration Escape/Delete refocus the editor via `editor?.commands.focus()` (Task 1 Step 6); popover Escape refocuses via `onRequestEditorFocus` (Task 3); popover apply/remove already call `editor.chain().focus()` in the existing `onPick`/`onRemove`.
