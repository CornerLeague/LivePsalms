import { describe, it, expect } from 'vitest';
import { selectOfferedNotes, type RelevantNote } from './study-context.ts';

const notes: RelevantNote[] = [
  { id: 'n1', title: 'Shepherd', plaintext: 'rest as trust in God here', similarity: 0.9 },
  { id: 'n2', title: 'Psalm 23', plaintext: 'green pastures and still waters', similarity: 0.7 },
];

describe('selectOfferedNotes', () => {
  it('offers all relevant notes and includes none when includeNotes is false', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: false });
    expect(included).toEqual([]);
    expect(offered).toEqual([
      { id: 'n1', title: 'Shepherd', snippet: 'rest as trust in God here' },
      { id: 'n2', title: 'Psalm 23', snippet: 'green pastures and still waters' },
    ]);
  });
  it('includes only the requested ids and offers the rest', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: true, noteIds: ['n1'] });
    expect(included).toEqual([{ id: 'n1', title: 'Shepherd', plaintext: 'rest as trust in God here' }]);
    expect(offered).toEqual([{ id: 'n2', title: 'Psalm 23', snippet: 'green pastures and still waters' }]);
  });
  it('includes all relevant notes when includeNotes is true with no explicit ids', () => {
    const { included, offered } = selectOfferedNotes(notes, { includeNotes: true });
    expect(included.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(offered).toEqual([]);
  });
});
