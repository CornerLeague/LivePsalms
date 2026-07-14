// src/auth/apple-import-steps.ts
// Pure, DOM-free step-state logic for the Connect Apple Notes guide.
// Unit-tested in isolation. Never throws.

export type StepState = 'done' | 'active' | 'upcoming';
export type StepId = 'token' | 'install' | 'run' | 'confirm';
export interface GuideStep {
  id: StepId;
  title: string;
  state: StepState;
}

// Signals the panel already has:
//   hasToken     = the user has at least one active token
//   hasRun       = the Shortcut has POSTed at least once (lastUsedAt != null)
//   importedCount= number of apple_notes-sourced notes
//
// Honesty: a step is only `done` on a real signal. `run` is never `active` —
// its only signal (hasRun) is shared with `install`, so `install` carries the
// active highlight through the whole "have token, haven't run" window and both
// flip to `done` the instant the Shortcut first runs. Precondition (from the
// data model): hasRun implies hasToken.
export function deriveImportSteps(input: {
  hasToken: boolean;
  hasRun: boolean;
  importedCount: number;
}): GuideStep[] {
  const { hasToken, hasRun, importedCount } = input;

  const token: StepState = hasToken ? 'done' : 'active';
  const install: StepState = hasRun ? 'done' : hasToken ? 'active' : 'upcoming';
  const run: StepState = hasRun ? 'done' : 'upcoming';
  const confirm: StepState = importedCount > 0 ? 'done' : hasRun ? 'active' : 'upcoming';

  return [
    { id: 'token', title: 'Generate your token', state: token },
    { id: 'install', title: 'Install the Shortcut', state: install },
    { id: 'run', title: 'Run it & choose your notes', state: run },
    { id: 'confirm', title: 'Confirm your import', state: confirm },
  ];
}
