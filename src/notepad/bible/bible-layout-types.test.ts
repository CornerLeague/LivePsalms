import { describe, it, expect } from 'vitest';
import {
  VERSE_LAYOUTS,
  DEFAULT_VERSE_LAYOUT,
  isVerseLayout,
  nextVerseLayout,
  VERSE_LAYOUT_LABEL,
} from './bible-layout-types';

describe('bible-layout-types', () => {
  it('exposes the three layouts in cycle order', () => {
    expect(VERSE_LAYOUTS).toEqual(['inline', 'lines', 'spaced']);
  });

  it('defaults to inline', () => {
    expect(DEFAULT_VERSE_LAYOUT).toBe('inline');
  });

  it('guards unknown values', () => {
    expect(isVerseLayout('lines')).toBe(true);
    expect(isVerseLayout('paragraph')).toBe(false);
    expect(isVerseLayout(null)).toBe(false);
    expect(isVerseLayout(undefined)).toBe(false);
  });

  it('cycles inline -> lines -> spaced -> inline', () => {
    expect(nextVerseLayout('inline')).toBe('lines');
    expect(nextVerseLayout('lines')).toBe('spaced');
    expect(nextVerseLayout('spaced')).toBe('inline');
  });

  it('has a human label for every layout', () => {
    expect(VERSE_LAYOUT_LABEL.inline).toBe('Inline');
    expect(VERSE_LAYOUT_LABEL.lines).toBe('Lines');
    expect(VERSE_LAYOUT_LABEL.spaced).toBe('Spaced');
  });
});
