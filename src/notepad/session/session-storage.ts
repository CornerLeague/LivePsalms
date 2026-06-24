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
const KEY_THEME = 'psalms.session.theme';
const KEY_MOBILE_STUDY_TAB = 'psalms.session.mobileStudyTab';

export {
  KEY_LAST_NOTE,
  KEY_MOBILE_TAB,
  KEY_EDITOR_TAB,
  KEY_STUDY_TAB,
  KEY_BIBLE_TRANSLATION,
  KEY_BIBLE_VERSE_LAYOUT,
  KEY_THEME,
  KEY_MOBILE_STUDY_TAB,
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
