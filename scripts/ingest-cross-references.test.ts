import { describe, it, expect } from 'vitest';
import { parseCrossRefLine } from './ingest-cross-references';

describe('parseCrossRefLine', () => {
  it('parses an OpenBible TSV row into a normalized cross-ref', () => {
    // OpenBible format: "From Verse\tTo Verse\tVotes" with OSIS refs like "Gen.1.1"
    const row = parseCrossRefLine('Gen.1.1\tJohn.1.1-John.1.3\t72');
    expect(row).toEqual({
      from_book: 'gen', from_chapter: 1, from_verse: 1,
      to_book: 'jhn', to_chapter: 1, to_verse_start: 1, to_verse_end: 3,
      votes: 72, crosses_testament: true,
    });
  });
  it('parses a single-verse target (no range)', () => {
    const row = parseCrossRefLine('Isa.53.5\t1Pet.2.24\t40');
    expect(row).toMatchObject({
      from_book: 'isa', to_book: '1pe', to_verse_start: 24, to_verse_end: 24,
      crosses_testament: true,
    });
  });
  it('returns null for the header row and malformed lines', () => {
    expect(parseCrossRefLine('From Verse\tTo Verse\tVotes')).toBeNull();
    expect(parseCrossRefLine('garbage')).toBeNull();
  });
});
