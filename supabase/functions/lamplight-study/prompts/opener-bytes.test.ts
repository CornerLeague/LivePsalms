// The byte-identity gate on the Study OPENER prompt.
//
// B4 renames `mode: 'insight'` → `mode: 'opener'` (parent §10), because
// "insight" now names three different things and the feature called Insights is
// one of them. The rename is mechanical, it crosses the client/edge boundary,
// and it touches a module whose prompt is version-stamped at
// `study-insight-2026-08-06-v5`.
//
// ⚠️ THE VERSION STRING DOES NOT MOVE, and that is the point of this file. A
// `promptVersion` is a STORED value: it stamps `lamplight_usage` rows and
// identifies which prompt produced what. Renaming an identifier changes no byte
// the model sees, so bumping the version would assert a change that did not
// happen and orphan the history that reads it. The version keeps the word
// "insight" inside it on purpose — the identifier is renamed, the string is
// data.
//
// So the proof that this rename is a rename is byte equality against a
// checked-in fixture, captured before any renaming. Same discipline B3 used
// when it made Door 1's machinery door-generic — where it caught a seven-
// character drift on its first run, invisible in review, because every other
// test in that directory asserts that a prompt SAYS things rather than what it
// says.
//
// If this fails there are exactly two correct responses:
//   1. the change was unintended — revert it; or
//   2. the change was intended — then the prompt needs a version bump AND a
//      fresh live baseline, and this fixture is regenerated in the same commit
//      as both.
// Regenerating it alone, to make the red go away, is always wrong.
import { describe, it, expect } from 'vitest';
import { STUDY_INSIGHT_PROMPT } from './study-insight.ts';
import expected from './__fixtures__/study-opener-v5.json' with { type: 'json' };

describe('Study opener prompt — byte identity (B4 rename gate)', () => {
  it('keeps its promptVersion verbatim, "insight" and all', () => {
    expect(STUDY_INSIGHT_PROMPT.promptVersion).toBe(expected.promptVersion);
    expect(STUDY_INSIGHT_PROMPT.promptVersion).toBe('study-insight-2026-08-06-v5');
  });

  it('emits a byte-identical system prompt', () => {
    // Length first: a failure reads as "42 characters appeared" rather than
    // dumping several thousand characters of near-identical prose.
    expect(STUDY_INSIGHT_PROMPT.system.length).toBe(expected.system.length);
    expect(STUDY_INSIGHT_PROMPT.system).toBe(expected.system);
  });

  it('emits a byte-identical tool schema', () => {
    // Serialized rather than deep-equal: KEY ORDER is part of what the model is
    // shown, and a structural comparison would call a reordered schema equal.
    expect(JSON.stringify(STUDY_INSIGHT_PROMPT.tool)).toBe(JSON.stringify(expected.tool));
  });

  it('keeps the contested-passage exemption', () => {
    // Not a byte check — a policy one, and the single most consequential thing
    // a careless refactor could flip while leaving every string intact. An
    // opener on a divided chapter needs the freedom to name the text, and
    // inherits the duty not to settle it. Both doors decline this exemption;
    // both openers take it.
    expect(STUDY_INSIGHT_PROMPT.allowContestedRefs).toBe(true);
  });
});
