import { describe, it, expect, vi } from 'vitest';
import {
  extractQuotedSpans,
  normalizeForMatch,
  tokenOverlap,
  tokenContainment,
  isNearMiss,
  verifyArtifactScripture,
  verifyVerseField,
} from './scripture-verify.ts';
import type { VerseFlag } from './verse-verify.ts';

const PS23 = 'The LORD is my shepherd; I shall not want. He makes me lie down in green pastures.';

describe('extractQuotedSpans', () => {
  it('finds a quoted span with a trailing parenthetical ref', () => {
    const text = `He wrote "The LORD is my shepherd, I shall not want" (Psalm 23:1) that morning.`;
    const spans = extractQuotedSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].quote).toBe('The LORD is my shepherd, I shall not want');
    expect(spans[0].ref).toBe('Psalm 23:1');
  });

  it('finds a quoted span introduced by a leading ref', () => {
    const text = `Psalm 23:1 says "The LORD is my shepherd, I shall not want" to the weary.`;
    const spans = extractQuotedSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].ref).toBe('Psalm 23:1');
  });

  it('handles curly quotes', () => {
    const text = `“The LORD is my shepherd, I shall not want” (Psalm 23:1).`;
    const spans = extractQuotedSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].quote).toBe('The LORD is my shepherd, I shall not want');
  });

  it('ignores quoted fragments shorter than six words (ordinary emphasis, not quotation)', () => {
    const text = `The word "shall not want" here (Psalm 23:1) carries weight.`;
    expect(extractQuotedSpans(text)).toEqual([]);
  });

  it('skips a quoted span with no ref nearby — we cannot verify what we cannot resolve', () => {
    const text = `She said "I have been weary for a long while now" and closed the book.`;
    expect(extractQuotedSpans(text)).toEqual([]);
  });

  it('returns offsets that address the quote content, so a repair can splice precisely', () => {
    const text = `He wrote "The LORD is my shepherd, I shall not want" (Psalm 23:1).`;
    const [span] = extractQuotedSpans(text);
    expect(text.slice(span.start, span.end)).toBe(span.quote);
    const spliced = text.slice(0, span.start) + 'CANON' + text.slice(span.end);
    expect(spliced).toBe(`He wrote "CANON" (Psalm 23:1).`);
  });

  it('finds several spans in one text, in document order', () => {
    const text =
      `First "The LORD is my shepherd, I shall not want" (Psalm 23:1), ` +
      `then "For God so loved the world that he gave" (John 3:16).`;
    const spans = extractQuotedSpans(text);
    expect(spans.map((s) => s.ref)).toEqual(['Psalm 23:1', 'John 3:16']);
    expect(spans[0].start).toBeLessThan(spans[1].start);
  });

  it('accepts the singular "Psalm" and a verse range', () => {
    const text = `"He makes me lie down in green pastures beside still waters" (Psalm 23:1-2).`;
    expect(extractQuotedSpans(text)[0].ref).toBe('Psalm 23:1-2');
  });

  it('returns [] for text with no quotes at all', () => {
    expect(extractQuotedSpans('Psalm 23:1 is a comfort to many readers.')).toEqual([]);
  });

  it('does not pair a quote with a ref that is far away in the sentence', () => {
    const text =
      `"The LORD is my shepherd, I shall not want" and then a long stretch of prose ` +
      `about weariness and rest and the shape of an ordinary week, ending at Psalm 23:1.`;
    expect(extractQuotedSpans(text)).toEqual([]);
  });
});

describe('normalizeForMatch', () => {
  it('lowercases, strips punctuation and smart quotes, and collapses whitespace', () => {
    expect(normalizeForMatch('  The LORD’s—"shepherd";  I   shall not want!  '))
      .toBe('the lords shepherd i shall not want');
  });

  it('leaves word order intact', () => {
    expect(normalizeForMatch('shepherd my is LORD the')).toBe('shepherd my is lord the');
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeForMatch('—;:"…')).toBe('');
  });
});

describe('tokenOverlap', () => {
  it('scores identical strings 1', () => {
    expect(tokenOverlap(PS23, PS23)).toBe(1);
  });

  it('scores a one-word difference in a twenty-word verse at or above the repair threshold', () => {
    const canonical = 'one two three four five six seven eight nine ten ' +
      'eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    const nearMiss = canonical.replace('twenty', 'WRONG');
    expect(tokenOverlap(nearMiss, canonical)).toBeGreaterThanOrEqual(0.9);
  });

  it('scores an unrelated sentence below 0.5', () => {
    expect(tokenOverlap('the quick brown fox jumped over a sleeping dog', PS23)).toBeLessThan(0.5);
  });

  it('scores 0 against an empty canonical string without dividing by zero', () => {
    expect(tokenOverlap(PS23, '')).toBe(0);
    expect(tokenOverlap('', '')).toBe(0);
  });

  it('is symmetric, so an over-long quote is penalised like a truncated one', () => {
    const half = 'The LORD is my shepherd; I shall not want.';
    expect(tokenOverlap(half, PS23)).toBeCloseTo(tokenOverlap(PS23, half), 12);
  });

  it('ignores case and punctuation differences', () => {
    expect(tokenOverlap('the lord is my shepherd i shall not want', 'The LORD is my shepherd; I shall not want!')).toBe(1);
  });
});

describe('tokenContainment', () => {
  it('scores a faithful partial quote 1 — quoting half a verse is not an error', () => {
    expect(tokenContainment('The LORD is my shepherd; I shall not want.', PS23)).toBe(1);
  });

  it('scores a fabricated quote low even when it is the right length', () => {
    expect(tokenContainment('The LORD is my fortress and my exceedingly great reward', PS23)).toBeLessThan(0.7);
  });

  it('scores 0 against an empty canonical string without dividing by zero', () => {
    expect(tokenContainment(PS23, '')).toBe(0);
    expect(tokenContainment('', PS23)).toBe(0);
  });

  it('counts repeats as a multiset, so padding a quote with one canonical word does not mask fabrication', () => {
    // 'shepherd' appears once in canonical; claiming it three times is not containment.
    expect(tokenContainment('shepherd shepherd shepherd', 'my shepherd')).toBeCloseTo(1 / 3, 12);
  });
});

describe('isNearMiss', () => {
  // The regression that motivated a length-aware rule: Psalm 23:1 is nine
  // tokens, so a single wrong word scores 0.889 on Dice. A flat 0.9 threshold
  // would have rejected the commonest near-miss instead of repairing it.
  it('repairs a one-word slip in a SHORT verse', () => {
    expect(isNearMiss('The LORD is my shepherd; I shall not lack.', 'The LORD is my shepherd; I shall not want.')).toBe(true);
  });

  it('repairs a one-word slip in a long verse', () => {
    const canonical = 'one two three four five six seven eight nine ten eleven twelve ' +
      'thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    expect(isNearMiss(canonical.replace('twenty', 'WRONG'), canonical)).toBe(true);
  });

  it('does not treat a deliberate excerpt as a near-miss', () => {
    expect(isNearMiss('The LORD is my shepherd; I shall not want.', PS23)).toBe(false);
  });

  it('does not treat a fabrication of similar length as a near-miss', () => {
    expect(isNearMiss('The LORD is my fortress and my exceedingly great reward', PS23)).toBe(false);
  });

  it('is false against empty input', () => {
    expect(isNearMiss('', PS23)).toBe(false);
    expect(isNearMiss(PS23, '')).toBe(false);
  });
});

// ── Task 2: verifyArtifactScripture ──────────────────────────────────────────

const PS23_1 = 'The LORD is my shepherd; I shall not want.';

interface LookupState {
  verifyRefs: (refs: string[], translation: string) => Promise<VerseFlag[]>;
  calls: number;
  refsSeen: string[][];
  translationSeen: string[];
}

function makeLookup(opts: {
  canonical?: Record<string, string>;
  notFound?: string[];
  throws?: boolean;
} = {}): LookupState {
  const canonical = opts.canonical ?? { 'Psalm 23:1': PS23_1 };
  const notFound = new Set(opts.notFound ?? []);
  const state: LookupState = {
    verifyRefs: null as never,
    calls: 0,
    refsSeen: [],
    translationSeen: [],
  };
  state.verifyRefs = async (refs, translation) => {
    state.calls++;
    state.refsSeen.push(refs);
    state.translationSeen.push(translation);
    if (opts.throws) throw new Error('bible_passages unavailable');
    return refs.map((ref): VerseFlag =>
      notFound.has(ref) || !canonical[ref]
        ? { ref, status: 'not_found' }
        : { ref, status: 'found', canonicalText: canonical[ref] });
  };
  return state;
}

const ARGS = { translation: 'BSB' };

describe('verifyArtifactScripture', () => {
  it('passes a correct quote with no violations and no repair', async () => {
    const lookup = makeLookup();
    const text = `He returns to it often: "${PS23_1}" (Psalm 23:1).`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.repairs).toEqual([]);
    expect(result.repairedText ?? text).toBe(text);
  });

  it('repairs a near-miss quote to the canonical rendering and reports the repair', async () => {
    const lookup = makeLookup();
    const text = `As it says, "The LORD is my shepherd; I shall not lack." (Psalm 23:1)`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.repairs).toEqual([
      { ref: 'Psalm 23:1', from: 'The LORD is my shepherd; I shall not lack.', to: PS23_1 },
    ]);
    expect(result.repairedText).toBe(`As it says, "${PS23_1}" (Psalm 23:1)`);
  });

  it('flags a wrong-verse quote as quote_mismatch rather than repairing it', async () => {
    const lookup = makeLookup();
    const text = `He claims "the fear of the LORD is the beginning of riches" (Psalm 23:1).`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { family: 'scripture', rule: 'quote_mismatch', snippet: 'the fear of the LORD is the beginning of riches' },
    ]);
    expect(result.repairs).toEqual([]);
  });

  it('leaves a faithful partial quote alone — quoting half a verse is not an error', async () => {
    const lookup = makeLookup({ canonical: { 'Psalm 23:1': `${PS23_1} He makes me lie down in green pastures.` } });
    const text = `The line "${PS23_1}" (Psalm 23:1) is the whole argument.`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.repairs).toEqual([]);   // NOT rewritten into the full verse
  });

  it('flags a ref that resolves to nothing as unresolvable_ref', async () => {
    const lookup = makeLookup({ notFound: ['Philippians 5:13'] });
    const text = 'He leans on Philippians 5:13 for that.';
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { family: 'scripture', rule: 'unresolvable_ref', snippet: 'Philippians 5:13' },
    ]);
  });

  it('flags a quotation attributed to a book that does not exist', async () => {
    const lookup = makeLookup();
    const text = `He wrote "and the walls of the city were made of pure gold" (2 Hezekiah 3:16).`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { family: 'scripture', rule: 'unresolvable_ref', snippet: '2 Hezekiah 3:16' },
    ]);
  });

  it('splices multiple repairs correctly (right-to-left, so earlier offsets stay valid)', async () => {
    const jhn = 'For God so loved the world that He gave His one and only Son.';
    const lookup = makeLookup({ canonical: { 'Psalm 23:1': PS23_1, 'John 3:16': jhn } });
    const text =
      `First "The LORD is my shepherd; I shall not lack." (Psalm 23:1), ` +
      `then "For God so loved the world that He gave His only Son." (John 3:16).`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(true);
    expect(result.repairs.map((r) => r.ref)).toEqual(['Psalm 23:1', 'John 3:16']);
    expect(result.repairedText).toBe(`First "${PS23_1}" (Psalm 23:1), then "${jhn}" (John 3:16).`);
  });

  it('treats a thrown lookup as skipped — verification is enhancement, never a dependency', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lookup = makeLookup({ throws: true });
    const text = `He wrote "The LORD is my shepherd; I shall not lack." (Psalm 23:1).`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.repairs).toEqual([]);
    expect(result.repairedText).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('short-circuits without calling the lookup when the text carries no refs', async () => {
    const lookup = makeLookup();
    const result = await verifyArtifactScripture(
      { verifyRefs: lookup.verifyRefs },
      { ...ARGS, text: 'A quiet paragraph about weariness with nothing to verify.' },
    );
    expect(result.ok).toBe(true);
    expect(lookup.calls).toBe(0);
  });

  it('looks each distinct ref up once, passing the translation through', async () => {
    const lookup = makeLookup();
    const text = `"${PS23_1}" (Psalm 23:1) and again Psalm 23:1 later.`;
    await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { text, translation: 'KJV' });
    expect(lookup.calls).toBe(1);
    expect(lookup.refsSeen[0]).toEqual(['Psalm 23:1']);
    expect(lookup.translationSeen[0]).toBe('KJV');
  });

  it('reports both a repair and a violation from the same text', async () => {
    const lookup = makeLookup({ notFound: ['Philippians 5:13'] });
    const text =
      `"The LORD is my shepherd; I shall not lack." (Psalm 23:1) — and see Philippians 5:13.`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.ok).toBe(false);
    expect(result.repairs).toHaveLength(1);
    expect(result.violations.map((v) => v.rule)).toEqual(['unresolvable_ref']);
    // The repair still lands, so a retry starts from corrected text.
    expect(result.repairedText).toContain(PS23_1);
  });

  it('skips quote matching for a ref that did not resolve', async () => {
    const lookup = makeLookup({ notFound: ['Psalm 23:1'] });
    const text = `He wrote "something entirely unlike the psalm in question here" (Psalm 23:1).`;
    const result = await verifyArtifactScripture({ verifyRefs: lookup.verifyRefs }, { ...ARGS, text });
    expect(result.violations.map((v) => v.rule)).toEqual(['unresolvable_ref']);
  });
});

// ── Structured verse fields ──────────────────────────────────────────────────
// The devotion's scripture.text is the highest-value target in the product —
// it is the verse the reader actually SEES — but it is a bare field beside its
// ref, not a quotation inside prose, so extractQuotedSpans cannot reach it.

describe('verifyVerseField', () => {
  it('passes a verbatim verse', async () => {
    const lookup = makeLookup();
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: 'Psalm 23:1', text: PS23_1, translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(result.repairedText).toBeUndefined();
    expect(result.violations).toEqual([]);
  });

  it('repairs a paraphrased verse to the canonical rendering', async () => {
    const lookup = makeLookup();
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not lack.', translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(result.repairedText).toBe(PS23_1);
    expect(result.repairs).toEqual([
      { ref: 'Psalm 23:1', from: 'The LORD is my shepherd; I shall not lack.', to: PS23_1 },
    ]);
  });

  it('flags a wholly wrong verse text as quote_mismatch', async () => {
    const lookup = makeLookup();
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: 'Psalm 23:1', text: 'In the beginning God created the heavens and the earth.', translation: 'BSB' },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual(['quote_mismatch']);
  });

  it('flags an unresolvable ref', async () => {
    const lookup = makeLookup({ notFound: ['Philippians 5:13'] });
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: 'Philippians 5:13', text: 'I can do all things.', translation: 'BSB' },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual(['unresolvable_ref']);
  });

  it('repairs a TRUNCATED verse — a field is supposed to carry the whole verse', async () => {
    // Unlike a prose quotation, where a partial quote is a legitimate excerpt,
    // scripture.text is contracted to be the full passage.
    const full = `${PS23_1} He makes me lie down in green pastures.`;
    const lookup = makeLookup({ canonical: { 'Psalm 23:1': full } });
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: 'Psalm 23:1', text: PS23_1, translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(result.repairedText).toBe(full);
  });

  it('treats a thrown lookup as skipped', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lookup = makeLookup({ throws: true });
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: 'Psalm 23:1', text: 'anything at all', translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    err.mockRestore();
  });

  it('skips silently when the ref is blank', async () => {
    const lookup = makeLookup();
    const result = await verifyVerseField(
      { verifyRefs: lookup.verifyRefs },
      { ref: '', text: 'anything', translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(lookup.calls).toBe(0);
  });
});

describe('verifyVerseField — unverifiable is not invalid', () => {
  // THE BUG the first live eval found: verifyVerseRefs silently SKIPS a ref it
  // cannot parse (returning no flag for it), which is different from finding
  // that the ref does not exist. Reading "no flag" as unresolvable_ref turned
  // "we could not check this" into "this is wrong" — and would have failed
  // every devotion in production, since production refs are the OSIS form.
  it('passes when the lookup returns no flag at all (ref was skipped)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await verifyVerseField(
      { verifyRefs: async () => [] },
      { ref: 'psa 34:18', text: 'The LORD is near to the brokenhearted.', translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.repairs).toEqual([]);
    err.mockRestore();
  });

  it('still flags a ref the lookup explicitly reports as not_found', async () => {
    const result = await verifyVerseField(
      { verifyRefs: async (refs) => refs.map((ref) => ({ ref, status: 'not_found' as const })) },
      { ref: 'Philippians 5:13', text: 'I can do all things.', translation: 'BSB' },
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual(['unresolvable_ref']);
  });

  it('ignores a flag for a different ref rather than mistaking it for this one', async () => {
    const result = await verifyVerseField(
      { verifyRefs: async () => [{ ref: 'Psalm 23:1', status: 'found', canonicalText: 'x' }] },
      { ref: 'psa 34:18', text: 'The LORD is near to the brokenhearted.', translation: 'BSB' },
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
