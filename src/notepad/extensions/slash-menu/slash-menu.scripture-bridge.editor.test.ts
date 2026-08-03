// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScriptureRef } from '../scripture-ref';
import { SlashMenu } from './slash-menu';
import { createSlashCommands, type SlashCommand } from './slash-commands';
import { matchSlashBeforeCursor } from './slash-menu-matchers';
import { matchVersePickerBeforeCursor, matchLookupPickerBeforeCursor } from '../scripture-ref-matchers';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const COMMANDS = createSlashCommands();

function makeEditor() {
  return new Editor({
    element: document.createElement('div'),
    // ScriptureRef + SlashMenu registered together — the real coexistence.
    extensions: [StarterKit, ScriptureRef.configure({ search: null }), SlashMenu.configure({ commands: COMMANDS })],
    content: '<p></p>',
  });
}

function byId(id: string): SlashCommand {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) throw new Error(`missing ${id}`);
  return c;
}

describe('scripture bridge — Insert verse', () => {
  it('writes the "/verse " trigger, handing off to the shipped picker', () => {
    editor = makeEditor();
    editor.commands.insertContent('/ins');
    byId('insert-verse').run({ editor, range: { from: 1, to: 4 } });
    // The doc now holds the scripture trigger text (the launcher's own "/ins"
    // is gone).
    expect(editor.getText()).toContain('/verse');
    expect(editor.getText()).not.toContain('/ins');
  });

  it('the resulting text routes to the verse picker, and the launcher cedes it', () => {
    // The seam: text "/verse " matches ScriptureRef's verse matcher, and the
    // launcher's matcher stands down (returns null) — so no double dropdown.
    expect(matchVersePickerBeforeCursor('/verse ')).not.toBeNull();
    expect(matchSlashBeforeCursor('/verse ')).toBeNull();
  });
});

describe('scripture bridge — Look up verse', () => {
  it('writes the "/lookup " trigger', () => {
    editor = makeEditor();
    editor.commands.insertContent('/look');
    byId('lookup-verse').run({ editor, range: { from: 1, to: 6 } });
    expect(editor.getText()).toContain('/lookup');
    expect(editor.getText()).not.toContain('/look ');
  });

  it('the resulting text routes to the lookup picker, and the launcher cedes it', () => {
    expect(matchLookupPickerBeforeCursor('/lookup ')).not.toBeNull();
    expect(matchSlashBeforeCursor('/lookup ')).toBeNull();
  });
});
