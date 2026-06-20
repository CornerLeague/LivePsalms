import { describe, it, expect } from 'vitest';
import { crossesTestament, groupSameAuthor } from './apparatus-queries';

describe('crossesTestament (frontend)', () => {
  it('detects OT<->NT spans by book abbrev', () => {
    expect(crossesTestament('isa', 'mat')).toBe(true);
    expect(crossesTestament('gen', 'exo')).toBe(false);
  });
});

describe('groupSameAuthor', () => {
  it('groups books that share an author, excluding the current book', () => {
    const rows = [
      { book: 'luk', author: 'Luke', full_name: 'Luke' },
      { book: 'act', author: 'Luke', full_name: 'Acts' },
      { book: 'rom', author: 'Paul', full_name: 'Romans' },
    ];
    expect(groupSameAuthor(rows, 'luk')).toEqual([{ book: 'act', author: 'Luke', full_name: 'Acts' }]);
  });
});
