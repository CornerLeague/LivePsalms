// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SlashMenu } from './slash-menu';
import { createSlashCommands } from './slash-commands';
import { emptyParagraphPositions } from './slash-plus';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const COMMANDS = createSlashCommands();

function makeEditor(content: string, emptyLinePlus = true) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, SlashMenu.configure({ commands: COMMANDS, emptyLinePlus })],
    content,
  });
}

describe('emptyParagraphPositions', () => {
  it('finds every empty top-level paragraph and no filled ones', () => {
    editor = makeEditor('<p></p><p>hi</p><p></p>');
    const positions = emptyParagraphPositions(editor.state.doc);
    expect(positions).toHaveLength(2);
    // First empty paragraph's caret is at pos 1.
    expect(positions[0]).toBe(1);
  });

  it('ignores empty paragraphs nested in lists/quotes (top-level only)', () => {
    editor = makeEditor('<ul><li><p></p></li></ul>');
    expect(emptyParagraphPositions(editor.state.doc)).toHaveLength(0);
  });

  it('a single empty doc yields exactly one "+" position', () => {
    editor = makeEditor('<p></p>');
    expect(emptyParagraphPositions(editor.state.doc)).toEqual([1]);
  });
});

describe('slashPlus plugin decorations', () => {
  function plusWidgetCount(ed: Editor): number {
    // The plugin renders one widget decoration per empty paragraph. Count the
    // rendered "+" buttons in the editor DOM.
    return ed.view.dom.querySelectorAll('button.slash-plus').length;
  }

  it('renders a "+" widget on the empty line', () => {
    editor = makeEditor('<p></p>');
    expect(plusWidgetCount(editor)).toBe(1);
  });

  it('renders no "+" when the line has content', () => {
    editor = makeEditor('<p>written</p>');
    expect(plusWidgetCount(editor)).toBe(0);
  });

  it('can be disabled via the emptyLinePlus option', () => {
    editor = makeEditor('<p></p>', false);
    expect(plusWidgetCount(editor)).toBe(0);
  });
});

describe('slashPlus tap handling', () => {
  function plusButton(ed: Editor): HTMLElement {
    const btn = ed.view.dom.querySelector('button.slash-plus');
    if (!(btn instanceof HTMLElement)) throw new Error('no "+" widget rendered');
    return btn;
  }

  function pointer(type: string, init: PointerEventInit & { x: number; y: number }) {
    return new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: init.pointerId ?? 1,
      pointerType: init.pointerType ?? 'touch',
      clientX: init.x,
      clientY: init.y,
    });
  }

  it('a clean tap (down → up in place) opens the launcher by typing "/"', () => {
    editor = makeEditor('<p></p>');
    const btn = plusButton(editor);
    btn.dispatchEvent(pointer('pointerdown', { x: 12, y: 12 }));
    btn.dispatchEvent(pointer('pointerup', { x: 13, y: 14 }));
    expect(editor.getText()).toBe('/');
  });

  it('cancels the press default so touch taps synthesize no compat mouse events', () => {
    // A non-canceled pointerdown lets the browser replay mousedown/mouseup/click
    // at the tap point after release — ProseMirror would treat that replay as a
    // fresh press and yank the caret off the just-typed "/", closing the menu.
    editor = makeEditor('<p></p>');
    const down = pointer('pointerdown', { x: 12, y: 12 });
    plusButton(editor).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('a drag past the slop (a scroll that started on the "+") does not open', () => {
    editor = makeEditor('<p></p>');
    const btn = plusButton(editor);
    btn.dispatchEvent(pointer('pointerdown', { x: 12, y: 12 }));
    btn.dispatchEvent(pointer('pointerup', { x: 12, y: 60 }));
    expect(editor.getText()).toBe('');
  });

  it('swallows the synthesized mouse replay that lands right after a commit', () => {
    editor = makeEditor('<p></p>');
    const btn = plusButton(editor);
    btn.dispatchEvent(pointer('pointerdown', { x: 12, y: 12 }));
    btn.dispatchEvent(pointer('pointerup', { x: 12, y: 12 }));
    expect(editor.getText()).toBe('/');

    // The engine replays the tap as mouse events at the same spot ("+" is gone
    // by now, so they land on the paragraph). They must be swallowed…
    const replay = new window.MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, clientX: 12, clientY: 12,
    });
    editor.view.dom.dispatchEvent(replay);
    expect(replay.defaultPrevented).toBe(true);

    // …while a genuine press elsewhere (outside the 32px window) is untouched.
    // (mouseup, not mousedown: ProseMirror's own mousedown handler needs
    // elementFromPoint, which jsdom lacks — the swallow's distance gate is the
    // same function for all three mouse event types.)
    const elsewhere = new window.MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0, clientX: 200, clientY: 180,
    });
    editor.view.dom.dispatchEvent(elsewhere);
    expect(elsewhere.defaultPrevented).toBe(false);
  });
});
