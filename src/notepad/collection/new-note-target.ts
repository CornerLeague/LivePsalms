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
 *   1. If the user is currently on a note that lives inside a folder, create the
 *      new note in that same folder. While folders are still loading
 *      (`foldersLoaded === false`) the id is trusted as-is — it came from a note
 *      that DID load, so the folder exists even though the folders list hasn't
 *      arrived yet. Once loaded, the folder must still exist (a note pointing at
 *      a deleted folder is treated as "not on a folder").
 *   2. Otherwise ("not on a folder" — no active note, or the active note sits at
 *      root / points at a deleted folder), fall back to the top folder: the
 *      first root folder by `order` (matching the sidebar's ordering), skipping
 *      system folders. The system Study root deliberately hides inline note
 *      creation in favor of the Study pane's own docked button, so New Note
 *      must not silently drop notes there either.
 *   3. If there are no eligible folders, fall back to `'root'`.
 *
 * Returns `null` when the target cannot be decided yet: folders are still
 * loading AND there is no active note whose folder id we can inherit. A
 * mid-load snapshot is always `[]`, which is indistinguishable from "this
 * account has no folders" — resolving it would permanently file the note at
 * root just because the click landed before the list arrived. Callers must wait
 * for the hierarchy to settle (`FolderHierarchy.whenLoaded()`) and resolve
 * again rather than treating `null` as root; `useNewNote` does exactly that.
 */
export function resolveNewNoteFolderId(
  activeNote: Note | null,
  folders: Folder[],
  foldersLoaded?: true,
): string;
export function resolveNewNoteFolderId(
  activeNote: Note | null,
  folders: Folder[],
  foldersLoaded: boolean,
): string | null;
export function resolveNewNoteFolderId(
  activeNote: Note | null,
  folders: Folder[],
  foldersLoaded = true,
): string | null {
  if (activeNote && activeNote.folderId && activeNote.folderId !== 'root') {
    if (!foldersLoaded || folders.some((f) => f.id === activeNote.folderId)) {
      return activeNote.folderId;
    }
  }

  // No folder id to inherit, and an unloaded list carries no information about
  // which folders exist — defer to the caller instead of falling back to root.
  if (!foldersLoaded) return null;

  const topRootFolder = folders
    .filter((f) => f.parentId === null && f.kind !== 'study')
    .sort((a, b) => a.order - b.order)[0];

  return topRootFolder?.id ?? 'root';
}
