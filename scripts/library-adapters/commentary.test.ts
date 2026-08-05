import { describe, it, expect } from 'vitest';
import {
  parseHeadingRef, parseEntryLine, makeCommentaryAdapter,
  TREASURY_OF_DAVID, MATTHEW_HENRY_CONCISE, JAMIESON_FAUSSET_BROWN,
} from './commentary';
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
