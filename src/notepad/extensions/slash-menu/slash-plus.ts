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
// Movement (px) between press and release still counted as a tap, not a scroll.
const TAP_SLOP = 10;

function plusPosFromEvent(event: Event): number | null {
  const target = event.target as HTMLElement | null;
  const btn = target?.closest?.(`button.slash-plus[${POS_ATTR}]`);
  if (!(btn instanceof HTMLElement)) return null;
  const pos = Number(btn.getAttribute(POS_ATTR));
  return Number.isFinite(pos) ? pos : null;
}

export function slashPlusPlugin(editor: Editor): Plugin {
  // Commit on a genuine TAP (primary-button press → release in ~the same spot),
  // not eagerly on the press. Acting on pointerdown would hijack a scroll that
  // begins on the "+" (and block it) and fire on secondary mouse buttons.
  // Tracked per pointerId, so two quick presses on different lines never collide
  // (no plugin-wide dedup). Pointer events cover mouse, touch and pen on every
  // browser since ~2019; a mouse fallback covers older webviews (registered
  // exclusively, so the two never double-fire).
  const pressStarts = new Map<number, { pos: number; x: number; y: number }>();

  const onDown = (event: MouseEvent): boolean => {
    if (event.button !== 0) return false; // primary button only
    const pos = plusPosFromEvent(event);
    if (pos == null) return false;
    const id = (event as PointerEvent).pointerId ?? -1;
    pressStarts.set(id, { pos, x: event.clientX, y: event.clientY });
    // Do NOT preventDefault — let a scroll begin normally; we only commit on up.
    return false;
  };

  const onUp = (event: MouseEvent): boolean => {
    const id = (event as PointerEvent).pointerId ?? -1;
    const start = pressStarts.get(id);
    if (!start) return false;
    pressStarts.delete(id);
    const moved =
      Math.abs(event.clientX - start.x) > TAP_SLOP || Math.abs(event.clientY - start.y) > TAP_SLOP;
    if (moved) return false; // it was a scroll/drag, not a tap
    event.preventDefault(); // suppress the trailing click on the widget
    openLauncherAt(editor, start.pos);
    return true;
  };

  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
  const handleDOMEvents = supportsPointer
    ? {
        pointerdown: (_view: unknown, event: PointerEvent) => onDown(event),
        pointerup: (_view: unknown, event: PointerEvent) => onUp(event),
        pointercancel: (_view: unknown, event: PointerEvent) => {
          pressStarts.delete(event.pointerId);
          return false;
        },
      }
    : {
        mousedown: (_view: unknown, event: MouseEvent) => onDown(event),
        mouseup: (_view: unknown, event: MouseEvent) => onUp(event),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleDOMEvents: handleDOMEvents as any,
    },
  });
}
