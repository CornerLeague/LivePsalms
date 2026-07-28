// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Note } from '../types';

// Control exactly which editor instance the hook receives so we can put it in
// the destroyed state the Suspense/StrictMode reconnect path exposes. The hook
// only consumes `useEditor` at runtime from this module.
let mockEditor: Editor | null = null;
vi.mock('@tiptap/react', () => ({
  useEditor: () => mockEditor,
}));

import { useNoteEditor } from './use-note-editor';

const note = (over: Partial<Note> & { id: string }): Note => ({
  id: over.id,
  title: over.title ?? 'Untitled',
  content: over.content ?? '',
  folderId: over.folderId ?? 'root',
  type: over.type ?? 'general',
  tags: [],
  wordCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const liveEditor = () =>
  new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '' });

const docWithText = (text: string) =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

afterEach(() => {
  try {
    mockEditor?.destroy();
  } catch {
    /* already torn down by the test */
  }
  mockEditor = null;
});

describe('useNoteEditor — destroyed-editor guard', () => {
  it('does not read editor.commands (or throw) when the editor is destroyed', () => {
    // On a direct load, React reveals the Suspense-resolved subtree by re-running
    // passive effects (reconnectPassiveEffects). TipTap's useEditor destroys the
    // editor during the intervening cleanup, so the active-note-swap effect can
    // fire on a non-null but destroyed editor — reading `editor.commands` then
    // throws "Cannot read properties of null (reading 'commands')".
    mockEditor = liveEditor();
    mockEditor.destroy();
    expect(mockEditor.isDestroyed).toBe(true);

    expect(() =>
      renderHook(() =>
        useNoteEditor({ activeNote: note({ id: 'n1', content: docWithText('hi') }), updateNote: vi.fn() }),
      ),
    ).not.toThrow();
  });

  it('loads the active note content into a live editor', () => {
    mockEditor = liveEditor();

    renderHook(() =>
      useNoteEditor({ activeNote: note({ id: 'n1', content: docWithText('hello world') }), updateNote: vi.fn() }),
    );

    expect(mockEditor.isDestroyed).toBe(false);
    expect(mockEditor.getText()).toBe('hello world');
  });
});
