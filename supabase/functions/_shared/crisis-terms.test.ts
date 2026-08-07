import { describe, it, expect } from 'vitest';
import { prefilterHits, CRISIS_PREFILTER_TERMS } from './crisis-terms.ts';
import { SAFETY_CORPUS, riskFixtures, okFixtures } from './__fixtures__/safety-corpus.ts';

// ⚠️ THE PREFILTER DECIDES NOTHING, AND DOES NOT GATE THE CLASSIFIER.
//
// It was meant to gate — hits go to the model, misses are skipped. The corpus
// disproved that on the first run (see the first test). Every note is
// classified; this list survives to record `prefilter_hit` for measurement and
// to act as a deterministic fallback when the model path is unavailable.
//
// Every test here exists to keep it in that lane. The moment something reads
// its verdict as a judgement, the lament problem stops being the classifier's
// to solve and starts being a phrase list's, which is the failure the whole
// design is arranged around.
describe('the crisis prefilter', () => {
  it('⚠️ does NOT catch every true positive — which is why it cannot gate anything', () => {
    // Measured across the corpus: the prefilter hits the two loud shapes and
    // MISSES `risk-preparation` entirely, because that entry contains no crisis
    // phrase at all — affairs put in order, a possession given away, and a
    // sudden calm. It is the quietest presentation and among the most
    // concerning, and a phrase list cannot see it.
    //
    // This is the reason the classifier runs on EVERY note rather than only on
    // prefilter hits. The test asserts the limitation on purpose: if someone
    // later "fixes" it by adding preparation phrases, they will fire on
    // ordinary journalling forever and still not close the gap.
    const hits = riskFixtures().filter((f) => prefilterHits(f.text));
    expect(hits.length).toBeLessThan(riskFixtures().length);
    expect(riskFixtures().find((f) => !prefilterHits(f.text))?.name).toBe('risk-preparation');
  });

  it('catches the loud shapes it is meant to', () => {
    for (const name of ['risk-stated-intent', 'risk-burden-framing']) {
      const f = riskFixtures().find((x) => x.name === name)!;
      expect(prefilterHits(f.text), `${name} should hit`).toBe(true);
    }
  });

  it('⚠️ is ALLOWED to fire on lament, and that costs nothing', () => {
    // Not an assertion that it does — an assertion that doing so is harmless,
    // because a hit only buys a classifier call. If this test ever has to
    // change to "must not fire on lament", the prefilter has been given a job
    // that is not its own.
    const lament = SAFETY_CORPUS.filter((f) => f.expected === 'lament');
    for (const f of lament) {
      const hit = prefilterHits(f.text);
      expect(typeof hit).toBe('boolean');   // either verdict is acceptable
    }
  });

  it('stays quiet on ordinary entries, which is the saving', () => {
    for (const f of okFixtures()) {
      expect(prefilterHits(f.text), `${f.name} should not need a classifier call`).toBe(false);
    }
  });

  it('catches the quiet shapes, not just the loud one', () => {
    // A list built only from explicit statements misses burden framing and
    // preparation — the two that arrive without announcing themselves.
    expect(prefilterHits('everyone would be better off without me')).toBe(true);
    expect(prefilterHits('i do not want to wake up tomorrow')).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(prefilterHits('I have decided I am going to END MY LIFE.')).toBe(true);
    expect(prefilterHits('end   my\nlife')).toBe(true);
  });

  it('does not fire on ordinary uses of its own words', () => {
    // "kill" in "killed the engine", "die" in "dying to see you". A prefilter
    // that fires on these wastes classifier calls without buying recall.
    expect(prefilterHits('I killed the engine and sat in the car park a while.')).toBe(false);
    expect(prefilterHits('I am dying to see the new place.')).toBe(false);
    expect(prefilterHits('He preached on dying to self.')).toBe(false);
  });

  it('exports its terms for review rather than burying them', () => {
    // The list is content, not code. It gets read by the board like the other
    // lists in voice.ts do.
    expect(CRISIS_PREFILTER_TERMS.length).toBeGreaterThan(8);
  });
});
