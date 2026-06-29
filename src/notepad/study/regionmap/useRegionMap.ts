// Pure resolver (named use* by convention; calls no hooks). Maps a book abbrev
// to its curated RegionMap, or null when the book has no mapped region.
import { BOOK_TO_REGION_MAP } from './book-region-map';
import { REGION_MAPS, type RegionMap } from './region-maps';

export function useRegionMap(book: string): RegionMap | null {
  const key = BOOK_TO_REGION_MAP[book];
  if (!key) return null;
  return REGION_MAPS[key] ?? null;
}
