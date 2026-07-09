export interface LexiconEntry {
  lemma: string;
  derivation: string;
  root: string;
  rootGloss: string;
  bdbGloss: string;
  related: Array<{ strongs: string; word: string; gloss: string }>;
}

export interface GroundingRecord {
  strongs: string;
  lemma: string;
  root: string;
  rootGloss: string;
  bdbGloss: string;
  related: Array<{ strongs: string; word: string; gloss: string }>;
  source: string;
}

export function buildGroundingRecord(strongs: string, lexicon: Record<string, LexiconEntry>): GroundingRecord {
  const e = lexicon[strongs];
  if (!e) throw new Error(`no lexicon entry for ${strongs}`);
  return {
    strongs, lemma: e.lemma, root: e.root, rootGloss: e.rootGloss, bdbGloss: e.bdbGloss,
    related: e.related, source: "Strong's + BDB",
  };
}

// The §9 grounding check: every capitalized proper noun / language name in the
// narration must appear somewhere in the grounding record. Catches invented
// cognates ("Akkadian", "Ugaritic", place/deity names) the lexicon never asserted.
const LANGUAGE_OR_PROPER = /\b([A-Z][a-z]{3,})\b/g;
const ALLOWED_SENTENCE_STARTERS = new Set(['From', 'The', 'It', 'This', 'A', 'An', 'In', 'Its', 'When', 'Here', 'Both', 'As']);

export function validateGroundedNarration(development: string, record: GroundingRecord): { ok: boolean; unsupported: string[] } {
  const haystack = [record.lemma, record.root, record.rootGloss, record.bdbGloss, ...record.related.flatMap((r) => [r.word, r.gloss])].join(' ').toLowerCase();
  const unsupported: string[] = [];
  for (const m of development.matchAll(LANGUAGE_OR_PROPER)) {
    const term = m[1];
    if (ALLOWED_SENTENCE_STARTERS.has(term)) continue;
    if (!haystack.includes(term.toLowerCase())) unsupported.push(term);
  }
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}
