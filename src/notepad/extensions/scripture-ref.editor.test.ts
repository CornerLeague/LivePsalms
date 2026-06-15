// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ScriptureRef } from './scripture-ref';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function makeEditor(content = '<p></p>') {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ScriptureRef.configure({ search: null })],
    content,
  });
}

const ATTRS = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  translation: 'BSB' as const, text: 'For God so loved the world',
};

describe('insertScriptureRef', () => {
  it('inserts a scriptureRef node with the given attrs', () => {
    editor = makeEditor();
    editor.commands.insertScriptureRef(ATTRS);
    const json = editor.getJSON();
    const node = findNode(json, 'scriptureRef');
    expect(node).toBeTruthy();
    expect(node!.attrs).toMatchObject(ATTRS);
  });
});

describe('serialization round-trip', () => {
  it('parses its own rendered HTML back into a node with all attrs', () => {
    editor = makeEditor();
    editor.commands.insertScriptureRef(ATTRS);
    const html = editor.getHTML();
    const second = makeEditor(html);
    const node = findNode(second.getJSON(), 'scriptureRef');
    second.destroy();
    expect(node!.attrs).toMatchObject(ATTRS);
  });

  it('round-trips a ranged reference (verseEnd set)', () => {
    const ranged = { ...ATTRS, osis: 'jhn.3.16', verseStart: 16, verseEnd: 18, text: 'Ranged text' };
    editor = makeEditor();
    editor.commands.insertScriptureRef(ranged);
    const html = editor.getHTML();
    const second = makeEditor(html);
    const node = findNode(second.getJSON(), 'scriptureRef');
    second.destroy();
    expect(node!.attrs).toMatchObject({ verseStart: 16, verseEnd: 18, text: 'Ranged text' });
  });

  it('rejects malformed input (missing data-osis) -> no scriptureRef node', () => {
    editor = makeEditor('<p><span data-scripture-ref data-book="John">John 3:16</span></p>');
    expect(findNode(editor.getJSON(), 'scriptureRef')).toBeNull();
  });
});

describe('collapse state is ephemeral', () => {
  it('node JSON has no collapsed/view-state attr (toggle cannot dirty the doc)', () => {
    editor = makeEditor();
    editor.commands.insertScriptureRef(ATTRS);
    const node = findNode(editor.getJSON(), 'scriptureRef')!;
    expect(node.attrs).not.toHaveProperty('collapsed');
    expect(Object.keys(node.attrs).sort()).toEqual(
      ['book', 'chapter', 'osis', 'text', 'translation', 'verseEnd', 'verseStart'],
    );
  });
});

// Helper: depth-first search for the first node of a type.
function findNode(json: unknown, type: string): { type: string; attrs: Record<string, unknown> } | null {
  if (!json || typeof json !== 'object') return null;
  const n = json as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === type) return { type, attrs: n.attrs ?? {} };
  for (const child of n.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}
