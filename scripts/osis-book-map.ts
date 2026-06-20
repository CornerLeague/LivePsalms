// scripts/osis-book-map.ts
// OpenBible OSIS abbreviation -> lowercase `book` code (matches bible_passages.book).
import { BIBLE_BOOKS } from '../src/notepad/bible/bible-books';

const TESTAMENT = new Map(BIBLE_BOOKS.map((b) => [b.abbrev, b.testament]));

// OSIS token -> our abbrev. Complete all 66 from the OpenBible OSIS scheme.
const OSIS_TO_ABBREV: Record<string, string> = {
  Gen: 'gen', Exod: 'exo', Lev: 'lev', Num: 'num', Deut: 'deu', Josh: 'jos',
  Judg: 'jdg', Ruth: 'rut', '1Sam': '1sa', '2Sam': '2sa', '1Kgs': '1ki', '2Kgs': '2ki',
  '1Chr': '1ch', '2Chr': '2ch', Ezra: 'ezr', Neh: 'neh', Esth: 'est', Job: 'job',
  Ps: 'psa', Prov: 'pro', Eccl: 'ecc', Song: 'sng', Isa: 'isa', Jer: 'jer',
  Lam: 'lam', Ezek: 'ezk', Dan: 'dan', Hos: 'hos', Joel: 'jol', Amos: 'amo',
  Obad: 'oba', Jonah: 'jon', Mic: 'mic', Nah: 'nam', Hab: 'hab', Zeph: 'zep',
  Hag: 'hag', Zech: 'zec', Mal: 'mal', Matt: 'mat', Mark: 'mrk', Luke: 'luk',
  John: 'jhn', Acts: 'act', Rom: 'rom', '1Cor': '1co', '2Cor': '2co', Gal: 'gal',
  Eph: 'eph', Phil: 'php', Col: 'col', '1Thess': '1th', '2Thess': '2th',
  '1Tim': '1ti', '2Tim': '2ti', Titus: 'tit', Phlm: 'phm', Heb: 'heb', Jas: 'jas',
  '1Pet': '1pe', '2Pet': '2pe', '1John': '1jn', '2John': '2jn', '3John': '3jn',
  Jude: 'jud', Rev: 'rev',
};

export function osisToBook(osis: string): string | null {
  return OSIS_TO_ABBREV[osis] ?? null;
}

export function crossesTestament(fromBook: string, toBook: string): boolean {
  const a = TESTAMENT.get(fromBook);
  const b = TESTAMENT.get(toBook);
  if (!a || !b) return false;
  return a !== b;
}
