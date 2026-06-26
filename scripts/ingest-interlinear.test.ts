// scripts/ingest-interlinear.test.ts
import { describe, it, expect } from 'vitest';
import { stepRefToVerse, toInterlinearRows, extractTahotRecords } from './ingest-interlinear';

describe('stepRefToVerse', () => {
  it('maps a STEPBible ref to a lowercase-OSIS verse id + position', () => {
    expect(stepRefToVerse('Gen.1.1#01=L')).toEqual({ verseId: 'gen.1.1', position: 1 });
    expect(stepRefToVerse('1Ki.8.27#14')).toEqual({ verseId: '1ki.8.27', position: 14 });
    expect(stepRefToVerse('Jhn.3.16#05')).toEqual({ verseId: 'jhn.3.16', position: 5 });
  });
  it('defaults position to 1 when no #NN suffix is present', () => {
    expect(stepRefToVerse('Psa.23.1')).toEqual({ verseId: 'psa.23.1', position: 1 });
  });
  it('throws on an unknown book code so format drift is caught', () => {
    expect(() => stepRefToVerse('Zzz.1.1#01')).toThrow(/unknown STEPBible book code/);
  });
});

describe('toInterlinearRows', () => {
  it('maps records to DB rows and normalizes empty strongs to null', () => {
    const rows = toInterlinearRows(
      [
        { ref: 'Gen.1.1#01=L', original: 'בְּרֵאשִׁית', transliteration: 'bereshit', gloss: 'In the beginning', strongs: 'H7225', morph: 'HR/Ncfsa' },
        { ref: 'Gen.1.1#02=L', original: 'בָּרָא', transliteration: 'bara', gloss: 'created', strongs: '', morph: 'HVqp3ms' },
      ],
      'hebrew',
    );
    expect(rows).toEqual([
      { verse_id: 'gen.1.1', position: 1, original: 'בְּרֵאשִׁית', transliteration: 'bereshit', strongs: 'H7225', morph: 'HR/Ncfsa', gloss: 'In the beginning', language: 'hebrew' },
      { verse_id: 'gen.1.1', position: 2, original: 'בָּרָא', transliteration: 'bara', strongs: null, morph: 'HVqp3ms', gloss: 'created', language: 'hebrew' },
    ]);
  });
});

describe('extractTahotRecords', () => {
  // Tab-separated data rows begin with a ref token; license/header lines do not.
  const SAMPLE =
    'TAHOT - Translators Amalgamated Hebrew OT - License: CC BY 4.0\n' +
    '#Ref\tHebrew\tTransliteration\tTranslation\tdStrong\tGrammar\n' +
    'Gen.1.1#01=L\tבְּרֵאשִׁית\tbereshit\tIn the beginning\tH7225\tHR/Ncfsa\n' +
    'Gen.1.1#02=L\tבָּרָא\tbara\tcreated\tH1254\tHVqp3ms\n';

  it('keeps ref-led data rows and drops header/license lines', () => {
    const records = extractTahotRecords(SAMPLE);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ ref: 'Gen.1.1#01=L', original: 'בְּרֵאשִׁית', transliteration: 'bereshit', gloss: 'In the beginning', strongs: 'H7225', morph: 'HR/Ncfsa' });
  });
});
