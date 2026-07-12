// @vitest-environment jsdom
// src/notepad/session/session-storage.memorize.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadMemorizeCards, saveMemorizeCards, KEY_MEMORIZE_CARDS } from './session-storage';
import type { MemorizeCard } from '@/notepad/study/memorize/memorize-types';

const card: MemorizeCard = {
  id: 'g-1', book: 'jhn', chapter: 3, verse: 16, translation: 'BSB',
  text: 'For God so loved…', mastery: 0, attempts: 0, lastPracticedAt: null, position: 0,
};

describe('memorize guest storage', () => {
  beforeEach(() => localStorage.clear());

  it('returns [] when nothing is stored', () => {
    expect(loadMemorizeCards()).toEqual([]);
  });

  it('round-trips saved cards', () => {
    saveMemorizeCards([card]);
    expect(loadMemorizeCards()).toEqual([card]);
  });

  it('returns [] on a corrupt (non-array) value', () => {
    localStorage.setItem(KEY_MEMORIZE_CARDS, '{"not":"an array"}');
    expect(loadMemorizeCards()).toEqual([]);
  });
});
