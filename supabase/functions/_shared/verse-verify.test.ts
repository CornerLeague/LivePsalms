import { describe, it, expect } from 'vitest';
import { BOOK_TO_OSIS as CLIENT_OSIS } from '../../../src/notepad/graph/reference-parser';
import { OSIS_BOOK_MAP, parseRefToIds, verifyVerseRefs } from './verse-verify.ts';

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
      { ref: 'Psalm 23:1', status: 'found', canonicalText: 'The LORD is my shepherd' },
    ]);
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
