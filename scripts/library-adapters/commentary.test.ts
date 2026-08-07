import { describe, it, expect } from 'vitest';
import { parseHeadingRef, parseEntryLine, makeCommentaryAdapter, TREASURY_OF_DAVID, MATTHEW_HENRY_CONCISE, JAMIESON_FAUSSET_BROWN, stripGenevaVerseText, WESLEY_NOTES, ADAM_CLARKE, CALVIN_COMMENTARIES, CATENA_AUREA, GENEVA_NOTES } from './commentary';
import { MAX_TOKENS } from '../../supabase/functions/_shared/chunker';

describe('parseHeadingRef', () => {
  it('parses a single-verse ref', () => {
    expect(parseHeadingRef('Psalm 27:4')).toEqual({ book: 'psa', chapter: 27, verse_start: 4, verse_end: 4 });
  });

  it('parses a verse range, including en/em dashes', () => {
    expect(parseHeadingRef('Psalm 27:4-6')).toEqual({ book: 'psa', chapter: 27, verse_start: 4, verse_end: 6 });
    expect(parseHeadingRef('Psalm 27:4–6')).toEqual({ book: 'psa', chapter: 27, verse_start: 4, verse_end: 6 });
  });

  it('parses a chapter-level ref with no verse', () => {
    expect(parseHeadingRef('Psalm 27')).toEqual({ book: 'psa', chapter: 27 });
  });

  it('accepts the singular "Psalm" alias', () => {
    expect(parseHeadingRef('Psalms 23:1')?.book).toBe('psa');
    expect(parseHeadingRef('Psalm 23:1')?.book).toBe('psa');
  });

  it('prefers the LONGEST book match so numbered and compound names win', () => {
    expect(parseHeadingRef('1 John 4:8')?.book).toBe('1jn');
    expect(parseHeadingRef('John 4:8')?.book).toBe('jhn');
    expect(parseHeadingRef('Song of Solomon 2:1')?.book).toBe('sng');
    expect(parseHeadingRef('1 Corinthians 13:1')?.book).toBe('1co');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseHeadingRef('  psalm   27:4 ')).toEqual({ book: 'psa', chapter: 27, verse_start: 4, verse_end: 4 });
  });

  it('returns null for front matter with no reference', () => {
    expect(parseHeadingRef('Preface to the Second Edition')).toBeNull();
    expect(parseHeadingRef('')).toBeNull();
  });

  it('returns null for a backwards range', () => {
    expect(parseHeadingRef('Psalm 27:9-4')).toBeNull();
  });
});

describe('parseEntryLine', () => {
  it('parses a well-formed JSONL line', () => {
    expect(parseEntryLine('{"ref":"Psalm 27:4","body":"One thing have I desired."}'))
      .toEqual({ ref: 'Psalm 27:4', body: 'One thing have I desired.' });
  });

  it('skips blank lines', () => {
    expect(parseEntryLine('')).toBeNull();
    expect(parseEntryLine('   ')).toBeNull();
  });

  it('throws on a line missing ref or body rather than silently dropping it', () => {
    expect(() => parseEntryLine('{"ref":"Psalm 27:4"}')).toThrow(/missing ref\/body/);
    expect(() => parseEntryLine('{"body":"orphan"}')).toThrow(/missing ref\/body/);
  });
});

describe('commentary adapter.parse', () => {
  const jsonl = [
    '{"ref":"Psalm 27:4","body":"One thing have I desired of the LORD. The psalmist names a single want."}',
    '{"ref":"Psalm 27:5-6","body":"For in the time of trouble he shall hide me. A pavilion is a royal tent."}',
    '{"ref":"Preface","body":"This work was many years in the making."}',
    '',
  ].join('\n');

  it('emits one chunk per anchored section with the right verse anchors', () => {
    const rows = TREASURY_OF_DAVID.parse(jsonl);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source_id: 'treasury-of-david', book: 'psa', chapter: 27, verse_start: 4, verse_end: 4,
      heading: 'Psalm 27:4',
    });
    expect(rows[1]).toMatchObject({ book: 'psa', chapter: 27, verse_start: 5, verse_end: 6 });
  });

  it('skips unanchored front matter rather than storing it unanchored', () => {
    const rows = TREASURY_OF_DAVID.parse(jsonl);
    expect(rows.some((r) => r.heading === 'Preface')).toBe(false);
  });

  it('prefixes the embedded content with author, era, and ref', () => {
    const rows = TREASURY_OF_DAVID.parse(jsonl);
    expect(rows[0].content).toContain('Charles H. Spurgeon, 1869–1885 — on Psalm 27:4:');
    expect(rows[0].content).toContain('One thing have I desired');
  });

  it('splits an oversize section into numbered headings that stay unique', () => {
    const big = Array.from({ length: 200 }, (_, i) => `Sentence ${i} about the verse at hand.`).join(' ');
    const rows = TREASURY_OF_DAVID.parse(`{"ref":"Psalm 27:4","body":${JSON.stringify(big)}}`);
    expect(rows.length).toBeGreaterThan(1);
    const headings = rows.map((r) => r.heading);
    expect(new Set(headings).size).toBe(headings.length);      // unique → idempotency key holds
    expect(headings[0]).toBe(`Psalm 27:4 (1/${rows.length})`);
    for (const r of rows) {
      expect(r.token_count).toBeLessThanOrEqual(MAX_TOKENS);
      expect(r.verse_start).toBe(4);                            // one anchor across the split
    }
  });

  it('drops a section whose body is blank', () => {
    expect(TREASURY_OF_DAVID.parse('{"ref":"Psalm 27:4","body":"   "}')).toEqual([]);
  });

  it('applies the source versification scheme to the anchor', () => {
    const hebrewAdapter = makeCommentaryAdapter({
      scheme: 'hebrew',
      source: { ...TREASURY_OF_DAVID.source, id: 'hebrew-test' },
    });
    // Hebrew Ps 51:3 == English Ps 51:1
    const rows = hebrewAdapter.parse('{"ref":"Psalm 51:3","body":"Have mercy upon me, O God."}');
    expect(rows[0]).toMatchObject({ chapter: 51, verse_start: 1 });
    // ...but the HEADING keeps the source's own label, so provenance stays honest.
    expect(rows[0].heading).toBe('Psalm 51:3');
  });

  it('ships three configured sources with verified attribution strings', () => {
    for (const a of [TREASURY_OF_DAVID, MATTHEW_HENRY_CONCISE, JAMIESON_FAUSSET_BROWN]) {
      expect(a.source.license).toBe('Public domain');
      expect(a.source.attribution.length).toBeGreaterThan(20);
      expect(a.source.attribution).toContain(a.source.era);
    }
    expect(TREASURY_OF_DAVID.source.register).toBe('devotional');
    expect(JAMIESON_FAUSSET_BROWN.source.register).toBe('exegetical');
  });
});

// ── Phase A1 sources ─────────────────────────────────────────────────────────

describe('stripGenevaVerseText', () => {
  it('drops the verse text and keeps the glosses', () => {
    const body = 'And the earth was {b} without form, and void. (b) As an unformed lump. (c) Darkness covered the deep.';
    expect(stripGenevaVerseText(body)).toBe('(b) As an unformed lump. (c) Darkness covered the deep.');
  });

  it('handles NUMERIC markers, not just letters', () => {
    // Genesis 6:16 really is `{1}` / `(1)`. Matching [a-z] only would have left
    // ~1,700 entries un-stripped, silently duplicating Scripture into the corpus.
    const body = 'with {1} lower, second, and third stories shalt thou make it. (1) That is, of three heights.';
    expect(stripGenevaVerseText(body)).toBe('(1) That is, of three heights.');
  });

  it('LOAD-BEARING: keeps "The Argument" when it precedes the first note', () => {
    // 28 of the 35 book prefaces sit before the first marker. Cutting at the
    // marker would delete the best summary Geneva has for that book.
    const body = 'In the {a} beginning God created the heaven. The Argument - Moses declares three things. (a) First the world.';
    const out = stripGenevaVerseText(body);
    expect(out.startsWith('The Argument')).toBe(true);
    expect(out).toContain('(a) First the world.');
    expect(out).not.toContain('In the {a} beginning');
  });

  it('falls back to the {x}-repeat form when there is no (x) marker', () => {
    const body = 'the {i} voice of thy brother crieth from the ground. {i} God avenges the wrongs against his saints.';
    expect(stripGenevaVerseText(body)).toBe('{i} God avenges the wrongs against his saints.');
  });

  it('returns an unmarked body untouched rather than guessing', () => {
    const body = 'A verse with no marginal note at all.';
    expect(stripGenevaVerseText(body)).toBe(body);
  });

  it('does not mistake a single {x} anchor for a note prefix', () => {
    const body = 'Oh that my grief were laid in the {a} balances together!';
    expect(stripGenevaVerseText(body)).toBe(body);
  });
});

describe('Phase A1 source rows', () => {
  const A1 = [WESLEY_NOTES, ADAM_CLARKE, CALVIN_COMMENTARIES, CATENA_AUREA, GENEVA_NOTES];

  it('gives every source a distinct id, and none collides with the v1 three', () => {
    const ids = [TREASURY_OF_DAVID, MATTHEW_HENRY_CONCISE, JAMIESON_FAUSSET_BROWN, ...A1].map((a) => a.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('broadens the corpus beyond one tradition, which is the whole point of A1', () => {
    const traditions = new Set(A1.map((a) => a.source.tradition));
    expect(traditions.size).toBeGreaterThanOrEqual(4);
    expect([...traditions]).toContain('Patristic (Catholic compilation)');
  });

  it('gives `confessional` its first member', () => {
    // The register existed in the type but had no source; Door 2's theology
    // section is meant to bias it.
    expect(GENEVA_NOTES.source.register).toBe('confessional');
  });

  it('records Geneva\'s license honestly — by age, not by a declaration that does not exist', () => {
    expect(GENEVA_NOTES.source.license).toMatch(/by age/i);
    expect(GENEVA_NOTES.source.license).toMatch(/declares no license/i);
  });

  it('carries a render-ready attribution naming the author, a date and the licence', () => {
    // Shown VERBATIM on the Sources screen, so it must stand alone. Catena
    // deliberately cites its 1841 TRANSLATION date rather than Aquinas's
    // 1263 composition — the year that matters for a public-domain claim is
    // the one attached to the text we actually hold.
    for (const a of A1) {
      expect(a.source.attribution).toContain(a.source.title);
      expect(a.source.attribution).toMatch(/1[0-9]{3}/);
      expect(a.source.attribution).toMatch(/[Pp]ublic domain/);
    }
  });

  it('only Geneva rewrites its bodies', () => {
    const withNote = 'Text {a} here. (a) The note.';
    expect(GENEVA_NOTES.parse(JSON.stringify({ ref: 'Psalm 27:1', body: withNote }))[0].content)
      .not.toContain('Text {a} here.');
    expect(WESLEY_NOTES.parse(JSON.stringify({ ref: 'Psalm 27:1', body: withNote }))[0].content)
      .toContain('Text');
  });
});
