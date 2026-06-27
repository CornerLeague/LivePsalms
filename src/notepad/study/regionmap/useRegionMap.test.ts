import { describe, it, expect } from 'vitest';
import { useRegionMap } from './useRegionMap';
import { BOOK_TO_REGION_MAP } from './book-region-map';
import { REGION_MAPS } from './region-maps';

describe('useRegionMap', () => {
  it('resolves a Gospel to Roman Judea', () => {
    expect(useRegionMap('jhn')?.key).toBe('judea-roman');
    expect(useRegionMap('mat')?.key).toBe('judea-roman');
  });

  it('resolves Lamentations and Kings to the Kingdom of Judah', () => {
    expect(useRegionMap('lam')?.key).toBe('judah-monarchy');
    expect(useRegionMap('1ki')?.key).toBe('judah-monarchy');
  });

  it('returns null for an unmapped book or unknown abbrev', () => {
    expect(useRegionMap('jas')).toBeNull();
    expect(useRegionMap('zzz')).toBeNull();
  });
});

describe('BOOK_TO_REGION_MAP integrity', () => {
  it('every mapped value resolves to a registered region', () => {
    for (const [book, key] of Object.entries(BOOK_TO_REGION_MAP)) {
      expect(REGION_MAPS[key as keyof typeof REGION_MAPS], `${book} -> ${key}`).toBeDefined();
    }
  });
});
