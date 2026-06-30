import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '../types';

interface UseNoteTitleOpts {
  activeNote: Note | null;
  updateNote: (id: string, updates: Partial<Pick<Note, 'title'>>) => unknown;
  saveDebounceMs?: number;
}

/**
 * useNoteTitle — owns the editable Note title as instant local state and
 * persists it on a debounce, mirroring the body editor's save model
 * (see `useNoteEditor`).
 *
 * Why this exists: the title used to be a controlled input bound directly to
 * `activeNote.title`, whose value only updates AFTER `updateNote` awaits the
 * storage write (a Supabase network round-trip per keystroke for signed-in
 * users). That gated every typed character behind a DB write — felt as lag on
 * mobile. Here the visible value comes from local state (renders immediately)
 * and persistence is debounced and decoupled.
 *
 * Owns:
 *   - Local `title` state, the source of truth for the input value
 *   - Debounced save on change; the note id is captured at change-time so a
 *     pending save still lands on the correct note if the user switches notes
 *     before it fires
 *   - `flushTitle` to persist immediately (blur / Enter-commit)
 *   - Active-note swap: flush the outgoing note's pending save, then load the
 *     incoming note's title (keyed on id only, so our own saves echoing back
 *     don't clobber in-flight typing)
 *   - Flush of any pending save on unmount
 */
export function useNoteTitle({
  activeNote,
  updateNote,
  saveDebounceMs = 500,
}: UseNoteTitleOpts): {
  title: string;
  onTitleChange: (value: string) => void;
  flushTitle: () => void;
} {
  const [title, setTitle] = useState(activeNote?.title ?? '');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The not-yet-persisted edit: { id captured at change-time, latest title }.
  const pendingRef = useRef<{ id: string; title: string } | null>(null);
  // Latest updateNote, synced in an effect (never written during render) so
  // flushTitle can stay referentially stable while still calling the current fn.
  const updateNoteRef = useRef(updateNote);
  useEffect(() => {
    updateNoteRef.current = updateNote;
  });

  const flushTitle = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    updateNoteRef.current(pending.id, { title: pending.title });
  }, []);

  const onTitleChange = useCallback(
    (value: string) => {
      const id = activeNote?.id;
      if (!id) return;
      setTitle(value); // instant — the input never waits on persistence
      pendingRef.current = { id, title: value };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushTitle, saveDebounceMs);
    },
    [activeNote?.id, flushTitle, saveDebounceMs],
  );

  // Active-note swap → reset the editable title to the incoming note. Done with
  // the adjust-state-during-render pattern (React "You Might Not Need an
  // Effect") and guarded on id, so a title change for the SAME id (e.g. our own
  // debounced save echoing back) does NOT reload over in-flight typing.
  const activeId = activeNote?.id ?? null;
  const [renderedId, setRenderedId] = useState(activeId);
  if (activeId !== renderedId) {
    setRenderedId(activeId);
    setTitle(activeNote?.title ?? '');
  }

  // Persist the OUTGOING note's pending save when the active note changes. Kept
  // in an effect because it calls updateNote — a side effect that must not run
  // during render. No setState here, so the swap never loses the last edit.
  const flushedIdRef = useRef(activeId);
  useEffect(() => {
    if (activeId === flushedIdRef.current) return;
    flushTitle();
    flushedIdRef.current = activeId;
  }, [activeId, flushTitle]);

  // Don't lose the last keystrokes if the editor unmounts mid-debounce.
  useEffect(() => () => flushTitle(), [flushTitle]);

  return { title, onTitleChange, flushTitle };
}
