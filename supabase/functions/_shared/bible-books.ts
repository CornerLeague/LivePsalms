// OSIS book code → SHORT display abbrev (AP-style), for the Deno edge runtime.
// The src/ bible-books.ts is not importable here and yields full names; this is
// the _shared duplicate (parity-tested), producing the short register the §2.2
// exemplar uses ("Ps 27:14"). Single source for the candidate builder + markers.

export const OSIS_TO_ABBREV: Record<string, string> = {
  gen: 'Gen', exo: 'Exod', lev: 'Lev', num: 'Num', deu: 'Deut',
  jos: 'Josh', jdg: 'Judg', rut: 'Ruth', '1sa': '1 Sam', '2sa': '2 Sam',
  '1ki': '1 Kgs', '2ki': '2 Kgs', '1ch': '1 Chr', '2ch': '2 Chr', ezr: 'Ezra',
  neh: 'Neh', est: 'Esth', job: 'Job', psa: 'Ps', pro: 'Prov',
  ecc: 'Eccl', sng: 'Song', isa: 'Isa', jer: 'Jer', lam: 'Lam',
  ezk: 'Ezek', dan: 'Dan', hos: 'Hos', jol: 'Joel', amo: 'Amos',
  oba: 'Obad', jon: 'Jonah', mic: 'Mic', nam: 'Nah', hab: 'Hab',
  zep: 'Zeph', hag: 'Hag', zec: 'Zech', mal: 'Mal', mat: 'Matt',
  mrk: 'Mark', luk: 'Luke', jhn: 'John', act: 'Acts', rom: 'Rom',
  '1co': '1 Cor', '2co': '2 Cor', gal: 'Gal', eph: 'Eph', php: 'Phil',
  col: 'Col', '1th': '1 Thess', '2th': '2 Thess', '1ti': '1 Tim', '2ti': '2 Tim',
  tit: 'Titus', phm: 'Phlm', heb: 'Heb', jas: 'Jas', '1pe': '1 Pet',
  '2pe': '2 Pet', '1jn': '1 John', '2jn': '2 John', '3jn': '3 John', jud: 'Jude',
  rev: 'Rev',
};

// OSIS id → display ref. `psa.27.14` → "Ps 27:14"; `jhn.10` → "John 10".
// Unknown book or book-only id → null (not a usable candidate).
export function osisRefToDisplay(osisId: string): string | null {
  const parts = osisId.split('.');
  const abbrev = OSIS_TO_ABBREV[(parts[0] ?? '').toLowerCase()];
  if (!abbrev) return null;
  if (parts.length >= 3) return `${abbrev} ${parts[1]}:${parts[2]}`; // verse-level
  if (parts.length === 2) return `${abbrev} ${parts[1]}`;            // chapter-level
  return null;                                                        // book-only
}
