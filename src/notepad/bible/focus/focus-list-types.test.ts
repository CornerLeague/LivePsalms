import { describe, it, expect } from 'vitest';
import { formatVerseLabel, QUICK_LIST_ID } from './focus-list-types';

describe('formatVerseLabel', () => {
  it('formats a single verse as "Name chapter:verse"', () => {
    expect(formatVerseLabel('Ephesians', 2, 8, 8)).toBe('Ephesians 2:8');
  });

  it('formats a range as "Name chapter:start-end"', () => {
    expect(formatVerseLabel('Psalm', 23, 1, 3)).toBe('Psalm 23:1-3');
  });

  it('treats verseEnd === verseStart as a single verse (no range dash)', () => {
    expect(formatVerseLabel('John', 3, 16, 16)).toBe('John 3:16');
  });
});

describe('QUICK_LIST_ID', () => {
  it('is a stable sentinel string', () => {
    expect(QUICK_LIST_ID).toBe('__quick__');
  });
});
