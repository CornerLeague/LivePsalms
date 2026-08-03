// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { StyleHighlight } from '../style-highlight';
import { SlashMenu } from './slash-menu';
import { createSlashCommands, filterSlashCommands, type SlashCommand } from './slash-commands';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const COMMANDS = createSlashCommands();

function makeEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      StyleHighlight.configure({ defaultSwatchId: 'highlight-01' }),
      SlashMenu.configure({ commands: COMMANDS }),
    ],
    content: '<p></p>',
  });
}

function byId(id: string): SlashCommand {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`missing command ${id}`);
  return c;
}

// Type a "/query" into the empty first paragraph and return the range covering
// it, exactly as the Suggestion plugin would hand to `command`.
function typeSlash(ed: Editor, query: string): { from: number; to: number } {
  const text = `/${query}`;
  ed.commands.insertContent(text);
  // Fresh doc "<p></p>": text starts at pos 1.
  return { from: 1, to: 1 + text.length };
}

describe('SlashMenu extension', () => {
  it('constructs and registers without error', () => {
    editor = makeEditor();
    expect(editor.isEditable).toBe(true);
    expect(editor.getText()).toBe('');
  });
});

describe('block commands run + strip the "/query"', () => {
  it('Heading 1 turns the line into an empty h1 and removes "/h1"', () => {
    editor = makeEditor();
    const range = typeSlash(editor, 'h1');
    byId('heading-1').run({ editor, range });
    const doc = editor.getJSON();
    expect(doc.content?.[0].type).toBe('heading');
    expect(doc.content?.[0].attrs?.level).toBe(1);
    expect(doc.content?.[0].content).toBeUndefined(); // heading is empty — "/h1" stripped
    expect(editor.getText()).not.toContain('/'); // no leftover slash text anywhere
  });

  it('typed text after Heading 1 lands in the heading, not the trailing line', () => {
    // StarterKit appends a trailing paragraph so a terminal heading stays
    // exitable; the cursor must remain in the heading (Notion parity).
    editor = makeEditor();
    const range = typeSlash(editor, 'h1');
    byId('heading-1').run({ editor, range });
    editor.commands.insertContent('Morning');
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'heading',
      content: [{ type: 'text', text: 'Morning' }],
    });
  });

  it('Quote becomes a blockquote', () => {
    editor = makeEditor();
    const range = typeSlash(editor, 'quote');
    byId('quote').run({ editor, range });
    expect(editor.getJSON().content?.[0].type).toBe('blockquote');
    expect(editor.getText()).not.toContain('/');
  });

  it('Bullet list becomes a bulletList', () => {
    editor = makeEditor();
    const range = typeSlash(editor, 'bul');
    byId('bullet-list').run({ editor, range });
    expect(editor.getJSON().content?.[0].type).toBe('bulletList');
  });

  it('Numbered list becomes an orderedList', () => {
    editor = makeEditor();
    const range = typeSlash(editor, 'num');
    byId('numbered-list').run({ editor, range });
    expect(editor.getJSON().content?.[0].type).toBe('orderedList');
  });

  it('Divider inserts a horizontalRule', () => {
    editor = makeEditor();
    const range = typeSlash(editor, 'div');
    byId('divider').run({ editor, range });
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    expect(types).toContain('horizontalRule');
    expect(editor.getText()).not.toContain('/');
  });
});

describe('mark commands', () => {
  it('Bold leaves no "/b" text and toggles the bold mark on', () => {
    editor = makeEditor();
    const range = typeSlash(editor, 'b');
    byId('bold').run({ editor, range });
    expect(editor.getText()).toBe('');
    expect(editor.isActive('bold')).toBe(true);
  });
});

describe('registry ↔ filter wiring', () => {
  it('the extension filters its registry by query (smoke)', () => {
    // The plugin calls filterSlashCommands(commands, query); assert the same
    // registry the editor was built with yields the expected top hit.
    expect(filterSlashCommands(COMMANDS, 'quote')[0]?.id).toBe('quote');
  });
});
