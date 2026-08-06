// supabase/functions/_shared/verse-verify.ts
//
// Verify detected verse references against bible_passages. Cross-runtime mirror
// of the client's BOOK_TO_OSIS (src/notepad/graph/reference-parser.ts); a parity
// test asserts they stay identical. Verification is enhancement, never a hard
// dependency — callers treat a throw as "skipped".

export interface VerseFlag {
  ref: string;
  status: 'found' | 'not_found';
  canonicalText?: string;
}

// Keep identical to BOOK_TO_OSIS in src/notepad/graph/reference-parser.ts.
export const OSIS_BOOK_MAP: Record<string, string> = {
  'Genesis': 'gen', 'Exodus': 'exo', 'Leviticus': 'lev', 'Numbers': 'num',
  'Deuteronomy': 'deu', 'Joshua': 'jos', 'Judges': 'jdg', 'Ruth': 'rut',
  '1 Samuel': '1sa', '2 Samuel': '2sa', '1 Kings': '1ki', '2 Kings': '2ki',
  '1 Chronicles': '1ch', '2 Chronicles': '2ch', 'Ezra': 'ezr', 'Nehemiah': 'neh',
  'Esther': 'est', 'Job': 'job', 'Psalms': 'psa', 'Proverbs': 'pro',
  'Ecclesiastes': 'ecc', 'Song of Solomon': 'sng', 'Isaiah': 'isa', 'Jeremiah': 'jer',
  'Lamentations': 'lam', 'Ezekiel': 'ezk', 'Daniel': 'dan', 'Hosea': 'hos',
  'Joel': 'jol', 'Amos': 'amo', 'Obadiah': 'oba', 'Jonah': 'jon',
  'Micah': 'mic', 'Nahum': 'nam', 'Habakkuk': 'hab', 'Zephaniah': 'zep',
  'Haggai': 'hag', 'Zechariah': 'zec', 'Malachi': 'mal',
  'Matthew': 'mat', 'Mark': 'mrk', 'Luke': 'luk', 'John': 'jhn',
  'Acts': 'act', 'Romans': 'rom', '1 Corinthians': '1co', '2 Corinthians': '2co',
  'Galatians': 'gal', 'Ephesians': 'eph', 'Philippians': 'php', 'Colossians': 'col',
  '1 Thessalonians': '1th', '2 Thessalonians': '2th', '1 Timothy': '1ti', '2 Timothy': '2ti',
  'Titus': 'tit', 'Philemon': 'phm', 'Hebrews': 'heb', 'James': 'jas',
  '1 Peter': '1pe', '2 Peter': '2pe', '1 John': '1jn', '2 John': '2jn',
  '3 John': '3jn', 'Jude': 'jud', 'Revelation': 'rev',
};

// Accept "Psalm" (singular) as an alias of the canonical "Psalms". This map is
// exact-case only; the case-insensitive scan in canonicalBook() handles all
// other casing variants (e.g. OCR output like "psalm 23:1").
// Exported for scripture-verify.ts, which scans prose for refs and needs the
// same alternation of accepted book spellings. No behavior change here.
export const BOOK_ALIASES: Record<string, string> = { 'Psalm': 'Psalms' };

const REF_RE = /^(.+?)\s+(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/;

// OSIS code → canonical book name. bible_passages stores the CODE in its `book`
// column, so formatVerseRef produces "psa 34:18" — the exact form the devotion
// pipeline puts in allowedVerseRefs and hands to the model. Without this the
// parser skipped those refs entirely and Scripture verification had nothing to
// check. (Found by the first live eval run, 2026-08-05.)
const OSIS_TO_BOOK: Record<string, string> = Object.fromEntries(
  Object.entries(OSIS_BOOK_MAP).map(([name, osis]) => [osis, name]),
);

/** OSIS code → canonical book name ('psa' → 'Psalms'); null when unknown. */
export function osisToBookName(code: string): string | null {
  return OSIS_TO_BOOK[code.trim().toLowerCase()] ?? null;
}

/**
 * Book text → canonical display name, accepting display names, aliases, and
 * OSIS codes alike ('Hebrews', 'Heb', 'heb'). Exported because scripture-verify
 * kept its own narrower copy that knew only display names, so a reply citing
 * "Heb 11:1" was resolvable here and "fabricated" there at the same time.
 */
export function canonicalBook(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const aliased = BOOK_ALIASES[collapsed] ?? collapsed;
  for (const key of Object.keys(OSIS_BOOK_MAP)) {
    if (key.toLowerCase() === aliased.toLowerCase()) return key;
  }
  return OSIS_TO_BOOK[collapsed.toLowerCase()] ?? null;
}

/** Parse "Psalm 23:1" → ['psa.23.1']; ranges expand. Null if unparseable/unknown. */
export function parseRefToIds(ref: string): string[] | null {
  const m = ref.trim().match(REF_RE);
  if (!m) return null;
  const book = canonicalBook(m[1]);
  if (!book) return null;
  const osis = OSIS_BOOK_MAP[book];
  const chapter = parseInt(m[2], 10);
  const start = parseInt(m[3], 10);
  const end = m[4] ? parseInt(m[4], 10) : start;
  if (end < start) return null;
  const ids: string[] = [];
  for (let v = start; v <= end; v++) ids.push(`${osis}.${chapter}.${v}`);
  return ids;
}

type _VerifyQueryBuilder = {
  in(col: string, ids: string[]): {
    order(col: string, opts: { ascending: boolean }): Promise<{
      data: { id: string; verse_start: number; text: string }[] | null;
      error: { message: string } | null;
    }>;
  };
};

interface MinimalSupabase {
  from(table: 'bible_passages'): {
    select(cols: string): {
      eq(col: string, val: string): _VerifyQueryBuilder;
      in(col: string, ids: string[]): {
        order(col: string, opts: { ascending: boolean }): Promise<{
          data: { id: string; verse_start: number; text: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * For each ref: 'found' (with joined canonical text) when bible_passages has the
 * rows, else 'not_found'. Unparseable/unknown-book refs are silently skipped
 * (no flag). Lookups run per-ref so one bad ref can't poison the others.
 *
 * translation defaults to 'BSB'. When a non-BSB translation is requested and
 * returns no rows, the lookup retries with 'BSB' (versification fallback) before
 * marking the ref not_found.
 */
export async function verifyVerseRefs(
  supabase: MinimalSupabase,
  refs: string[],
  translation = 'BSB',
): Promise<VerseFlag[]> {
  const queryForTranslation = async (
    ids: string[],
    t: string,
  ): Promise<{ id: string; verse_start: number; text: string }[]> => {
    const { data, error } = await supabase
      .from('bible_passages')
      .select('id, verse_start, text')
      .eq('translation', t)
      .in('id', ids)
      .order('verse_start', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const flags: VerseFlag[] = [];
  for (const ref of refs) {
    const ids = parseRefToIds(ref);
    if (!ids) continue;

    let data = await queryForTranslation(ids, translation);

    // Versification fallback: if the chosen translation has no rows, try BSB.
    if (data.length === 0 && translation !== 'BSB') {
      data = await queryForTranslation(ids, 'BSB');
    }

    if (data.length === 0) {
      flags.push({ ref, status: 'not_found' });
      continue;
    }
    const canonicalText = data.map((r) => r.text ?? '').join(' ').trim();
    flags.push({ ref, status: 'found', canonicalText });
  }
  return flags;
}
