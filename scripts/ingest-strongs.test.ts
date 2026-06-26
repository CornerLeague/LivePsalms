import { describe, it, expect } from 'vitest';
import { toStrongsRows } from './ingest-strongs';

describe('toStrongsRows', () => {
  it('maps an OpenScriptures dictionary object to bible_strongs rows', () => {
    const rows = toStrongsRows(
      {
        H430: { lemma: 'אֱלֹהִים', xlit: 'ʼĕlôhîym', pron: 'el-o-heem', strongs_def: 'gods in the ordinary sense', kjv_def: 'angels, God, gods' },
      },
      'hebrew',
    );
    expect(rows).toEqual([
      {
        strongs: 'H430',
        lemma: 'אֱלֹהִים',
        transliteration: 'ʼĕlôhîym',
        pronunciation: 'el-o-heem',
        short_def: 'gods in the ordinary sense',
        full_def: 'gods in the ordinary sense — angels, God, gods',
        language: 'hebrew',
      },
    ]);
  });

  it('reads Greek transliteration from `translit` (OpenScriptures Greek uses translit, not xlit, and has no pron)', () => {
    const rows = toStrongsRows(
      { G976: { lemma: 'βίβλος', translit: 'bíblos', strongs_def: 'a writing, i.e. a book', kjv_def: 'book' } },
      'greek',
    );
    expect(rows[0]).toEqual({
      strongs: 'G976',
      lemma: 'βίβλος',
      transliteration: 'bíblos',
      pronunciation: '',
      short_def: 'a writing, i.e. a book',
      full_def: 'a writing, i.e. a book — book',
      language: 'greek',
    });
  });

  it('tolerates missing fields with empty-string defaults', () => {
    const rows = toStrongsRows({ G25: { lemma: 'ἀγαπάω' } }, 'greek');
    expect(rows[0]).toEqual({
      strongs: 'G25',
      lemma: 'ἀγαπάω',
      transliteration: '',
      pronunciation: '',
      short_def: '',
      full_def: '',
      language: 'greek',
    });
  });
});
