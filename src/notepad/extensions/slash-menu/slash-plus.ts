import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';

// The empty-line "+" affordance — a mobile-forward opener for the same "/"
// launcher. Tapping "+" inserts a "/" at that line, so it flows through the
// identical Suggestion path (one opener, no parallel menu).

const PLUS_KEY = new PluginKey('slashPlus');

/**
 * Positions (paragraph start, i.e. the caret spot inside the block) of every
 * empty top-level paragraph. Pure over a doc so it's unit-testable without a
 * view. Top-level only: nested empty paragraphs (list items, blockquotes)
 * don't get a "+", matching where a fresh block-insert makes sense.
 */
export function emptyParagraphPositions(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      // offset = position BEFORE the paragraph; +1 lands inside it (the caret).
      out.push(offset + 1);
    }
  });
  return out;
}

// The doc position each "+" opens at is stashed on the button so the plugin's
// event handler (below) can read it — the button carries no listener of its own.
const POS_ATTR = 'data-slash-plus-pos';

function makePlusButton(pos: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'slash-plus';
  btn.setAttribute('aria-label', 'Insert — formatting, styles, scripture');
  btn.setAttribute(POS_ATTR, String(pos));
  btn.textContent = '+';
  return btn;
}

/**
 * Open the launcher at `pos`: focus, drop the caret into the empty line, and
 * type the "/" that the Suggestion plugin listens for.
 */
function openLauncherAt(editor: Editor, pos: number): void {
  editor.chain().focus().setTextSelection(pos).insertContent('/').run();
}

/**
 * ProseMirror plugin rendering a "+" widget in the gutter of each empty
 * top-level paragraph, and opening the launcher when one is pressed.
 *
 * The press is handled through the editor's OWN event pipeline
 * (`handleDOMEvents`), not a DOM listener on the button: the editor view
 * consumes a widget's pointer sequence for its selection management, so a real
 * tap/click never reaches a button-level `click` listener (a synthetic
 * `el.click()` does — which is exactly why the "+" worked in code but was dead
 * under a real finger on phones). `pointerdown` fires for mouse, touch and pen
 * alike, so this is one path for every device.
 */
export function slashPlusPlugin(editor: Editor): Plugin {
  // pointerdown handles mouse + touch + pen on every modern browser. mousedown
  // is a fallback for the rare webview that doesn't deliver pointer events. Both
  // arrive for one tap, so dedup within a short window (also, opening the
  // launcher removes the empty line's widget, so the second event usually misses
  // the button anyway).
  let lastHandledAt = -Infinity;
  const handlePress = (event: Event): boolean => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest?.(`button.slash-plus[${POS_ATTR}]`);
    if (!(btn instanceof HTMLElement)) return false;
    // Own the gesture: stop the view from turning this into a caret placement.
    event.preventDefault();
    if (event.timeStamp - lastHandledAt < 700) return true; // dedup the paired event
    lastHandledAt = event.timeStamp;
    const pos = Number(btn.getAttribute(POS_ATTR));
    if (Number.isFinite(pos)) openLauncherAt(editor, pos);
    return true;
  };

  return new Plugin({
    key: PLUS_KEY,
    props: {
      decorations(state) {
        const widgets = emptyParagraphPositions(state.doc).map((pos) =>
          Decoration.widget(pos, () => makePlusButton(pos), {
            side: -1,
            // Stable key per position so PM reuses the DOM node instead of
            // re-creating it on unrelated updates.
            key: `slash-plus-${pos}`,
          }),
        );
        return DecorationSet.create(state.doc, widgets);
      },
      handleDOMEvents: {
        pointerdown: (_view, event) => handlePress(event),
        mousedown: (_view, event) => handlePress(event),
      },
    },
  });
}
