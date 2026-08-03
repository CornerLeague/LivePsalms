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

function makePlusButton(editor: Editor, pos: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'slash-plus';
  btn.setAttribute('aria-label', 'Insert — formatting, styles, scripture');
  btn.textContent = '+';
  // mousedown (not click) + preventDefault so the editor selection isn't torn
  // down before we place the caret and fire the trigger.
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    editor.chain().focus().setTextSelection(pos).insertContent('/').run();
  });
  return btn;
}

/**
 * ProseMirror plugin rendering a "+" widget in the gutter of each empty
 * top-level paragraph. Rebuilt on every state change, so positions stay fresh.
 */
export function slashPlusPlugin(editor: Editor): Plugin {
  return new Plugin({
    key: PLUS_KEY,
    props: {
      decorations(state) {
        const widgets = emptyParagraphPositions(state.doc).map((pos) =>
          Decoration.widget(pos, () => makePlusButton(editor, pos), {
            side: -1,
            // Stable key per position so PM reuses the DOM node instead of
            // re-creating (and losing) it on unrelated updates.
            key: `slash-plus-${pos}`,
          }),
        );
        return DecorationSet.create(state.doc, widgets);
      },
    },
  });
}
