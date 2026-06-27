// scripts/ingest-interlinear.test.ts
import { describe, it, expect } from 'vitest';
import { stepRefToVerse, toInterlinearRows, extractStepRecords, resolveLanguage } from './ingest-interlinear';

describe('resolveLanguage', () => {
  it('reads INGEST_LANG and accepts each valid language', () => {
    expect(resolveLanguage({ INGEST_LANG: 'hebrew' })).toBe('hebrew');
    expect(resolveLanguage({ INGEST_LANG: 'aramaic' })).toBe('aramaic');
    expect(resolveLanguage({ INGEST_LANG: 'greek' })).toBe('greek');
  });

  it('ignores the OS LANG locale variable so an unprefixed run fails loudly, not silently', () => {
    // LANG is POSIX-reserved and almost always set by the OS (e.g. "en_US.UTF-8").
    // Keying off it would slip a locale string past the cast and fail the DB
    // language check cryptically; resolveLanguage must only read INGEST_LANG.
    expect(() => resolveLanguage({ LANG: 'en_US.UTF-8' })).toThrow(/INGEST_LANG required/);
  });

  it('throws a clear error when INGEST_LANG is missing', () => {
    expect(() => resolveLanguage({})).toThrow(/INGEST_LANG required/);
  });

  it('throws a clear error when INGEST_LANG is not a known language', () => {
    expect(() => resolveLanguage({ INGEST_LANG: 'en_US.UTF-8' })).toThrow(/must be one of/);
  });
});

describe('stepRefToVerse', () => {
  it('maps a STEPBible ref to a lowercase-OSIS verse id + position', () => {
    expect(stepRefToVerse('Gen.1.1#01=L')).toEqual({ verseId: 'gen.1.1', position: 1 });
    expect(stepRefToVerse('1Ki.8.27#14')).toEqual({ verseId: '1ki.8.27', position: 14 });
    expect(stepRefToVerse('Jhn.3.16#05')).toEqual({ verseId: 'jhn.3.16', position: 5 });
  });
  it('defaults position to 1 when no #NN suffix is present', () => {
    expect(stepRefToVerse('Psa.23.1')).toEqual({ verseId: 'psa.23.1', position: 1 });
  });
  it('reads #NN through a versification annotation and keeps the primary (English) verse', () => {
    // Where Hebrew/English numbering diverges, STEP inserts the alternate reference
    // between the verse and the #NN word index — as ( ) in TAHOT and [ ] / { } in
    // TAGNT. The leading ref is the English versification the reader uses.
    expect(stepRefToVerse('Gen.31.55(32.1)#04=L')).toEqual({ verseId: 'gen.31.55', position: 4 });
    expect(stepRefToVerse('Mat.17.14[17.15]#02=NKO')).toEqual({ verseId: 'mat.17.14', position: 2 });
    expect(stepRefToVerse('Act.19.40{19.41}#03=NKO')).toEqual({ verseId: 'act.19.40', position: 3 });
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

  it('assigns unique sequential positions per verse even when English numbering collapses Hebrew sub-verses', () => {
    // Hebrew Psalm 51's superscription is verses 1-2; English collapses both into the
    // unnumbered heading (primary verse 0), and each Hebrew sub-verse restarts #NN at 01.
    // A naive #NN→position emits duplicate (psa.51.0, 1) keys → ON CONFLICT crash on upsert.
    const rows = toInterlinearRows(
      [
        { ref: 'Psa.51.0(51.1)#01=L', original: 'a', transliteration: '', gloss: '', strongs: 'H1', morph: '' },
        { ref: 'Psa.51.0(51.1)#02=L', original: 'b', transliteration: '', gloss: '', strongs: 'H2', morph: '' },
        { ref: 'Psa.51.0(51.2)#01=L', original: 'c', transliteration: '', gloss: '', strongs: 'H3', morph: '' },
      ],
      'hebrew',
    );
    expect(rows.map((r) => ({ verse_id: r.verse_id, position: r.position }))).toEqual([
      { verse_id: 'psa.51.0', position: 1 },
      { verse_id: 'psa.51.0', position: 2 },
      { verse_id: 'psa.51.0', position: 3 },
    ]);
  });

  it('restarts position numbering at 1 for each new verse', () => {
    const rows = toInterlinearRows(
      [
        { ref: 'Gen.1.1#01=L', original: 'a', transliteration: '', gloss: '', strongs: '', morph: '' },
        { ref: 'Gen.1.1#02=L', original: 'b', transliteration: '', gloss: '', strongs: '', morph: '' },
        { ref: 'Gen.1.2#01=L', original: 'c', transliteration: '', gloss: '', strongs: '', morph: '' },
      ],
      'hebrew',
    );
    expect(rows.map((r) => [r.verse_id, r.position])).toEqual([
      ['gen.1.1', 1],
      ['gen.1.1', 2],
      ['gen.1.2', 1],
    ]);
  });
});

describe('extractStepRecords — TAHOT (Hebrew/Aramaic OT)', () => {
  // TAHOT data rows are one-field-per-column; license/header lines do not lead with a ref.
  const SAMPLE =
    'TAHOT - Translators Amalgamated Hebrew OT - License: CC BY 4.0\n' +
    '#Ref\tHebrew\tTransliteration\tTranslation\tdStrong\tGrammar\n' +
    'Gen.1.1#01=L\tבְּרֵאשִׁית\tbereshit\tIn the beginning\tH7225\tHR/Ncfsa\n' +
    'Gen.1.1#02=L\tבָּרָא\tbara\tcreated\tH1254\tHVqp3ms\n';

  it('keeps ref-led data rows and drops header/license lines', () => {
    const records = extractStepRecords(SAMPLE, 'hebrew');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ ref: 'Gen.1.1#01=L', original: 'בְּרֵאשִׁית', transliteration: 'bereshit', gloss: 'In the beginning', strongs: 'H7225', morph: 'HR/Ncfsa' });
  });
});

describe('extractStepRecords — TAGNT (Greek NT)', () => {
  // TAGNT packs columns differently from TAHOT: col[1] fuses "Greek (translit)" and
  // col[3] fuses "dStrong=Grammar" (compounds joined by " + "). col[2] is the gloss.
  const GREEK_SAMPLE =
    'TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC BY 4.0\n' +
    '#Ref\tGreek\tEnglish\tdStrong=Grammar\tDictionary\tEditions\n' +
    'Mat.1.1#01=NKO\tΒίβλος (Biblos)\t[The] book\tG0976=N-NSF\tβίβλος=book\tNA28+TR\n' +
    'Mat.1.1#02=NKO\tκἀγὼ (kagō)\tand I\tG1473=P-1NS + G2532=CONJ\tκαί=and\tNA28\n';

  it('splits the fused Greek/translit and Strong/morph columns and drops header lines', () => {
    const records = extractStepRecords(GREEK_SAMPLE, 'greek');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ ref: 'Mat.1.1#01=NKO', original: 'Βίβλος', transliteration: 'Biblos', gloss: '[The] book', strongs: 'G0976', morph: 'N-NSF' });
  });

  it('preserves compound (" + ") Strong/morph pairs without polluting the morph field', () => {
    const records = extractStepRecords(GREEK_SAMPLE, 'greek');
    expect(records[1]).toEqual({ ref: 'Mat.1.1#02=NKO', original: 'κἀγὼ', transliteration: 'kagō', gloss: 'and I', strongs: 'G1473 + G2532', morph: 'P-1NS + CONJ' });
  });
});
