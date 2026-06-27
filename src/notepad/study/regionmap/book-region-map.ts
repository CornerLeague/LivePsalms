// Explicit book(abbrev) -> region-key lookup. Deliberately NOT parsed from the
// free-text bible_books.region column. Books absent here resolve to null (no map).
// Keys are OSIS-style abbrevs from src/notepad/bible/bible-books.ts.
// Grows alongside REGION_MAPS as more regions are sourced (see asset task).
import type { RegionMapKey } from './region-maps';

export const BOOK_TO_REGION_MAP: Partial<Record<string, RegionMapKey>> = {
  // Kingdom of Judah (monarchy / exile era)
  '1ki': 'judah-monarchy',
  '2ki': 'judah-monarchy',
  '1ch': 'judah-monarchy',
  '2ch': 'judah-monarchy',
  lam: 'judah-monarchy',

  // Roman Judea & Galilee (Gospels)
  mat: 'judea-roman',
  mrk: 'judea-roman',
  luk: 'judea-roman',
  jhn: 'judea-roman',
};
