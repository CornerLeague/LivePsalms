import { describe, it, expect, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { applyVerseSelection } from './verse-picker-commands';
import type { VerseCandidate } from '../bible/verse-search-types';

// A recording stub for the Tiptap fluent chain. Every chain method returns the
// same proxy so calls can be inspected after .run().
function makeChainSpy() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const proxy: Record<string, (...a: unknown[]) => unknown> = {};
  const handler = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); return proxy; };
  for (const m of ['focus', 'deleteRange', 'insertScriptureRef', 'insertContentAt', 'run']) proxy[m] = handler(m);
  return { proxy, calls };
}

function makeEditorStub() {
  const { proxy, calls } = makeChainSpy();
  const editor = { chain: () => proxy } as unknown as Editor;
  return { editor, calls };
}

const candidate: VerseCandidate = {
  osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null,
  text: 'And we know that God works all things…', translation: 'BSB', source: 'reference', score: 1,
};

describe('applyVerseSelection', () => {
  it('book item autocompletes the range text to "/verse <Book> " (trailing space)', () => {
    const { editor, calls } = makeEditorStub();
    applyVerseSelection(editor, { from: 1, to: 9 }, { kind: 'book', book: 'Romans' });
    const insert = calls.find((c) => c.method === 'insertContentAt');
    expect(insert).toBeDefined();
    expect(insert!.args[0]).toEqual({ from: 1, to: 9 });
    expect(insert!.args[1]).toBe('/verse Romans ');
    // It must NOT insert a node for a book selection.
    expect(calls.some((c) => c.method === 'insertScriptureRef')).toBe(false);
  });

  it('verse item deletes the range and inserts a scriptureRef node', () => {
    const { editor, calls } = makeEditorStub();
    applyVerseSelection(editor, { from: 1, to: 13 }, { kind: 'verse', candidate });
    expect(calls.some((c) => c.method === 'deleteRange')).toBe(true);
    const insert = calls.find((c) => c.method === 'insertScriptureRef');
    expect(insert).toBeDefined();
    expect(insert!.args[0]).toMatchObject({ osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, translation: 'BSB' });
    // It must NOT autocomplete text for a verse selection.
    expect(calls.some((c) => c.method === 'insertContentAt')).toBe(false);
  });
});
