import { describe, it, expect } from 'vitest';
import { decideMerge, type MergeDecisionInput } from './onboarding-lifecycle';
import type { AccountProgress, AnonProgress } from './onboarding-types';
import { defaultAccountProgress } from './onboarding-types';

const NOW = '2026-06-11T12:00:00.000Z';

const anon = (over: Partial<AnonProgress> = {}): AnonProgress => ({ items: {}, dismissed: false, ...over });
const acct = (over: Partial<AccountProgress> = {}): AccountProgress => ({ ...defaultAccountProgress(), ...over });

// A baseline input where the merge WOULD fire: every gate open, nothing merged
// yet, account load settled. Each test overrides only the field under test.
const ready = (over: Partial<MergeDecisionInput> = {}): MergeDecisionInput => ({
  alreadyMerged: false,
  authLoading: false,
  signedIn: true,
  hasAdapter: true,
  accountLoaded: true,
  account: null,
  anon: null,
  ...over,
});

describe('decideMerge — gates (LOAD-BEARING #4)', () => {
  it('returns idle while auth is loading', () => {
    expect(decideMerge(ready({ authLoading: true }))).toEqual({ kind: 'idle' });
  });

  it('returns idle when signed out', () => {
    expect(decideMerge(ready({ signedIn: false }))).toEqual({ kind: 'idle' });
  });

  it('returns idle when no adapter is present (no signed-in I/O path)', () => {
    expect(decideMerge(ready({ hasAdapter: false }))).toEqual({ kind: 'idle' });
  });
});

describe('decideMerge — merge-once latch (LOAD-BEARING #1)', () => {
  it('returns idle when already merged, even with pending anon data', () => {
    expect(
      decideMerge(ready({ alreadyMerged: true, anon: anon({ items: { 'write-first-note': NOW } }) })),
    ).toEqual({ kind: 'idle' });
  });
});

describe('decideMerge — never on a transient null (LOAD-BEARING #2, headline invariant)', () => {
  it('returns idle while the account load is still in flight, even when account=null and anon has data', () => {
    expect(
      decideMerge(
        ready({ accountLoaded: false, account: null, anon: anon({ items: { 'write-first-note': NOW } }) }),
      ),
    ).toEqual({ kind: 'idle' });
  });

  it('merges once the load settles with genuinely no stored progress (account=null): fresh default + credited anon items', () => {
    const decision = decideMerge(
      ready({
        accountLoaded: true,
        account: null,
        anon: anon({ items: { 'write-first-note': '2026-06-10T09:00:00Z' } }),
      }),
    );
    expect(decision.kind).toBe('merge');
    if (decision.kind === 'merge') {
      expect(decision.next.items['first-study-note']).toBe('2026-06-10T09:00:00Z');
      expect(decision.next.guidedNote).toBe('skipped');
      expect(decision.next.merged).toBe(true);
    }
  });
});

describe('decideMerge — idempotent when already merged (LOAD-BEARING #3)', () => {
  it('returns already-merged (distinct from merge, no writes) when stored progress is already merged', () => {
    expect(decideMerge(ready({ account: acct({ merged: true }) }))).toEqual({ kind: 'already-merged' });
  });

  it('lets the gates win over an already-merged account (still loading -> idle, not already-merged)', () => {
    expect(decideMerge(ready({ authLoading: true, account: acct({ merged: true }) }))).toEqual({ kind: 'idle' });
  });
});

describe('decideMerge — the merged next shape', () => {
  it('merges to a plain default (merged:true) when there is no anon activity', () => {
    expect(decideMerge(ready({ account: null, anon: null }))).toEqual({
      kind: 'merge',
      next: { ...defaultAccountProgress(), merged: true },
    });
  });

  it('merges into an existing unmerged account, preserving already-credited journey items', () => {
    const account = acct({ items: { 'create-folder': '2026-06-01T00:00:00Z' } });
    const decision = decideMerge(ready({ account, anon: anon({ items: { 'write-first-note': NOW } }) }));
    expect(decision.kind).toBe('merge');
    if (decision.kind === 'merge') {
      expect(decision.next.items['create-folder']).toBe('2026-06-01T00:00:00Z');
      expect(decision.next.items['first-study-note']).toBe(NOW);
      expect(decision.next.merged).toBe(true);
    }
  });
});
