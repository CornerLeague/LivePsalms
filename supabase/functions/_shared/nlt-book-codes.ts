// App OSIS book codes ↔ the NLT API's book identifiers.
//
// bible_passages (and every id in the app) uses the 3-letter lowercase OSIS
// code from src/notepad/bible/bible-books.ts. The NLT API (api.nlt.to) speaks
// two other vocabularies:
//   - `ref`:  the abbreviation accepted in a request, e.g. "Ps.23", "1Sam.1",
//             "Phlm.1". Case-insensitive. Several natural spellings are NOT
//             accepted ("Psa", "1Thess", "1John", "exo"), so this is a lookup
//             table, not a rename.
//   - `code`: the identifier the response markup carries in
//             <verse_export orig="psal_23_1" bk="psal">, used to check that
//             the passage that came back is the one that was asked for.
// Every row was verified against the live API on 2026-09-02 (chapter 1 of
// each book, anonymous tier). Job's code really is three letters.

export interface NltBook {
  /** Request abbreviation for the `ref` query parameter. */
  ref: string;
  /** Book identifier the response uses in verse_export/@bk and @orig. */
  code: string;
}

export const NLT_BOOKS: Readonly<Record<string, NltBook>> = {
  gen: { ref: 'Gen', code: 'gene' },
  exo: { ref: 'Exod', code: 'exod' },
  lev: { ref: 'Lev', code: 'levi' },
  num: { ref: 'Num', code: 'numb' },
  deu: { ref: 'Deut', code: 'deut' },
  jos: { ref: 'Josh', code: 'josh' },
  jdg: { ref: 'Judg', code: 'judg' },
  rut: { ref: 'Ruth', code: 'ruth' },
  '1sa': { ref: '1Sam', code: 'sam1' },
  '2sa': { ref: '2Sam', code: 'sam2' },
  '1ki': { ref: '1Kgs', code: 'kgs1' },
  '2ki': { ref: '2Kgs', code: 'kgs2' },
  '1ch': { ref: '1Chr', code: 'chr1' },
  '2ch': { ref: '2Chr', code: 'chr2' },
  ezr: { ref: 'Ezra', code: 'ezra' },
  neh: { ref: 'Neh', code: 'nehe' },
  est: { ref: 'Esth', code: 'esth' },
  job: { ref: 'Job', code: 'job' },
  psa: { ref: 'Ps', code: 'psal' },
  pro: { ref: 'Prov', code: 'prov' },
  ecc: { ref: 'Eccl', code: 'eccl' },
  sng: { ref: 'Song', code: 'song' },
  isa: { ref: 'Isa', code: 'isai' },
  jer: { ref: 'Jer', code: 'jere' },
  lam: { ref: 'Lam', code: 'lame' },
  ezk: { ref: 'Ezek', code: 'ezek' },
  dan: { ref: 'Dan', code: 'dani' },
  hos: { ref: 'Hos', code: 'hose' },
  jol: { ref: 'Joel', code: 'joel' },
  amo: { ref: 'Amos', code: 'amos' },
  oba: { ref: 'Obad', code: 'obad' },
  jon: { ref: 'Jonah', code: 'jona' },
  mic: { ref: 'Mic', code: 'mica' },
  nam: { ref: 'Nah', code: 'nahu' },
  hab: { ref: 'Hab', code: 'haba' },
  zep: { ref: 'Zeph', code: 'zeph' },
  hag: { ref: 'Hag', code: 'hagg' },
  zec: { ref: 'Zech', code: 'zech' },
  mal: { ref: 'Mal', code: 'mala' },
  mat: { ref: 'Matt', code: 'matt' },
  mrk: { ref: 'Mark', code: 'mark' },
  luk: { ref: 'Luke', code: 'luke' },
  jhn: { ref: 'John', code: 'john' },
  act: { ref: 'Acts', code: 'acts' },
  rom: { ref: 'Rom', code: 'roma' },
  '1co': { ref: '1Cor', code: 'cor1' },
  '2co': { ref: '2Cor', code: 'cor2' },
  gal: { ref: 'Gal', code: 'gala' },
  eph: { ref: 'Eph', code: 'ephe' },
  php: { ref: 'Phil', code: 'phil' },
  col: { ref: 'Col', code: 'colo' },
  '1th': { ref: '1Thes', code: 'the1' },
  '2th': { ref: '2Thes', code: 'the2' },
  '1ti': { ref: '1Tim', code: 'tim1' },
  '2ti': { ref: '2Tim', code: 'tim2' },
  tit: { ref: 'Titus', code: 'titu' },
  phm: { ref: 'Phlm', code: 'phlm' },
  heb: { ref: 'Heb', code: 'hebr' },
  jas: { ref: 'Jas', code: 'jame' },
  '1pe': { ref: '1Pet', code: 'pet1' },
  '2pe': { ref: '2Pet', code: 'pet2' },
  '1jn': { ref: '1Jn', code: 'joh1' },
  '2jn': { ref: '2Jn', code: 'joh2' },
  '3jn': { ref: '3Jn', code: 'joh3' },
  jud: { ref: 'Jude', code: 'jude' },
  rev: { ref: 'Rev', code: 'reve' },
};

const OSIS_BY_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(NLT_BOOKS).map(([osis, b]) => [b.code, osis]),
);

/** App OSIS code → NLT request abbreviation, or null for an unknown book. */
export function nltRefForBook(osis: string): string | null {
  return NLT_BOOKS[osis.trim().toLowerCase()]?.ref ?? null;
}

/** NLT response book code (verse_export/@bk) → app OSIS code, or null. */
export function osisForNltCode(code: string): string | null {
  return OSIS_BY_CODE.get(code.trim().toLowerCase()) ?? null;
}
