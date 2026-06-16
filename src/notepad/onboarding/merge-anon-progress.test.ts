import { describe, it, expect } from 'vitest';
import { mergeAnonIntoAccount } from './merge-anon-progress';
import { defaultAccountProgress, defaultAnonProgress } from './onboarding-types';

const NOW = '2026-06-11T12:00:00.000Z';

describe('mergeAnonIntoAccount', () => {
  it('is a no-op when account is already merged', () => {
    const account = { ...defaultAccountProgress(), merged: true, guidedNote: 'done' as const };
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': NOW } };
    expect(mergeAnonIntoAccount(anon, account)).toBe(account);
  });

  it('credits first-study-note and auto-skips the guided note when anon first-note done', () => {
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': '2026-06-10T09:00:00Z' } };
    const out = mergeAnonIntoAccount(anon, null);
    expect(out.items['first-study-note']).toBe('2026-06-10T09:00:00Z');
    expect(out.guidedNote).toBe('skipped');
    expect(out.merged).toBe(true);
  });

  it('leaves guided note pending when anon has no first note', () => {
    const anon = { ...defaultAnonProgress(), items: { 'highlight': NOW } };
    const out = mergeAnonIntoAccount(anon, null);
    expect(out.items['first-study-note']).toBeUndefined();
    expect(out.guidedNote).toBe('pending');
    expect(out.merged).toBe(true);
  });

  it('handles null anon (no anonymous activity)', () => {
    const out = mergeAnonIntoAccount(null, null);
    expect(out).toEqual({ ...defaultAccountProgress(), merged: true });
  });

  it('preserves existing account journey items already credited', () => {
    const account = { ...defaultAccountProgress(), items: { 'create-folder': '2026-06-01T00:00:00Z' } };
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': NOW } };
    const out = mergeAnonIntoAccount(anon, account);
    expect(out.items['create-folder']).toBe('2026-06-01T00:00:00Z');
    expect(out.items['first-study-note']).toBe(NOW);
  });

  it('is idempotent: merging the result again returns it unchanged', () => {
    const anon = { ...defaultAnonProgress(), items: { 'write-first-note': NOW } };
    const once = mergeAnonIntoAccount(anon, null);
    const twice = mergeAnonIntoAccount(anon, once);
    expect(twice).toEqual(once);
  });
});
