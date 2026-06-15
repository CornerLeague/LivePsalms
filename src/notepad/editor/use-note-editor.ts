import { useEffect, useRef } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { BibleVerse } from '../extensions/bible-verse';
import { NoteLink } from '../extensions/note-link';
import { TagMark } from '../extensions/tag-mark';
import { StyleHighlight } from '../extensions/style-highlight';
import { ScriptureRef } from '../extensions/scripture-ref';
import { createBrowserVerseSearchDeps } from '../bible/verse-search-client';
import { STYLE_ASSETS, filterAssets } from '../styles/manifest';
import type { Note } from '../types';
import { parseNoteContent } from './note-editor';
import { extractTags } from '../utils/tags';

interface UseNoteEditorOpts {
  activeNote: Note | null;
  updateNote: (id: string, updates: Partial<Pick<Note, 'content' | 'tags'>>) => unknown;
  saveDebounceMs?: number;
  // NEW: callback invoked once per debounced save with the just-saved note state.
  // Used by Lamplight Signal Layer to enqueue embedding refresh. Errors are
  // swallowed inside the callback; this prop never rejects.
  onAfterSave?: (note: Note) => void;
}

/**
 * NoteEditor — the bridge between a TipTap editor instance and
 * `NotepadActions.updateNote` for the active Note.
 *
 * Owns:
 *   - TipTap editor instantiation (extensions + placeholder)
 *   - Debounced save on every doc change (writes content + tags via updateNote)
 *   - Active-Note swap: load content, focus start, do not emit update
 *   - Cleanup of pending debounce on unmount
 *
 * Does NOT own: toolbar, popups, hover tooltips, note-link click-through.
 * Those are view concerns and stay in the consuming component.
 */
export function useNoteEditor({
  activeNote,
  updateNote,
  saveDebounceMs = 500,
  onAfterSave,
}: UseNoteEditorOpts): { editor: Editor | null } {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref so the setTimeout closure always sees the latest callback
  // without needing to re-create the editor.
  const onAfterSaveRef = useRef(onAfterSave);
  onAfterSaveRef.current = onAfterSave;
  // Same for activeNote — allows the setTimeout to capture the note state that
  // was current when the debounce fired, not the stale closure value.
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;

  const defaultHighlightSwatchId = filterAssets(STYLE_ASSETS, 'highlight', '')[0]?.id ?? null;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing...' }),
      BibleVerse,
      ScriptureRef.configure({ search: createBrowserVerseSearchDeps() }),
      NoteLink,
      TagMark,
      StyleHighlight.configure({ defaultSwatchId: defaultHighlightSwatchId }),
    ],
    content: '',
    onUpdate({ editor: ed }) {
      if (!activeNote) return;
      const id = activeNote.id;
      const text = ed.getText();
      const tags = extractTags(text);
      const json = JSON.stringify(ed.getJSON());

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const patch = { content: json, tags };
        await updateNote(id, patch);
        const cb = onAfterSaveRef.current;
        if (cb) {
          // Reconstruct the just-saved note shape from activeNote + patch.
          const note = activeNoteRef.current;
          if (note && note.id === id) {
            cb({ ...note, ...patch });
          }
        }
      }, saveDebounceMs);
    },
  });

  // Active-Note swap. Watch `id` only — content/title/tag changes from our own
  // saves must not trigger a reload over the user's in-flight edits.
  useEffect(() => {
    if (!editor) return;

    if (!activeNote) {
      editor.commands.setContent('');
      return;
    }

    const parsed = parseNoteContent(activeNote.content);
    if (parsed) {
      editor.commands.setContent(parsed, { emitUpdate: false });
    } else {
      editor.commands.setContent('');
    }
    editor.commands.focus('start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, editor]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { editor };
}
