import { describe, it, expect } from 'vitest';
import { BOOK_TO_OSIS as CLIENT_OSIS } from '../../../src/notepad/graph/reference-parser';
import { OSIS_BOOK_MAP, canonicalBook, parseRefToIds, verifyVerseRefs } from './verse-verify.ts';

describe('OSIS parity with client', () => {
  it('matches the client BOOK_TO_OSIS exactly', () => {
    expect(OSIS_BOOK_MAP).toEqual(CLIENT_OSIS);
  });
});

describe('parseRefToIds', () => {
  it('maps a single verse to one bible_passages id', () => {
    expect(parseRefToIds('Psalm 23:1')).toEqual(['psa.23.1']);
  });
  it('expands a range', () => {
    expect(parseRefToIds('John 3:16-17')).toEqual(['jhn.3.16', 'jhn.3.17']);
  });
  it('expands an en-dash range (common in OCR output)', () => {
    expect(parseRefToIds('John 3:16–17')).toEqual(['jhn.3.16', 'jhn.3.17']);
  });
  it('parses a multi-word, numbered book', () => {
    expect(parseRefToIds('1 John 3:16')).toEqual(['1jn.3.16']);
  });
  it('returns null on unknown book', () => {
    expect(parseRefToIds('Gandalf 1:1')).toBeNull();
  });
  it('returns null on unparseable ref', () => {
    expect(parseRefToIds('Psalm')).toBeNull();
  });
});

describe('verifyVerseRefs', () => {
  const fakeSupabase = (rowsById: Record<string, { id: string; verse_start: number; text: string }[]>) => ({
    from: (_t: string) => ({
      select: () => ({
        eq: () => ({
          in: (_c: string, ids: string[]) => ({
            order: () => Promise.resolve({
              data: ids.flatMap((id) => rowsById[id] ?? []),
              error: null,
            }),
          }),
        }),
      }),
    }),
  });

  it('flags found refs with canonical text', async () => {
    const sb = fakeSupabase({ 'psa.23.1': [{ id: 'psa.23.1', verse_start: 1, text: 'The LORD is my shepherd' }] });
    const flags = await verifyVerseRefs(sb as never, ['Psalm 23:1']);
    expect(flags).toEqual([
      { ref: 'Psalm 23:1', status: 'found', canonicalText: 'The LORD is my shepherd', translation: 'BSB' },
    ]);
  });

  it('reports the requested translation when it has the rows', async () => {
    const sb = fakeSupabase({ 'psa.23.1': [{ id: 'psa.23.1', verse_start: 1, text: 'The LORD is my shepherd' }] });
    const flags = await verifyVerseRefs(sb as never, ['Psalm 23:1'], 'KJV');
    expect(flags[0]).toMatchObject({ status: 'found', translation: 'KJV' });
  });

  it('reports BSB when the versification fallback served the text', async () => {
    // Rows exist only under BSB: a fake whose non-BSB query comes back empty.
    let calls = 0;
    const sb = {
      from: () => ({
        select: () => ({
          eq: (_c: string, t: string) => ({
            in: () => ({
              order: () => {
                calls += 1;
                return Promise.resolve({
                  data: t === 'BSB' ? [{ id: 'psa.23.1', verse_start: 1, text: 'The LORD is my shepherd' }] : [],
                  error: null,
                });
              },
            }),
          }),
        }),
      }),
    };
    const flags = await verifyVerseRefs(sb as never, ['Psalm 23:1'], 'ESV');
    expect(flags).toEqual([
      { ref: 'Psalm 23:1', status: 'found', canonicalText: 'The LORD is my shepherd', translation: 'BSB' },
    ]);
    expect(calls).toBe(2);
  });

  it('flags refs with zero rows as not_found', async () => {
    const sb = fakeSupabase({});
    const flags = await verifyVerseRefs(sb as never, ['Psalm 151:1']);
    expect(flags).toEqual([{ ref: 'Psalm 151:1', status: 'not_found' }]);
  });

  it('skips unparseable refs (no flag)', async () => {
    const sb = fakeSupabase({});
    const flags = await verifyVerseRefs(sb as never, ['just a thought']);
    expect(flags).toEqual([]);
  });
});

// ── Slice 1d: OSIS book codes ────────────────────────────────────────────────
// bible_passages stores the OSIS code in its `book` column, so formatVerseRef
// yields "psa 34:18" — and that is the exact form the devotion pipeline puts in
// allowedVerseRefs and hands to the model. The parser only understood full book
// names, so those refs parsed to nothing and were silently skipped. Verification
// then had no flag to read. Found by the first live eval run.

describe('parseRefToIds — OSIS book codes', () => {
  it('parses the OSIS form that bible_passages actually produces', () => {
    expect(parseRefToIds('psa 34:18')).toEqual(['psa.34.18']);
  });

  it('still parses full book names', () => {
    expect(parseRefToIds('Psalm 34:18')).toEqual(['psa.34.18']);
    expect(parseRefToIds('Psalms 34:18')).toEqual(['psa.34.18']);
  });

  it('parses numbered-book OSIS codes', () => {
    expect(parseRefToIds('1jn 4:8')).toEqual(['1jn.4.8']);
    expect(parseRefToIds('2co 5:17')).toEqual(['2co.5.17']);
  });

  it('is case-insensitive on the OSIS code', () => {
    expect(parseRefToIds('PSA 34:18')).toEqual(['psa.34.18']);
  });

  it('expands an OSIS-form range', () => {
    expect(parseRefToIds('psa 34:18-19')).toEqual(['psa.34.18', 'psa.34.19']);
  });

  it('still returns null for a book that does not exist', () => {
    expect(parseRefToIds('phl 4:6')).toBeNull();   // Philippians is 'php'
    expect(parseRefToIds('Hezekiah 3:16')).toBeNull();
  });
});

describe('canonicalBook', () => {
  // Exported so scripture-verify can stop keeping a narrower copy. That copy
  // knew display names only, so "Heb 11:1" resolved through parseRefToIds and
  // was reported as a fabricated citation in the same pass.
  it('accepts display names, abbreviations, and OSIS codes alike', () => {
    expect(canonicalBook('Hebrews')).toBe('Hebrews');
    expect(canonicalBook('Heb')).toBe('Hebrews');
    expect(canonicalBook('heb')).toBe('Hebrews');
  });

  it('applies the alias table', () => {
    expect(canonicalBook('Psalm')).toBe('Psalms');
  });

  it('rejects a book that does not exist', () => {
    expect(canonicalBook('Hesitations')).toBeNull();
    expect(canonicalBook('')).toBeNull();
  });

  it('agrees with parseRefToIds, which is the divergence that caused the bug', () => {
    for (const form of ['Hebrews 11:1', 'Heb 11:1', 'heb 11:1']) {
      const book = form.replace(/\s+\d+:\d+$/, '');
      expect(canonicalBook(book)).not.toBeNull();
      expect(parseRefToIds(form)).toEqual(['heb.11.1']);
    }
  });
});
