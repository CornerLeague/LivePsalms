// Types + the persistence contract for Scripture Focus Lists. Items are
// translation-agnostic: they store the reference + a denormalized display label,
// never verse text (text is fetched live per the active translation).

/** Sentinel id for the unsaved, in-memory Quick list. */
export const QUICK_LIST_ID = '__quick__';

export interface ScriptureRef {
  /** OSIS abbrev, e.g. 'eph' (see bible-books.ts). */
  book: string;
  chapter: number;
  verseStart: number;
  /** === verseStart for a single verse. */
  verseEnd: number;
  /** Denormalized display reference, e.g. 'Ephesians 2:8' or 'Psalm 23:1-3'. */
  label: string;
}

export interface FocusListItem extends ScriptureRef {
  id: string;
  position: number;
}

export interface FocusList {
  id: string;
  title: string;
  position: number;
  items: FocusListItem[];
}

/** CRUD + ordering contract. Two implementations: in-memory (tested) + Supabase. */
export interface FocusListAdapter {
  listLists(): Promise<FocusList[]>;
  createList(title: string, refs: ScriptureRef[]): Promise<FocusList>;
  deleteList(id: string): Promise<void>;
  /** Rename a saved list. */
  renameList(id: string, title: string): Promise<void>;
  /** Append items after the existing ones; `startPosition` = current item count. */
  addItems(listId: string, refs: ScriptureRef[], startPosition: number): Promise<FocusListItem[]>;
  removeItem(itemId: string): Promise<void>;
  reorderItems(listId: string, orderedItemIds: string[]): Promise<void>;
}

/** Build the denormalized display label for a reference. */
export function formatVerseLabel(
  name: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): string {
  return verseEnd > verseStart
    ? `${name} ${chapter}:${verseStart}-${verseEnd}`
    : `${name} ${chapter}:${verseStart}`;
}
