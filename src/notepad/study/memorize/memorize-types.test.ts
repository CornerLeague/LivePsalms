// src/notepad/study/memorize/memorize-types.test.ts
import { describe, it, expect } from 'vitest';
import { cardKey, formatCardRef } from './memorize-types';

describe('cardKey', () => {
  it('is stable and distinguishes translation', () => {
    const base = { book: 'jhn', chapter: 3, verse: 16 };
    expect(cardKey({ ...base, translation: 'BSB' })).toBe('jhn|3|16|BSB');
    expect(cardKey({ ...base, translation: 'KJV' })).not.toBe(cardKey({ ...base, translation: 'BSB' }));
  });
});

describe('formatCardRef', () => {
  it('uses the book display name', () => {
    expect(formatCardRef({ book: 'jhn', chapter: 3, verse: 16 })).toBe('John 3:16');
    expect(formatCardRef({ book: 'psa', chapter: 23, verse: 1 })).toBe('Psalm 23:1');
  });
  it('falls back to the raw abbrev for an unknown book', () => {
    expect(formatCardRef({ book: 'zzz', chapter: 1, verse: 1 })).toBe('zzz 1:1');
  });
});
