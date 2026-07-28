// src/routing/notes-route.test.ts
import { describe, it, expect } from 'vitest';
import { isNotesWorkspaceIndexPath, isStudyWorkspacePath } from './notes-route';

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

  // React Router v7 renders the same workspace at a trailing-slash URL
  // (matchPath's end anchor ignores trailing slashes), so the dock-suppression
  // predicate must treat `/notebook/notes/` and `/notebook/u/:username/` as the
  // index too — otherwise the mobile dock reappears over the notes tab bar.
  it('matches the local notes index with a trailing slash', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/notes/')).toBe(true);
  });
  it('matches a vanity notes index with a trailing slash', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/')).toBe(true);
  });
  it('still does NOT match children reached with a trailing slash', () => {
    expect(isNotesWorkspaceIndexPath('/notebook/notes/study/')).toBe(false);
    expect(isNotesWorkspaceIndexPath('/notebook/u/natalie/study/')).toBe(false);
  });
});

describe('isStudyWorkspacePath', () => {
  it('matches the local study route', () => {
    expect(isStudyWorkspacePath('/notebook/notes/study')).toBe(true);
  });
  it('matches a vanity study route', () => {
    expect(isStudyWorkspacePath('/notebook/u/natalie/study')).toBe(true);
  });
  it('matches study routes reached with a trailing slash', () => {
    expect(isStudyWorkspacePath('/notebook/notes/study/')).toBe(true);
    expect(isStudyWorkspacePath('/notebook/u/natalie/study/')).toBe(true);
  });

  it('does NOT match the notes workspace index', () => {
    expect(isStudyWorkspacePath('/notebook/notes')).toBe(false);
    expect(isStudyWorkspacePath('/notebook/u/natalie')).toBe(false);
  });
  it('does NOT match waymarks, which keeps the dock for site nav', () => {
    expect(isStudyWorkspacePath('/notebook/u/natalie/reflections')).toBe(false);
    expect(isStudyWorkspacePath('/notebook/u/natalie/reflections/2026-07')).toBe(false);
  });
  it('does NOT match the notebook landing or home', () => {
    expect(isStudyWorkspacePath('/notebook')).toBe(false);
    expect(isStudyWorkspacePath('/home')).toBe(false);
  });
  it('does NOT match a username that merely ends in "study"', () => {
    expect(isStudyWorkspacePath('/notebook/u/study')).toBe(false);
  });

  // The two predicates partition the workspace: no path is both, and together
  // they cover exactly the routes that own their own bottom edge.
  it('never overlaps with isNotesWorkspaceIndexPath', () => {
    for (const p of [
      '/notebook/notes',
      '/notebook/notes/study',
      '/notebook/u/natalie',
      '/notebook/u/natalie/study',
      '/notebook/u/natalie/reflections',
      '/notebook',
      '/home',
    ]) {
      expect(isNotesWorkspaceIndexPath(p) && isStudyWorkspacePath(p)).toBe(false);
    }
  });
});
