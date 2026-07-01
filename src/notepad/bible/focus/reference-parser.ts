// Tolerant Scripture-reference parser for the focus-list "type / paste" path.
// Resolves book names, common abbreviations, and numbered books to OSIS abbrevs
// using the canonical bible-books metadata, then parses single verses or ranges
// from a comma/newline/semicolon-separated batch. Unparseable fragments are
// reported (never throw) so the rest of a paste still adds.
import { BIBLE_BOOKS, type BibleBook, bookByAbbrev } from '../bible-books';
import { formatVerseLabel, type ScriptureRef } from './focus-list-types';

export interface ParseResult {
  refs: ScriptureRef[];
  unparsed: string[];
}

// Common abbreviations / spellings that a plain prefix match cannot resolve
// (e.g. "Jn", or ambiguous "Phil"). Keys are normalized (lowercase, no dots,
// single-spaced); values are OSIS abbrevs from bible-books.ts. Both spaced and
// unspaced numbered forms are listed so either lookup hits.
const ALIASES: Record<string, string> = {
  ge: 'gen', gen: 'gen', ex: 'exo', exo: 'exo', exod: 'exo',
  lev: 'lev', lv: 'lev', num: 'num', nm: 'num', nb: 'num',
  deut: 'deu', deu: 'deu', dt: 'deu',
  josh: 'jos', jos: 'jos', jsh: 'jos', judg: 'jdg', jdg: 'jdg', jgs: 'jdg',
  ruth: 'rut', rut: 'rut', ru: 'rut',
  '1sam': '1sa', '1 sam': '1sa', '1sa': '1sa', '1 sa': '1sa',
  '2sam': '2sa', '2 sam': '2sa', '2sa': '2sa', '2 sa': '2sa',
  '1kgs': '1ki', '1 kgs': '1ki', '1ki': '1ki', '1 ki': '1ki', '1kings': '1ki', '1 kings': '1ki',
  '2kgs': '2ki', '2 kgs': '2ki', '2ki': '2ki', '2 ki': '2ki', '2kings': '2ki', '2 kings': '2ki',
  '1chr': '1ch', '1 chr': '1ch', '1ch': '1ch', '1 ch': '1ch',
  '2chr': '2ch', '2 chr': '2ch', '2ch': '2ch', '2 ch': '2ch',
  ezr: 'ezr', neh: 'neh', est: 'est', esth: 'est',
  ps: 'psa', psa: 'psa', psalm: 'psa', psalms: 'psa', pss: 'psa',
  prov: 'pro', pro: 'pro', prv: 'pro',
  eccl: 'ecc', ecc: 'ecc', qoh: 'ecc',
  song: 'sng', sos: 'sng', sng: 'sng', 'song of songs': 'sng', 'song of solomon': 'sng', canticles: 'sng',
  isa: 'isa', is: 'isa', jer: 'jer', lam: 'lam',
  ezek: 'ezk', ezk: 'ezk', eze: 'ezk', dan: 'dan', dn: 'dan',
  hos: 'hos', joel: 'jol', jol: 'jol', amos: 'amo', amo: 'amo',
  obad: 'oba', oba: 'oba', ob: 'oba', jonah: 'jon', jon: 'jon', jnh: 'jon',
  mic: 'mic', mc: 'mic', nah: 'nam', nam: 'nam', hab: 'hab',
  zeph: 'zep', zep: 'zep', hag: 'hag', hg: 'hag',
  zech: 'zec', zec: 'zec', zch: 'zec', mal: 'mal', ml: 'mal',
  matt: 'mat', mat: 'mat', mt: 'mat', mark: 'mrk', mrk: 'mrk', mk: 'mrk', mr: 'mrk',
  luke: 'luk', luk: 'luk', lk: 'luk', john: 'jhn', jhn: 'jhn', jn: 'jhn', jo: 'jhn',
  acts: 'act', act: 'act', ac: 'act',
  rom: 'rom', rm: 'rom',
  '1cor': '1co', '1 cor': '1co', '1co': '1co', '2cor': '2co', '2 cor': '2co', '2co': '2co',
  gal: 'gal', ga: 'gal', eph: 'eph', ephes: 'eph',
  php: 'php', phil: 'php', philip: 'php', col: 'col',
  '1thess': '1th', '1 thess': '1th', '1th': '1th', '1thes': '1th', '1 thes': '1th',
  '2thess': '2th', '2 thess': '2th', '2th': '2th', '2thes': '2th', '2 thes': '2th',
  '1tim': '1ti', '1 tim': '1ti', '1ti': '1ti', '2tim': '2ti', '2 tim': '2ti', '2ti': '2ti',
  tit: 'tit', ti: 'tit', phlm: 'phm', phm: 'phm', philem: 'phm', philemon: 'phm',
  heb: 'heb', jas: 'jas', jms: 'jas', james: 'jas',
  '1pet': '1pe', '1 pet': '1pe', '1pe': '1pe', '1pt': '1pe',
  '2pet': '2pe', '2 pet': '2pe', '2pe': '2pe', '2pt': '2pe',
  '1jn': '1jn', '1 jn': '1jn', '1jhn': '1jn', '1john': '1jn', '1 john': '1jn',
  '2jn': '2jn', '2 jn': '2jn', '2john': '2jn', '2 john': '2jn',
  '3jn': '3jn', '3 jn': '3jn', '3john': '3jn', '3 john': '3jn',
  jude: 'jud', jud: 'jud', rev: 'rev', rv: 'rev', apoc: 'rev',
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

// Map smart / full-width punctuation (common from mobile keyboards and pasted
// text) to ASCII so a typed reference still parses: full-width colon, unicode
// dashes, and non-breaking / unicode spaces.
function normalizePunctuation(s: string): string {
  return s
    .replace(/\uFF1A/g, ':')                                   // full-width colon
    .replace(/[\u2010-\u2015\u2212]/g, '-')                    // hyphen / en / em / minus dashes
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' '); // nbsp + unicode spaces
}

/** Resolve a book token (name or abbreviation) to a canonical book, or null. */
function resolveBookToken(token: string): BibleBook | null {
  const n = normalize(token);
  if (!n) return null;
  // 1. Alias table (handles abbreviations + numbered variants, spaced or not).
  const abbrev = ALIASES[n] ?? ALIASES[n.replace(/\s+/g, '')];
  if (abbrev) return bookByAbbrev(abbrev) ?? null;
  // 2. Exact canonical name.
  const exact = BIBLE_BOOKS.find((b) => b.name.toLowerCase() === n);
  if (exact) return exact;
  // 3. Bidirectional prefix (so "genesis"->Genesis and "psalms"->Psalm); the
  //    shortest matching name wins to keep it deterministic.
  const prefix = BIBLE_BOOKS.filter((b) => {
    const name = b.name.toLowerCase();
    return name.startsWith(n) || n.startsWith(name);
  });
  if (prefix.length > 0) return prefix.reduce((best, b) => (b.name.length < best.name.length ? b : best));
  return null;
}

// Book part (optional 1-3 prefix + letters/spaces/periods), then chapter, then an
// optional verse — separated by a space, "." or ":" — with an optional "-" end.
// Punctuation is normalized (normalizePunctuation) before this runs.
const REF_RE = /^([1-3]?\s*[a-z][a-z. ]*?)\s*(\d{1,3})(?:[\s.:]+(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?$/i;

/** Parse a string of one or more references; never throws. */
export function parseReferences(input: string): ParseResult {
  const refs: ScriptureRef[] = [];
  const unparsed: string[] = [];
  const tokens = normalizePunctuation(input).split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

  for (const token of tokens) {
    const m = REF_RE.exec(token);
    if (!m) { unparsed.push(token); continue; }

    const book = resolveBookToken(m[1]);
    const chapter = Number(m[2]);
    if (!book || chapter < 1 || chapter > book.chapterCount) { unparsed.push(token); continue; }

    // A verse is required — a chapter-only reference is not a focus-list verse.
    if (m[3] == null) { unparsed.push(token); continue; }
    const verseStart = Number(m[3]);
    const verseEnd = m[4] != null ? Number(m[4]) : verseStart;
    if (verseStart < 1 || verseEnd < verseStart) { unparsed.push(token); continue; }

    refs.push({
      book: book.abbrev,
      chapter,
      verseStart,
      verseEnd,
      label: formatVerseLabel(book.name, chapter, verseStart, verseEnd),
    });
  }

  return { refs, unparsed };
}
