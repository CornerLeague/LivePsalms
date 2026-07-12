// src/routing/notes-route.test.ts
import { describe, it, expect } from 'vitest';
import { isNotesWorkspaceIndexPath } from './notes-route';

describe('isNotesWorkspaceIndexPath', () => {
  it('matches the local notes index', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/notes')).toBe(true);
  });
  it('matches a vanity notes index', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie')).toBe(true);
  });
  it('does NOT match the notes study child', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/notes/study')).toBe(false);
  });
  it('does NOT match a vanity study child', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/study')).toBe(false);
  });
  it('does NOT match vanity reflections', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/reflections')).toBe(false);
  });
  it('does NOT match vanity reflections detail', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/reflections/2026-07')).toBe(false);
  });
  it('does NOT match the notebook landing', () => {
    expect(isNotesWorkspaceIndexPath('/notebook')).toBe(false);
  });
  it('does NOT match home', () => {
    expect(isNotesWorkspaceIndexPath('/home')).toBe(false);
  });
});
