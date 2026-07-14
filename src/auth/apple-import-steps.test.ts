import { describe, it, expect } from 'vitest';
import { deriveImportSteps, type GuideStep, type StepState } from './apple-import-steps';

const stateOf = (steps: GuideStep[], id: string): StepState =>
  steps.find((s) => s.id === id)!.state;

// Reachable states (hasRun implies hasToken in the real data model:
// last_used_at is set only after a token is consumed). REVOKED_AFTER_IMPORT is
// also reachable: the panel derives hasToken/hasRun from the revoked-filtered
// token list, while importedCount counts notes (revocation doesn't delete them),
// so revoking your only token after importing yields hasToken/hasRun false with
// importedCount > 0.
const NO_TOKEN = { hasToken: false, hasRun: false, importedCount: 0 };
const TOKEN_NO_RUN = { hasToken: true, hasRun: false, importedCount: 0 };
const RUN_NO_IMPORT = { hasToken: true, hasRun: true, importedCount: 0 };
const COMPLETE = { hasToken: true, hasRun: true, importedCount: 3 };
const REVOKED_AFTER_IMPORT = { hasToken: false, hasRun: false, importedCount: 3 };
const ALL_STATES = [NO_TOKEN, TOKEN_NO_RUN, RUN_NO_IMPORT, COMPLETE, REVOKED_AFTER_IMPORT];

describe('deriveImportSteps', () => {
  it('returns the four steps in fixed order with titles', () => {
    const steps = deriveImportSteps(NO_TOKEN);
    expect(steps.map((s) => s.id)).toEqual(['token', 'install', 'run', 'confirm']);
    expect(steps.every((s) => s.title.length > 0)).toBe(true);
  });

  it('no token: token active, everything after upcoming', () => {
    const s = deriveImportSteps(NO_TOKEN);
    expect(stateOf(s, 'token')).toBe('active');
    expect(stateOf(s, 'install')).toBe('upcoming');
    expect(stateOf(s, 'run')).toBe('upcoming');
    expect(stateOf(s, 'confirm')).toBe('upcoming');
  });

  it('token but no run: token done, install active, run+confirm upcoming', () => {
    const s = deriveImportSteps(TOKEN_NO_RUN);
    expect(stateOf(s, 'token')).toBe('done');
    expect(stateOf(s, 'install')).toBe('active');
    expect(stateOf(s, 'run')).toBe('upcoming');
    expect(stateOf(s, 'confirm')).toBe('upcoming');
  });

  it('run but nothing imported yet: token/install/run done, confirm active', () => {
    const s = deriveImportSteps(RUN_NO_IMPORT);
    expect(stateOf(s, 'token')).toBe('done');
    expect(stateOf(s, 'install')).toBe('done');
    expect(stateOf(s, 'run')).toBe('done');
    expect(stateOf(s, 'confirm')).toBe('active');
  });

  it('imported > 0: all four done', () => {
    const s = deriveImportSteps(COMPLETE);
    expect(s.every((step) => step.state === 'done')).toBe(true);
  });

  it('revoked after import: confirm is not done (start over from token)', () => {
    // Revoking your only token drops hasToken/hasRun to false while importedCount
    // stays > 0. confirm must reflect the revoked reality, not a stale green ✓.
    const s = deriveImportSteps(REVOKED_AFTER_IMPORT);
    expect(stateOf(s, 'token')).toBe('active');
    expect(stateOf(s, 'install')).toBe('upcoming');
    expect(stateOf(s, 'run')).toBe('upcoming');
    expect(stateOf(s, 'confirm')).toBe('upcoming');
  });

  it('run is never active across reachable states', () => {
    for (const input of ALL_STATES) {
      expect(stateOf(deriveImportSteps(input), 'run')).not.toBe('active');
    }
  });

  it('exactly one active while incomplete, zero when complete', () => {
    const actives = (input: typeof NO_TOKEN) =>
      deriveImportSteps(input).filter((s) => s.state === 'active').length;
    expect(actives(NO_TOKEN)).toBe(1);
    expect(actives(TOKEN_NO_RUN)).toBe(1);
    expect(actives(RUN_NO_IMPORT)).toBe(1);
    expect(actives(COMPLETE)).toBe(0);
    expect(actives(REVOKED_AFTER_IMPORT)).toBe(1);
  });

  it('ordering invariant: no done/active step follows an upcoming step', () => {
    const rank: Record<StepState, number> = { done: 2, active: 1, upcoming: 0 };
    for (const input of ALL_STATES) {
      const seq = deriveImportSteps(input).map((s) => rank[s.state]);
      for (let i = 1; i < seq.length; i++) {
        // once we drop to upcoming (0), we never rise again
        if (seq[i - 1] === 0) expect(seq[i]).toBe(0);
      }
    }
  });
});
