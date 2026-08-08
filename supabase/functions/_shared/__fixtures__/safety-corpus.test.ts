import { describe, it, expect } from 'vitest';
import {
  SAFETY_CORPUS, lamentFixtures, riskFixtures, okFixtures, mustNotBeRisk,
} from './safety-corpus.ts';

// The corpus is checked in BEFORE the classifier's prompt exists. These tests
// guard the corpus itself — that it stays balanced, stays annotated, and keeps
// the entries whose absence would let a bad detector look good.
describe('the safety corpus', () => {
  it('every fixture declares what property it defends', () => {
    for (const f of SAFETY_CORPUS) {
      expect(f.why.length, `${f.name} needs a reason`).toBeGreaterThan(30);
      expect(f.text.trim().length, `${f.name} needs a body`).toBeGreaterThan(80);
    }
  });

  it('names are unique', () => {
    const names = SAFETY_CORPUS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('⚠️ is weighted toward what must NOT trip — that is the hard direction', () => {
    // A corpus of mostly true positives measures recall and tells you nothing
    // about the failure that actually threatens the product.
    expect(mustNotBeRisk().length).toBeGreaterThan(riskFixtures().length * 2);
  });

  it('keeps the four scripture-derived laments, which are the crux', () => {
    const names = lamentFixtures().map((f) => f.name);
    for (const required of ['psalm-88', 'psalm-42', 'lamentations-3', 'job-3']) {
      expect(names, `${required} is load-bearing — do not remove it`).toContain(required);
    }
  });

  it('keeps the hard cases where risk PHRASES carry non-risk meaning', () => {
    // These are the discriminations a phrase matcher cannot make:
    //   "I don't want to be here"      → grief, in a world without her
    //   "I can't keep doing this"      → a job, not a life
    //   "I wish I'd never been born"   → Job 3
    const byName = new Map(SAFETY_CORPUS.map((f) => [f.name, f]));
    expect(byName.get('grief-after-a-death')?.text).toMatch(/do not want to be here/i);
    expect(byName.get('burnout')?.text).toMatch(/cannot keep doing this/i);
    expect(byName.get('job-3')?.text).toMatch(/never (happened|drawn breath)|wish the day/i);
    for (const n of ['grief-after-a-death', 'burnout', 'job-3']) {
      expect(byName.get(n)?.expected, `${n} must not be labelled risk`).not.toBe('risk');
    }
  });

  it('has true positives across all three shapes, not just the loud one', () => {
    // Explicit intent is the easy case. Burden framing and quiet preparation
    // are the ones a detector tuned on explicit statements will miss.
    const names = riskFixtures().map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['risk-stated-intent', 'risk-burden-framing', 'risk-preparation']),
    );
  });

  it('⚠️ caps the borderline escape hatch at two', () => {
    // `borderline` stops the eval failing on an entry, which is exactly how a
    // safety eval rots. Two is enough to express a real edge and few enough
    // that widening it is a visible decision rather than a drift.
    const borderline = SAFETY_CORPUS.filter((f) => f.borderline);
    expect(borderline.length).toBeLessThanOrEqual(2);
    for (const f of borderline) {
      expect(f.why, `${f.name} must argue for its borderline status`).toMatch(/borderline|defensible/i);
    }
  });

  it('every class is represented', () => {
    expect(lamentFixtures().length).toBeGreaterThanOrEqual(8);
    expect(okFixtures().length).toBeGreaterThanOrEqual(3);
    expect(riskFixtures().length).toBeGreaterThanOrEqual(3);
  });
});
