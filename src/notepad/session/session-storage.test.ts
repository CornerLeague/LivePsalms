// @vitest-environment jsdom
import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import {
  loadLastNoteId,
  saveLastNoteId,
  loadEnum,
  saveEnum,
  loadBiblePassage,
  saveBiblePassage,
  hasValidStored,
  KEY_BIBLE_TRANSLATION,
} from './session-storage';

afterEach(() => {
  localStorage.clear();
});

describe('session-storage', () => {
  it('round-trips the last note id', () => {
    expect(loadLastNoteId()).toBeNull();
    saveLastNoteId('note-123');
    expect(loadLastNoteId()).toBe('note-123');
    saveLastNoteId(null);
    expect(loadLastNoteId()).toBeNull();
  });

  it('round-trips an enum value within an allow-list', () => {
    const allowed = ['notes', 'editor', 'lamplight'] as const;
    expect(loadEnum('psalms.test.tab', allowed, 'notes')).toBe('notes');
    saveEnum('psalms.test.tab', 'editor');
    expect(loadEnum('psalms.test.tab', allowed, 'notes')).toBe('editor');
  });

  it('falls back when a stored enum value is not in the allow-list', () => {
    const allowed = ['notes', 'editor'] as const;
    saveEnum('psalms.test.tab', 'garbage');
    expect(loadEnum('psalms.test.tab', allowed, 'notes')).toBe('notes');
  });

  it('round-trips a Bible passage', () => {
    expect(loadBiblePassage()).toBeNull();
    saveBiblePassage({ book: 'psa', chapter: 23 });
    expect(loadBiblePassage()).toEqual({ book: 'psa', chapter: 23 });
  });

  it('returns null for a malformed stored passage', () => {
    localStorage.setItem('psalms.bible.passage', '{not json');
    expect(loadBiblePassage()).toBeNull();
    localStorage.setItem('psalms.bible.passage', '{"book":"psa"}'); // missing chapter
    expect(loadBiblePassage()).toBeNull();
  });
});

describe('hasValidStored', () => {
  const ALLOWED = ['BSB', 'KJV', 'WEB'] as const;

  beforeEach(() => localStorage.clear());

  it('returns false when the key was never written', () => {
    expect(hasValidStored(KEY_BIBLE_TRANSLATION, ALLOWED)).toBe(false);
  });

  it('returns true once a valid value has been stored', () => {
    saveEnum(KEY_BIBLE_TRANSLATION, 'KJV');
    expect(hasValidStored(KEY_BIBLE_TRANSLATION, ALLOWED)).toBe(true);
  });

  it('returns false when the stored value is not in the allow-list (corrupt/legacy)', () => {
    saveEnum(KEY_BIBLE_TRANSLATION, 'NIV');
    expect(hasValidStored(KEY_BIBLE_TRANSLATION, ALLOWED)).toBe(false);
  });
});
