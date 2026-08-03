// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SlashMenu } from './slash-menu';
import { createSlashCommands } from './slash-commands';
import { emptyParagraphPositions } from './slash-plus';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const COMMANDS = createSlashCommands({ defaultSwatchId: 'highlight-01' });

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
