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
 * A second click while that wait is in flight is ignored, so one impatient
 * double-tap can't produce two notes.
 */
export function useNewNote(): UseNewNote {
  const { activeNote, collection } = useNoteCollection();
  const { folders, loaded: foldersLoaded, hierarchy } = useFolderHierarchy();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const createNewNote = useCallback(async (): Promise<Note | null> => {
    if (inFlight.current) return null;

    const target = resolveNewNoteFolderId(activeNote, folders, foldersLoaded);
    if (target !== null) {
      return collection.createNote(target, DEFAULT_NEW_NOTE_TYPE);
    }

    inFlight.current = true;
    setPending(true);
    try {
      const settled = await hierarchy.whenLoaded();
      // Re-read the active note: the user may have opened one while we waited.
      const latestActive = collection.getSnapshot().activeNote;
      const folderId = resolveNewNoteFolderId(latestActive, settled.folders, true);
      return await collection.createNote(folderId, DEFAULT_NEW_NOTE_TYPE);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [activeNote, folders, foldersLoaded, hierarchy, collection]);

  return { createNewNote, pending };
}
