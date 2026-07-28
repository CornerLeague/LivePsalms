import { NOTE_TYPE_ORDER } from '../sidebar/folder-tree-view';
import type { Folder, FolderIcon, Note, NoteType } from '../types';

/**
 * Backfill for accounts created before note creation became folder-based.
 *
 * Everything the folder model added — per-folder "+" buttons, "New Note lands
 * in the folder you're on", folder-colored graph chips — is invisible to an
 * account whose notes all sit at `folderId: 'root'`. Those accounts instead
 * fall through to the legacy sidebar grouping, which buckets root notes by
 * `NoteType` (GENERAL / DEVOTION / SERMON / THEME). The result is that the new
 * model looks like it never shipped.
 *
 * This turns that implicit grouping into real folders: one folder per note type
 * the account actually uses, carrying the same label and color the type chips
 * already showed, with every root note moved into its matching folder. What the
 * user saw as four groups stays four groups — they just become folders.
 */

/** Folder presentation per note type, mirroring `NOTE_TYPE_CONFIG`'s colors. */
const TYPE_FOLDER: Record<NoteType, { name: string; icon: FolderIcon; color: string }> = {
  general: { name: 'General', icon: 'book', color: '#9E9484' },
  devotion: { name: 'Devotions', icon: 'heart', color: '#6B8B7A' },
  sermon: { name: 'Sermons', icon: 'flame', color: '#7A9BAE' },
  theme: { name: 'Themes', icon: 'star', color: '#D4A0A0' },
};

export interface SeedFolderSpec {
  type: NoteType;
  name: string;
  icon: FolderIcon;
  color: string;
}

export interface TypeFolderSeedPlan {
  /** Folders to create, in sidebar order. Always at least one. */
  folders: SeedFolderSpec[];
  /** Root notes to move, grouped by the type whose folder they belong in. */
  moves: Array<{ noteId: string; type: NoteType }>;
}

/**
 * Decide whether an account needs the backfill, and what it should look like.
 *
 * Returns `null` — leave the account alone — when either:
 *   - it already has a non-system folder, meaning the user has adopted folders
 *     and their layout is theirs to arrange, or
 *   - it has no root notes to file.
 *
 * The system Study folder doesn't count as adoption: it's created for the user
 * by Study mode, not by them.
 *
 * "Root note" matches the sidebar's orphan rule (`buildFolderTreeView`): a note
 * whose `folderId` is `'root'` OR points at a folder that no longer exists.
 * Those are exactly the notes the legacy type buckets were rendering.
 */
export function planTypeFolderSeed(notes: Note[], folders: Folder[]): TypeFolderSeedPlan | null {
  const hasUserFolder = folders.some((f) => f.kind !== 'study');
  if (hasUserFolder) return null;

  const folderIds = new Set(folders.map((f) => f.id));
  const rootNotes = notes.filter((n) => n.folderId === 'root' || !folderIds.has(n.folderId));
  if (rootNotes.length === 0) return null;

  const usedTypes = new Set(rootNotes.map((n) => n.type));
  const seedFolders = NOTE_TYPE_ORDER.filter((type) => usedTypes.has(type)).map((type) => ({
    type,
    ...TYPE_FOLDER[type],
  }));

  // A root note carrying an unrecognized type has no folder to move into; leave
  // it at root rather than inventing a bucket for it.
  const plannedTypes = new Set(seedFolders.map((f) => f.type));
  const moves = rootNotes
    .filter((n) => plannedTypes.has(n.type))
    .map((n) => ({ noteId: n.id, type: n.type }));

  if (seedFolders.length === 0 || moves.length === 0) return null;

  return { folders: seedFolders, moves };
}

/**
 * How a resumed run re-finds a type-folder it created on an earlier, partial
 * attempt. The `seededType` tag is authoritative: it's stamped at creation and
 * survives the user renaming or recoloring the folder, so a resume matches
 * exactly and can't be fooled into creating a duplicate. The name check is only
 * a fallback for folders seeded before provenance existed (a partial run from an
 * older build) — those have no tag, so we recognize them the legacy way. A
 * folder tagged for a *different* type is never a match, even if names collide.
 */
function isSeedFolderFor(folder: Folder, type: NoteType): boolean {
  if (folder.seededType != null) return folder.seededType === type;
  return (
    folder.parentId === null && folder.kind !== 'study' && folder.name === TYPE_FOLDER[type].name
  );
}

export interface TypeFolderReconcile {
  /** Type-folders that don't exist yet, each carrying its final sidebar order. */
  foldersToCreate: Array<SeedFolderSpec & { order: number }>;
  /** type → id of a seed-folder that already exists from a prior partial run. */
  existingByType: Array<[NoteType, string]>;
  /** Root notes still needing a home, by the type whose folder they belong in. */
  moves: Array<{ noteId: string; type: NoteType }>;
}

/**
 * Compute the work still needed to reach the seeded end-state — every used note
 * type has its folder and every root note sits inside it — given whatever
 * already exists. On a fresh account this creates all folders and moves all
 * notes (identical to `planTypeFolderSeed`'s plan); after a partial run it fills
 * only the gaps, matching already-created folders by identity so a retry never
 * duplicates them.
 *
 * Unlike `planTypeFolderSeed`, this does NOT decide *whether* to seed — it
 * assumes the caller already has (fresh gate or resume marker). It returns
 * `null` only when nothing remains to do (no root notes to file), so the caller
 * can record completion.
 */
export function reconcileTypeFolderSeed(
  notes: Note[],
  folders: Folder[],
): TypeFolderReconcile | null {
  const folderIds = new Set(folders.map((f) => f.id));
  const rootNotes = notes.filter((n) => n.folderId === 'root' || !folderIds.has(n.folderId));

  const usedTypes = new Set(rootNotes.map((n) => n.type));
  const orderedUsedTypes = NOTE_TYPE_ORDER.filter((type) => usedTypes.has(type));

  const existingByType: Array<[NoteType, string]> = [];
  const foldersToCreate: Array<SeedFolderSpec & { order: number }> = [];
  orderedUsedTypes.forEach((type, order) => {
    const existing = folders.find((f) => isSeedFolderFor(f, type));
    if (existing) existingByType.push([type, existing.id]);
    else foldersToCreate.push({ type, ...TYPE_FOLDER[type], order });
  });

  // Same rule as the plan: only move notes whose type earns a folder; an
  // unrecognized type has no bucket and stays at root.
  const plannedTypes = new Set(orderedUsedTypes);
  const moves = rootNotes
    .filter((n) => plannedTypes.has(n.type))
    .map((n) => ({ noteId: n.id, type: n.type }));

  if (foldersToCreate.length === 0 && moves.length === 0) return null;
  return { foldersToCreate, existingByType, moves };
}
