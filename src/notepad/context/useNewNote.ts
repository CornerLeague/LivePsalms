import { useCallback, useRef, useState } from 'react';
import { useNoteCollection } from './useNoteCollection';
import { useFolderHierarchy } from './useFolderHierarchy';
import {
  resolveNewNoteFolderId,
  DEFAULT_NEW_NOTE_TYPE,
} from '../collection/new-note-target';
import type { Note } from '../types';

export interface UseNewNote {
  /**
   * Creates the note and resolves with it. Resolves with `null` when the click
   * was swallowed as a duplicate of one already in flight.
   */
  createNewNote: () => Promise<Note | null>;
  /** True while waiting on the folder list — drive a disabled/busy button off this. */
  pending: boolean;
}

/**
 * One-click "New Note": creates a note in the folder the user is currently on,
 * falling back to the top root folder (see `resolveNewNoteFolderId`).
 *
 * The folder list can still be loading when the button is clicked — on first
 * paint, or during the adapter rebind that runs on sign-in/out. A mid-load
 * snapshot is always `[]`, so resolving it would file the note at root
 * *permanently* on accounts that do have folders. When the target can't be
 * decided yet (`resolveNewNoteFolderId` returns null) this waits for the
 * hierarchy to settle and resolves against the real list instead.
 *
 * A second click is ignored while a creation is in flight — whether that's the
 * folder-list wait or just the `createNote` call on the fast path — so one
 * impatient double-tap can't produce two notes.
 */
export function useNewNote(): UseNewNote {
  const { activeNote, collection } = useNoteCollection();
  const { folders, loaded: foldersLoaded, hierarchy } = useFolderHierarchy();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const createNewNote = useCallback(async (): Promise<Note | null> => {
    if (inFlight.current) return null;
    // Guard the whole creation — including the fast path — so a double-tap
    // can't slip a second note through before the first `createNote` settles.
    // `pending` stays scoped to the folder-list wait below (see its doc): the
    // fast path resolves instantly, so flashing the button busy there is noise.
    inFlight.current = true;
    try {
      const target = resolveNewNoteFolderId(activeNote, folders, foldersLoaded);
      if (target !== null) {
        return await collection.createNote(target, DEFAULT_NEW_NOTE_TYPE);
      }

      setPending(true);
      try {
        const settled = await hierarchy.whenLoaded();
        // Re-read the active note: the user may have opened one while we waited.
        const latestActive = collection.getSnapshot().activeNote;
        const folderId = resolveNewNoteFolderId(latestActive, settled.folders, true);
        return await collection.createNote(folderId, DEFAULT_NEW_NOTE_TYPE);
      } finally {
        setPending(false);
      }
    } finally {
      inFlight.current = false;
    }
  }, [activeNote, folders, foldersLoaded, hierarchy, collection]);

  return { createNewNote, pending };
}
