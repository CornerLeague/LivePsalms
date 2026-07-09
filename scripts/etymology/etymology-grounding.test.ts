import { describe, it, expect } from 'vitest';
import { buildGroundingRecord, validateGroundedNarration, type LexiconEntry } from './etymology-grounding';

const lexicon: Record<string, LexiconEntry> = {
  H7462: { lemma: 'רָעָה', derivation: 'a primitive root', root: 'רעה', rootGloss: 'to tend, graze', bdbGloss: 'to pasture, tend, graze', related: [{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }] },
};

describe('buildGroundingRecord', () => {
  it('assembles verified facts from the lexicon into a grounding record', () => {
    const rec = buildGroundingRecord('H7462', lexicon);
    expect(rec).toMatchObject({ strongs: 'H7462', root: 'רעה', rootGloss: 'to tend, graze', source: "Strong's + BDB" });
    expect(rec.related).toEqual([{ strongs: 'H7473', word: 'רֹעֶה', gloss: 'shepherd' }]);
  });
});

describe('validateGroundedNarration (anti-hallucination, spec §9)', () => {
  const rec = buildGroundingRecord('H7462', lexicon);
  it('passes when the narration only references grounded terms', () => {
    const res = validateGroundedNarration('From the root meaning to tend and graze, the shepherd image grew.', rec);
    expect(res.ok).toBe(true);
    expect(res.unsupported).toEqual([]);
  });
  it('flags an invented cognate not present in the grounding record', () => {
    const res = validateGroundedNarration('It derives from an Akkadian word for kingship.', rec);
    expect(res.ok).toBe(false);
    expect(res.unsupported).toContain('Akkadian');
  });
  it('does not flag "Strong" when the narration cites its own Strong\'s source', () => {
    const res = validateGroundedNarration("This root appears under Strong's numbering as a primitive verb.", rec);
    expect(res.unsupported).not.toContain('Strong');
    expect(res.ok).toBe(true);
  });
});
