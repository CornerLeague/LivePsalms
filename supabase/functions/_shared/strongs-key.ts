// Raw STEPBible dStrong → OpenScriptures bible_strongs key, for the Deno edge
// runtime. This is the _shared duplicate of src/notepad/study/lexicon/
// normalizeStrongs.ts (which edge functions cannot import); the two are kept in
// lockstep by a parity test in strongs-key.test.ts that imports both.
//
// The join this makes possible is not optional: bible_interlinear stores raw
// dStrong values (zero-padded, with disambiguation suffixes and Hebrew prefix
// chains) while bible_strongs stores bare keys. Joined raw, nothing matches —
// which is exactly how slice 1c's first live run produced an empty lexicon
// block on every chapter.

/** Normalize a raw STEPBible dStrong value to an OpenScriptures bible_strongs key. */
export function normalizeStrongs(raw: string): string {
  let token = raw.trim();
  if (!token) return '';

  // Greek compounds ("G1473 + G2532"): the primary sense is the first number.
  if (token.includes('+')) token = token.split('+')[0].trim();

  // Hebrew prefix chains ("H9003/{H7225G}"): the lexical root is the braced token;
  // STEP prefix codes (H9xxx) carry no OpenScriptures entry. With a slash but no
  // braces, the root trails the prefix, so take the last segment.
  const braced = token.match(/\{([^}]+)\}/);
  if (braced) token = braced[1].trim();
  else if (token.includes('/')) token = (token.split('/').pop() ?? '').trim();

  // Canonical shape: prefix letter, digits, optional single trailing suffix letter.
  const m = token.match(/^([HhGg])(\d+)[A-Za-z]?$/);
  if (!m) return '';

  const prefix = m[1].toUpperCase();
  const number = String(parseInt(m[2], 10)); // un-pad leading zeros
  return `${prefix}${number}`;
}
