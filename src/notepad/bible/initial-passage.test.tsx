// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { loadInitialPassage, DEFAULT_PASSAGE } from './initial-passage';
import { saveBiblePassage } from '@/notepad/session/session-storage';

afterEach(() => {
  localStorage.clear();
});

describe('loadInitialPassage', () => {
  it('returns the stored passage when the book is real and the chapter is in range', () => {
    saveBiblePassage({ book: 'psa', chapter: 23 });
    expect(loadInitialPassage()).toEqual({ book: 'psa', chapter: 23 });
  });

  it('falls back to John 1 when nothing is stored', () => {
    expect(loadInitialPassage()).toEqual(DEFAULT_PASSAGE);
    expect(DEFAULT_PASSAGE).toEqual({ book: 'jhn', chapter: 1 });
  });

  it('falls back to John 1 when the stored book is not a real abbreviation', () => {
    saveBiblePassage({ book: 'zzz', chapter: 1 });
    expect(loadInitialPassage()).toEqual({ book: 'jhn', chapter: 1 });
  });

  it('falls back to John 1 when the stored chapter is out of range for the book', () => {
    saveBiblePassage({ book: 'jhn', chapter: 99 }); // John has 21 chapters
    expect(loadInitialPassage()).toEqual({ book: 'jhn', chapter: 1 });
  });

  it('falls back to John 1 when the stored chapter is below 1', () => {
    saveBiblePassage({ book: 'jhn', chapter: 0 });
    expect(loadInitialPassage()).toEqual({ book: 'jhn', chapter: 1 });
  });

  it('returns a fresh object so callers cannot mutate the shared default', () => {
    const a = loadInitialPassage();
    a.chapter = 5;
    expect(loadInitialPassage()).toEqual({ book: 'jhn', chapter: 1 });
  });
});
