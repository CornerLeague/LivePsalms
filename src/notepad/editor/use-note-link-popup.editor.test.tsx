// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useNoteLinkPopup } from './use-note-link-popup';

let editor: Editor | null = null;
afterEach(() => {
  try {
    editor?.destroy();
  } catch {
    // editor may already be torn down by the test
  }
  editor = null;
});

describe('useNoteLinkPopup — editor view lifecycle', () => {
  it('does not throw when the editor instance exists but its view is not mounted', () => {
    // Reproduces the reload/teardown window: the editor instance is non-null
    // but the ProseMirror view is gone, so `editor.view` is a throwing proxy.
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '' });
    editor.unmount();
    expect(editor.isInitialized).toBe(false);

    expect(() =>
      renderHook(() =>
        useNoteLinkPopup({ editor: editor!, notes: [], activeNoteId: null }),
      ),
    ).not.toThrow();
  });

  it('still detects `[[` and opens the popup when the view is mounted', () => {
    editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit], content: '' });
    // Put a single `[` before the caret so the next `[` keydown closes the pair.
    editor.commands.insertContent('[');

    const { result } = renderHook(() =>
      useNoteLinkPopup({ editor: editor!, notes: [], activeNoteId: null }),
    );

    expect(result.current.popup).toBeNull();

    act(() => {
      editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: '[', bubbles: true, cancelable: true }),
      );
    });

    expect(result.current.popup).not.toBeNull();
  });
});
