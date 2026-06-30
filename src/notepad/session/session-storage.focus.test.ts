// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadFocusMode, saveFocusMode,
  loadActiveListId, saveActiveListId,
  loadQuickListItems, saveQuickListItems,
} from './session-storage';
import type { FocusListItem } from '@/notepad/bible/focus/focus-list-types';

afterEach(() => localStorage.clear());

const item: FocusListItem = {
  id: 'i1', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16', position: 0,
};

describe('focus session persistence', () => {
  it('defaults to focus mode off and no active list', () => {
    expect(loadFocusMode()).toBe(false);
    expect(loadActiveListId()).toBeNull();
    expect(loadQuickListItems()).toEqual([]);
  });

  it('round-trips focus mode', () => {
    saveFocusMode(true);
    expect(loadFocusMode()).toBe(true);
    saveFocusMode(false);
    expect(loadFocusMode()).toBe(false);
  });

  it('round-trips the active list id', () => {
    saveActiveListId('list-7');
    expect(loadActiveListId()).toBe('list-7');
  });

  it('round-trips quick list items', () => {
    saveQuickListItems([item]);
    expect(loadQuickListItems()).toEqual([item]);
  });

  it('returns [] for corrupt quick-list json', () => {
    localStorage.setItem('psalms.bible.focus.quickList', '{not json');
    expect(loadQuickListItems()).toEqual([]);
  });
});
