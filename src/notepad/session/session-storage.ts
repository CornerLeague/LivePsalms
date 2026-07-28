import type { FocusListItem } from '@/notepad/bible/focus/focus-list-types';
import type { MemorizeCard } from '@/notepad/study/memorize/memorize-types';

// Per-device session state persisted to localStorage so the app can return the
// user to where they left off after a refresh or sign-out/sign-in. All reads and
// writes are guarded — a disabled/full localStorage degrades to "no memory"
// rather than throwing.

const KEY_LAST_NOTE = 'psalms.session.lastNoteId';
const KEY_MOBILE_TAB = 'psalms.session.mobileTab';
const KEY_EDITOR_TAB = 'psalms.session.editorTab';
const KEY_STUDY_TAB = 'psalms.session.studyTab';
const KEY_BIBLE_PASSAGE = 'psalms.bible.passage';
const KEY_BIBLE_TRANSLATION = 'psalms.bible.translation';
const KEY_BIBLE_VERSE_LAYOUT = 'psalms.bible.verseLayout';
const KEY_TEXT_SIZE = 'psalms.textSize';
const KEY_THEME = 'psalms.session.theme';
const KEY_MOBILE_STUDY_TAB = 'psalms.session.mobileStudyTab';
const KEY_FOCUS_MODE = 'psalms.bible.focus.mode';
const KEY_FOCUS_ACTIVE_LIST = 'psalms.bible.focus.activeListId';
const KEY_QUICK_LIST = 'psalms.bible.focus.quickList';
const KEY_MEMORIZE_CARDS = 'psalms.memorize.cards';
// Suffixed with the adapter's scopeId — see hasSeededTypeFolders.
const KEY_TYPE_FOLDER_SEED = 'psalms.notepad.typeFolderSeed';

export {
  KEY_LAST_NOTE,
  KEY_MOBILE_TAB,
  KEY_EDITOR_TAB,
  KEY_STUDY_TAB,
  KEY_BIBLE_TRANSLATION,
  KEY_BIBLE_VERSE_LAYOUT,
  KEY_TEXT_SIZE,
  KEY_THEME,
  KEY_MOBILE_STUDY_TAB,
  KEY_FOCUS_MODE,
  KEY_FOCUS_ACTIVE_LIST,
  KEY_QUICK_LIST,
  KEY_MEMORIZE_CARDS,
};

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore — persistence is best-effort
  }
}

export function loadLastNoteId(): string | null {
  return readRaw(KEY_LAST_NOTE);
}

export function saveLastNoteId(id: string | null): void {
  writeRaw(KEY_LAST_NOTE, id);
}

// Generic enum persistence with an allow-list guard so a stale/garbage value
// never selects an invalid view.
export function loadEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = readRaw(key);
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function saveEnum(key: string, value: string): void {
  writeRaw(key, value);
}

/**
 * True iff this key holds a value that is a member of `allowed` — a VALID stored
 * pick, not merely any string. A corrupt/legacy value (present but not in the
 * allow-list) returns false so the caller treats it as absent and can re-seed.
 */
export function hasValidStored(key: string, allowed: readonly string[]): boolean {
  const raw = readRaw(key);
  return raw != null && allowed.includes(raw);
}

export interface StoredPassage {
  book: string;
  chapter: number;
}

export function loadBiblePassage(): StoredPassage | null {
  const raw = readRaw(KEY_BIBLE_PASSAGE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as StoredPassage).book === 'string' &&
      typeof (parsed as StoredPassage).chapter === 'number'
    ) {
      return { book: (parsed as StoredPassage).book, chapter: (parsed as StoredPassage).chapter };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBiblePassage(passage: StoredPassage): void {
  writeRaw(KEY_BIBLE_PASSAGE, JSON.stringify(passage));
}

export function loadFocusMode(): boolean {
  return readRaw(KEY_FOCUS_MODE) === '1';
}
export function saveFocusMode(on: boolean): void {
  writeRaw(KEY_FOCUS_MODE, on ? '1' : '0');
}

export function loadActiveListId(): string | null {
  return readRaw(KEY_FOCUS_ACTIVE_LIST);
}
export function saveActiveListId(id: string | null): void {
  writeRaw(KEY_FOCUS_ACTIVE_LIST, id);
}

export function loadQuickListItems(): FocusListItem[] {
  const raw = readRaw(KEY_QUICK_LIST);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FocusListItem[]) : [];
  } catch {
    return [];
  }
}
export function saveQuickListItems(items: FocusListItem[]): void {
  writeRaw(KEY_QUICK_LIST, JSON.stringify(items));
}

export function loadMemorizeCards(): MemorizeCard[] {
  const raw = readRaw(KEY_MEMORIZE_CARDS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MemorizeCard[]) : [];
  } catch {
    return [];
  }
}

export function saveMemorizeCards(cards: MemorizeCard[]): void {
  writeRaw(KEY_MEMORIZE_CARDS, JSON.stringify(cards));
}

/**
 * Records that the type-folder backfill has run for an account, so a user who
 * later deletes every seeded folder (which returns their notes to root) isn't
 * handed the same folders again on the next load. Keyed by the adapter's
 * `scopeId` so signing into a different account doesn't inherit the mark.
 *
 * Per-device, like everything else here: a second device re-runs the check, but
 * by then the account has folders and the backfill declines on its own.
 */
export function hasSeededTypeFolders(scopeId: string): boolean {
  return readRaw(`${KEY_TYPE_FOLDER_SEED}.${scopeId}`) === '1';
}

export function markSeededTypeFolders(scopeId: string): void {
  writeRaw(`${KEY_TYPE_FOLDER_SEED}.${scopeId}`, '1');
}
