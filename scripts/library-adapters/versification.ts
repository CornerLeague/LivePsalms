// scripts/library-adapters/versification.ts
//
// Normalizes a source's verse refs into the app's canonical (BSB / English)
// versification, so a commentary's anchors join cleanly against bible_passages.
//
// SCOPE DECISION (slice 1b): this is NOT the full STEPBible TVTMS table, and it
// deliberately isn't. Our v1 commentary sources (Matthew Henry, JFB, Spurgeon)
// are all KJV-versified, and KJV shares the English verse tradition BSB uses —
// so for them normalization is identity, and the real guard is the acceptance
// query that asserts every anchored chunk resolves against bible_passages.
// What IS implemented is the hebrew→english mapping, because that is where the
// genuine, well-documented shifts live and it is what a Hebrew-versified source
// (or a TAHOT-derived one) would need. Adding full TVTMS is a drop-in
// replacement for this module's data table if a source ever needs it.
//
// Every delta carries a `note` explaining itself — this file is the record of
// WHY a ref moved, not just that it did.

import { BIBLE_BOOKS } from '../../src/notepad/bible/bible-books';
import type { VersificationScheme } from './types';

const KNOWN_BOOKS = new Set(BIBLE_BOOKS.map((b) => b.abbrev));

export interface ParsedRef {
  book: string;      // lowercase OSIS/abbrev, e.g. 'psa'
  chapter: number;
  verse?: number;    // absent for chapter-level refs
}

/**
 * Psalms whose Hebrew text counts the superscription as verse 1 (offset 1) or
 * as verses 1-2 (offset 2). English numbering excludes it. Source: the standard
 * MT-vs-English psalm superscription tables; the two-line group is the set with
 * both an ascription and a historical note (e.g. "To the choirmaster… when
 * Nathan the prophet came to him").
 */
const PSALM_OFFSET_2 = new Set([51, 52, 54, 60]);
const PSALM_OFFSET_1 = new Set([
  3, 4, 5, 6, 7, 8, 9, 12, 13, 18, 19, 20, 21, 22, 30, 31, 34, 36, 38, 39, 40,
  41, 42, 44, 45, 46, 47, 48, 49, 53, 55, 56, 57, 58, 59, 61, 62, 63, 64, 65,
  67, 68, 69, 70, 75, 76, 77, 80, 81, 83, 84, 85, 88, 89, 92, 102, 108, 140, 142,
]);

export interface VersificationDelta {
  book: string;
  note: string;
  /** Maps a hebrew (chapter, verse) to the english one; null when unmapped. */
  map: (chapter: number, verse?: number) => { chapter: number; verse?: number } | null;
}

export const HEBREW_TO_ENGLISH_DELTAS: VersificationDelta[] = [
  {
    book: 'psa',
    note: 'Hebrew counts the psalm superscription as verse 1 (or 1-2); English does not.',
    map: (chapter, verse) => {
      if (verse === undefined) return { chapter };
      const offset = PSALM_OFFSET_2.has(chapter) ? 2 : PSALM_OFFSET_1.has(chapter) ? 1 : 0;
      const shifted = verse - offset;
      // A ref pointing AT the superscription has no English verse equivalent;
      // clamp to verse 1 rather than emitting a 0 or negative.
      return { chapter, verse: shifted < 1 ? 1 : shifted };
    },
  },
  {
    book: 'jol',
    note: 'Hebrew Joel has 4 chapters; English has 3. Hebrew 3:1-5 == English 2:28-32; Hebrew 4 == English 3.',
    map: (chapter, verse) => {
      if (chapter === 3) return verse === undefined ? { chapter: 2 } : { chapter: 2, verse: verse + 27 };
      if (chapter === 4) return verse === undefined ? { chapter: 3 } : { chapter: 3, verse };
      return { chapter, verse };
    },
  },
  {
    book: 'mal',
    note: 'Hebrew Malachi has 3 chapters; English has 4. Hebrew 3:19-24 == English 4:1-6.',
    map: (chapter, verse) => {
      if (chapter === 3 && verse !== undefined && verse >= 19) {
        return { chapter: 4, verse: verse - 18 };
      }
      return { chapter, verse };
    },
  },
];

const DELTA_BY_BOOK = new Map(HEBREW_TO_ENGLISH_DELTAS.map((d) => [d.book, d]));

/**
 * Normalize a ref from its source tradition into canonical English/BSB
 * numbering. Throws on an unknown book or a non-positive chapter/verse — a
 * silently-dropped ref would surface later as a chunk that anchors to nothing,
 * which is far harder to debug than a loud ingest failure.
 */
export function normalizeRef(ref: ParsedRef, scheme: VersificationScheme): ParsedRef {
  if (!KNOWN_BOOKS.has(ref.book)) {
    throw new Error(`versification: unknown book code "${ref.book}"`);
  }
  if (!Number.isInteger(ref.chapter) || ref.chapter < 1) {
    throw new Error(`versification: invalid chapter ${ref.chapter} for ${ref.book}`);
  }
  if (ref.verse !== undefined && (!Number.isInteger(ref.verse) || ref.verse < 1)) {
    throw new Error(`versification: invalid verse ${ref.verse} for ${ref.book} ${ref.chapter}`);
  }

  if (scheme === 'english') return { ...ref };

  const delta = DELTA_BY_BOOK.get(ref.book);
  if (!delta) return { ...ref };

  const mapped = delta.map(ref.chapter, ref.verse);
  if (!mapped) return { ...ref };
  return mapped.verse === undefined
    ? { book: ref.book, chapter: mapped.chapter }
    : { book: ref.book, chapter: mapped.chapter, verse: mapped.verse };
}
