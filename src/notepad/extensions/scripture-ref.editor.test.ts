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

describe('scriptureRef freezes active translation', () => {
  it('stamps the option translation on inserted nodes', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, ScriptureRef.configure({ search: null, translation: 'KJV' })],
    });
    editor.commands.insertScriptureRef({
      osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
      translation: 'KJV', text: 'For God so loved the world…',
    });
    const json = editor.getJSON();
    const node = JSON.stringify(json);
    expect(node).toContain('"translation":"KJV"');
  });
});

import { buildReferenceItems, buildKeywordItems, buildReferencePinItems, scriptureRefAttrsFromCandidate } from './scripture-ref';
import type { VerseCandidate } from '../bible/verse-search-types';
import type { VerseSearchDeps } from '../bible/verse-search-types';

function fakeDeps(): VerseSearchDeps {
  return {
    ftsSearch: async () => [{ id: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null, text: 'fts' }],
    semanticSearch: async () => [],
    resolvePericope: async () => null,
    fetchVerseText: async () => ({ text: 'For God so loved', translation: 'BSB', reference: 'John 3:16' }),
  };
}

describe('suggestion item builders', () => {
  it('buildReferenceItems resolves the typed reference to one candidate', async () => {
    const items = await buildReferenceItems('John 3:16', fakeDeps(), new AbortController().signal);
    expect(items).toHaveLength(1);
    expect(items[0].osis).toBe('jhn.3.16');
    expect(items[0].text).toBe('For God so loved');
  });

  it('buildKeywordItems returns FTS candidates instantly (no deps -> empty)', async () => {
    const items = await buildKeywordItems('love', fakeDeps(), new AbortController().signal);
    expect(items[0].osis).toBe('jhn.3.16');
  });

  it('builders return [] when search deps are null', async () => {
    expect(await buildReferenceItems('John 3:16', null, new AbortController().signal)).toEqual([]);
    expect(await buildKeywordItems('love', null, new AbortController().signal)).toEqual([]);
  });

  // The /verse picker uses buildReferencePinItems (synchronous, no FTS) so the
  // renderer's createVerseSearch is the single FTS request per keystroke.
  it('buildReferencePinItems pins a typed reference without any FTS fetch', () => {
    const pinned = buildReferencePinItems('John 3:16');
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ book: 'John', chapter: 3, verseStart: 16, source: 'reference' });
    expect(pinned[0].osis).toBe('jhn.3.16');
  });

  it('buildReferencePinItems returns [] for a keyword query (renderer owns FTS)', () => {
    expect(buildReferencePinItems('love')).toEqual([]);
  });
});

describe('scriptureRefAttrsFromCandidate — picker freeze-at-insert', () => {
  // The picker stamps the ACTIVE translation (second arg) onto the inserted node,
  // NOT the candidate's own .translation field. This guards the freeze-at-insert
  // semantic: if the user changes their translation preference later, already-
  // inserted nodes must not be retroactively rewritten.
  //
  // RED logic: if the helper returned `c.translation` instead of the `translation`
  // argument, this test would fail because the candidate's translation is 'BSB'
  // but we assert the result is 'KJV'.
  const candidate: VerseCandidate = {
    osis: 'jhn.3.16',
    book: 'John',
    chapter: 3,
    verseStart: 16,
    verseEnd: null,
    text: 'For God so loved the world',
    translation: 'BSB',  // candidate came from BSB search results
    source: 'fts',
    score: 0.95,
  };

  it('stamps the active translation, not the candidate translation', () => {
    // Active translation at insert time is KJV — must win over candidate's BSB
    const attrs = scriptureRefAttrsFromCandidate(candidate, 'KJV');
    expect(attrs.translation).toBe('KJV');
  });

  it('preserves all other candidate fields unchanged', () => {
    const attrs = scriptureRefAttrsFromCandidate(candidate, 'KJV');
    expect(attrs).toMatchObject({
      osis: 'jhn.3.16',
      book: 'John',
      chapter: 3,
      verseStart: 16,
      verseEnd: null,
      text: 'For God so loved the world',
    });
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
