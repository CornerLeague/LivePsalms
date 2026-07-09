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

// A capitalized word is a candidate invented proper noun only MID-sentence
// ("…from the Akkadian root…"). A capital at the narration's start or just after
// sentence-ending punctuation is ordinary grammar ("Formed from…", "…plural
// form. Alongside kin…") — not a proper noun. (A truly invented name that opens
// a sentence slips past here, but the human proofing gate is the real backstop;
// silently dropping grounded rows for a grammar-capital is the costlier error.)
const SENTENCE_END = /[.!?]/;
function isSentenceInitial(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(text.charAt(i))) i--;
  return i < 0 || SENTENCE_END.test(text.charAt(i));
}

export function validateGroundedNarration(development: string, record: GroundingRecord): { ok: boolean; unsupported: string[] } {
  const haystack = [record.lemma, record.root, record.rootGloss, record.bdbGloss, record.source, ...record.related.flatMap((r) => [r.word, r.gloss])].join(' ').toLowerCase();
  const unsupported: string[] = [];
  for (const m of development.matchAll(LANGUAGE_OR_PROPER)) {
    const term = m[1];
    if (ALLOWED_SENTENCE_STARTERS.has(term)) continue;
    if (m.index !== undefined && isSentenceInitial(development, m.index)) continue;
    if (!haystack.includes(term.toLowerCase())) unsupported.push(term);
  }
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}
