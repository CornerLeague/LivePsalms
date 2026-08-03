// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { StyleHighlight } from '../style-highlight';
import { SlashMenu } from './slash-menu';
import { createSlashCommands, type SlashCommand } from './slash-commands';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const SWATCH = 'highlight-01';
const COMMANDS = createSlashCommands({ defaultSwatchId: SWATCH });

function makeEditor(content = '<p></p>') {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      StyleHighlight.configure({ defaultSwatchId: SWATCH }),
      SlashMenu.configure({ commands: COMMANDS }),
    ],
    content,
  });
}

function highlightCmd(): SlashCommand {
  const c = COMMANDS.find((x) => x.id === 'highlight');
  if (!c) throw new Error('missing highlight command');
  return c;
}

// Collect the swatchId of every styleHighlight mark in the doc.
function highlightedRuns(ed: Editor): { text: string; swatchId: string }[] {
  const runs: { text: string; swatchId: string }[] = [];
  ed.state.doc.descendants((node) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === 'styleHighlight');
    if (mark) runs.push({ text: node.text ?? '', swatchId: mark.attrs.swatchId });
  });
  return runs;
}

describe('style command — stored-mark-forward (no selection)', () => {
  it('applies the highlight to text typed AFTER selecting it', () => {
    editor = makeEditor('<p></p>');
    editor.commands.insertContent('/high');
    // Range covers "/high" (5 chars from pos 1).
    highlightCmd().run({ editor, range: { from: 1, to: 6 } });
    // Nothing is highlighted yet — it's a stored mark on a collapsed selection.
    expect(highlightedRuns(editor)).toHaveLength(0);
    // Now type: the new text should carry the highlight.
    editor.commands.insertContent('grace');
    const runs = highlightedRuns(editor);
    expect(runs).toEqual([{ text: 'grace', swatchId: SWATCH }]);
  });
});

describe('style command — applies to an existing selection', () => {
  it('marks the selected text', () => {
    editor = makeEditor('<p>mercy and grace</p>');
    // Select "mercy" (positions 1..6).
    editor.commands.setTextSelection({ from: 1, to: 6 });
    // Simulate the Suggestion range being empty-ish at the caret; the command
    // deletes its (zero-width here) range then marks the selection. Use a
    // no-op range at the selection end so deleteRange doesn't eat the word.
    highlightCmd().run({ editor, range: { from: 6, to: 6 } });
    const runs = highlightedRuns(editor);
    expect(runs.some((r) => r.text === 'mercy' && r.swatchId === SWATCH)).toBe(true);
  });
});

describe('"More styles…" entry', () => {
  it('is omitted when no opener is wired, present when it is', () => {
    const withoutOpener = createSlashCommands({ defaultSwatchId: SWATCH });
    const withOpener = createSlashCommands({ defaultSwatchId: SWATCH, openStylePicker: () => {} });
    expect(withoutOpener.some((c) => c.id === 'more-styles')).toBe(false);
    expect(withOpener.some((c) => c.id === 'more-styles')).toBe(true);
  });

  it('calls the opener and strips the "/query"', () => {
    let opened = 0;
    const commands = createSlashCommands({ defaultSwatchId: SWATCH, openStylePicker: () => { opened += 1; } });
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, StyleHighlight.configure({ defaultSwatchId: SWATCH }), SlashMenu.configure({ commands })],
      content: '<p></p>',
    });
    editor.commands.insertContent('/more');
    const more = commands.find((c) => c.id === 'more-styles')!;
    more.run({ editor, range: { from: 1, to: 6 } });
    expect(opened).toBe(1);
    expect(editor.getText()).not.toContain('/');
  });
});

describe('style command — records lastSwatchId (onboarding + repeat parity)', () => {
  it('remembers the swatch it applied', () => {
    editor = makeEditor('<p></p>');
    editor.commands.insertContent('/high');
    highlightCmd().run({ editor, range: { from: 1, to: 6 } });
    const storage = (editor.storage as Record<string, { lastSwatchId?: string | null }>).styleHighlight;
    expect(storage?.lastSwatchId).toBe(SWATCH);
  });
});
