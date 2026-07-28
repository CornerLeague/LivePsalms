import type { Folder, Note, NoteType } from '../types';

/**
 * The note type assigned to notes created via the one-click "New Note" flows
 * (toolbar button, per-folder + button, mobile FAB). Category selection was
 * removed from note creation, so every quick-created note starts as the neutral
 * `general` type; the user can still change a note's type later.
 */
export const DEFAULT_NEW_NOTE_TYPE: NoteType = 'general';

/**
 * Resolve which folder a "New Note" action should drop the note into.
 *
 * Rules (in order):
 *   1. If the user is currently on a note that lives inside an existing folder,
 *      create the new note in that same folder.
 *   2. Otherwise ("not on a folder" — no active note, or the active note sits at
 *      root / points at a deleted folder), fall back to the top folder: the
 *      first root folder by `order` (matching the sidebar's ordering).
 *   3. If there are no folders at all, fall back to `'root'`.
 */
export function resolveNewNoteFolderId(
  activeNote: Note | null,
  folders: Folder[],
): string {
  const folderIds = new Set(folders.map((f) => f.id));

  if (
    activeNote &&
    activeNote.folderId !== 'root' &&
    folderIds.has(activeNote.folderId)
  ) {
    return activeNote.folderId;
  }

  const topRootFolder = folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.order - b.order)[0];

  return topRootFolder?.id ?? 'root';
}
