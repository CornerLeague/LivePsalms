import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Note } from '../types';
import { insertNoteLinkAt } from '../extensions/note-link';

export interface NoteLinkPopupAnchor {
  x: number;
  y: number;
}

export interface UseNoteLinkPopupResult {
  popup: NoteLinkPopupAnchor | null;
  search: string;
  setSearch: (s: string) => void;
  filteredNotes: Note[];
  dismiss: () => void;
  insert: (noteId: string, noteTitle: string) => void;
}

interface Opts {
  editor: Editor | null;
  notes: Note[];
  activeNoteId: string | null;
  maxResults?: number;
}

/**
 * Filters Notes for the `[[` link picker: case-insensitive title match,
 * excludes the active Note, capped to `maxResults`. Pure — testable in
 * isolation.
 */
export function filterNotesForLinkPopup(
  notes: Note[],
  search: string,
  activeNoteId: string | null,
  maxResults: number,
): Note[] {
  const lower = search.toLowerCase();
  return notes
    .filter((n) => n.id !== activeNoteId && n.title.toLowerCase().includes(lower))
    .slice(0, maxResults);
}

/**
 * Note-link popup controller — owns:
 *   - `[[` keydown detection on the editor's DOM (deletes the first `[`,
 *     prevents the second, opens the popup at the caret position)
 *   - popup anchor coordinates (viewport-fixed)
 *   - search query state and filtered candidates
 *   - dismiss / insert (delegates to insertNoteLinkAt)
 *
 * Does NOT own: the popup's input element keyboard handling (Enter/Escape) —
 * that stays inline with the input element.
 */
export function useNoteLinkPopup({
  editor,
  notes,
  activeNoteId,
  maxResults = 10,
}: Opts): UseNoteLinkPopupResult {
  const [popup, setPopup] = useState<NoteLinkPopupAnchor | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '[') return;

      const { state } = editor;
      const { from } = state.selection;
      if (from < 2) return;

      const prevChar = state.doc.textBetween(from - 1, from);
      if (prevChar !== '[') return;

      e.preventDefault();
      editor.chain().deleteRange({ from: from - 1, to: from }).run();

      const sel = window.getSelection();
      let x = 200;
      let y = 200;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        x = rect.left;
        y = rect.bottom + 8;
      }
      setSearch('');
      setPopup({ x, y });
    };

    // `editor.view` is a throwing proxy until the ProseMirror view is mounted.
    // On reload/teardown the editor instance can exist while its view is null
    // (e.g. after unmount, or before the view attaches), so reading
    // `editor.view.dom` unguarded crashes the whole editor to a blank screen.
    // Attach now if the view is ready, otherwise wait for the `mount` event.
    let dom: HTMLElement | null = null;
    const attach = () => {
      if (dom) return;
      dom = editor.view.dom as HTMLElement;
      dom.addEventListener('keydown', handleKeyDown);
    };

    try {
      attach();
    } catch {
      editor.on('mount', attach);
    }

    return () => {
      editor.off('mount', attach);
      dom?.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor]);

  const dismiss = useCallback(() => {
    setPopup(null);
    setSearch('');
  }, []);

  const insert = useCallback(
    (noteId: string, noteTitle: string) => {
      if (!editor) return;
      insertNoteLinkAt(editor, noteId, noteTitle);
      setPopup(null);
      setSearch('');
    },
    [editor],
  );

  const filteredNotes = filterNotesForLinkPopup(notes, search, activeNoteId, maxResults);

  return { popup, search, setSearch, filteredNotes, dismiss, insert };
}
