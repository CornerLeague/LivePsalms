// The byte-identity gate on Door 1's prompt.
//
// B3 makes the Door-1 machinery door-generic (design §1). Door 1 is LIVE,
// registered, and has a checked-in live baseline at
// `passage-insight-2026-08-06-v1` — plus, since 2026-08-07, real cached rows on
// Leviticus 1 that were generated under exactly these bytes.
//
// A refactor that shifts the emitted SYSTEM string or the tool schema by one
// character changes Door 1's output with no version bump, and no behavioural
// test would catch it: every other test in this directory asserts that the
// prompt SAYS certain things, which stays true while the prose around it moves.
//
// So the gate is byte equality against a checked-in fixture, and the fixture is
// data rather than a hash: when this fails, the diff shows exactly what moved.
//
// ⚠️ If this test fails, there are exactly two correct responses:
//   1. the change was unintended — revert it; or
//   2. the change was intended — then Door 1 needs a `promptVersion` bump AND a
//      fresh live eval baseline, and this fixture is regenerated in the same
//      commit as both.
// Regenerating the fixture on its own, to make the red go away, is the one
// response that is always wrong. This is the same discipline that let B2
// extract STUDY_GROUNDING_RULES without bumping study-chat's version.
import { describe, it, expect } from 'vitest';
import { PASSAGE_INSIGHT_PROMPT } from './passage-insight.ts';
import expected from './__fixtures__/passage-insight-v1.json' with { type: 'json' };

describe('Door 1 prompt — byte identity (B3 refactor gate)', () => {
  it('emits the same promptVersion', () => {
    expect(PASSAGE_INSIGHT_PROMPT.promptVersion).toBe(expected.promptVersion);
  });

  it('emits a byte-identical system prompt', () => {
    // Length first: a failure here reads as "42 characters appeared" rather
    // than dumping 3,300 characters of near-identical prose at the reader.
    expect(PASSAGE_INSIGHT_PROMPT.system.length).toBe(expected.system.length);
    expect(PASSAGE_INSIGHT_PROMPT.system).toBe(expected.system);
  });

  it('emits a byte-identical tool schema', () => {
    // Serialized rather than deep-equal: KEY ORDER is part of what the model is
    // shown, and a structural comparison would call a reordered schema equal.
    expect(JSON.stringify(PASSAGE_INSIGHT_PROMPT.tool)).toBe(JSON.stringify(expected.tool));
  });

  it('still declines the contested-passage exemption', () => {
    // Not a byte check — a policy one, and the single most consequential thing
    // a careless refactor could flip while leaving every string intact.
    expect(PASSAGE_INSIGHT_PROMPT.allowContestedRefs).toBeUndefined();
  });
});
