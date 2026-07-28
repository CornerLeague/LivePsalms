import { describe, it, expect } from 'vitest';
import { resolveNewNoteFolderId } from './new-note-target';
import type { Folder, Note } from '../types';

const folder = (over: Partial<Folder> & { id: string }): Folder => ({
  id: over.id,
  name: over.name ?? over.id,
  parentId: over.parentId ?? null,
  order: over.order ?? 0,
  icon: over.icon,
  color: over.color,
  kind: over.kind,
});

const note = (over: Partial<Note> & { id: string; folderId: string }): Note => ({
  id: over.id,
  title: over.title ?? 'Untitled',
  content: '',
  folderId: over.folderId,
  type: over.type ?? 'general',
  tags: [],
  wordCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('resolveNewNoteFolderId', () => {
  it('uses the active note’s folder when it is a real folder', () => {
    const folders = [folder({ id: 'f1', order: 0 }), folder({ id: 'f2', order: 1 })];
    const active = note({ id: 'n1', folderId: 'f2' });
    expect(resolveNewNoteFolderId(active, folders)).toBe('f2');
  });

  it('falls back to the top root folder when there is no active note', () => {
    const folders = [
      folder({ id: 'b', order: 2 }),
      folder({ id: 'a', order: 0 }),
      folder({ id: 'c', order: 1 }),
    ];
    expect(resolveNewNoteFolderId(null, folders)).toBe('a');
  });

  it('falls back to the top root folder when the active note is at root', () => {
    const folders = [folder({ id: 'first', order: 0 }), folder({ id: 'second', order: 1 })];
    const active = note({ id: 'n1', folderId: 'root' });
    expect(resolveNewNoteFolderId(active, folders)).toBe('first');
  });

  it('ignores nested folders when picking the top folder', () => {
    const folders = [
      folder({ id: 'child', parentId: 'root-folder', order: 0 }),
      folder({ id: 'root-folder', parentId: null, order: 5 }),
    ];
    expect(resolveNewNoteFolderId(null, folders)).toBe('root-folder');
  });

  it('treats an active note pointing at a deleted folder as “not on a folder”', () => {
    const folders = [folder({ id: 'live', order: 0 })];
    const active = note({ id: 'n1', folderId: 'ghost' });
    expect(resolveNewNoteFolderId(active, folders)).toBe('live');
  });

  it('returns “root” when there are no folders at all', () => {
    expect(resolveNewNoteFolderId(null, [])).toBe('root');
    expect(resolveNewNoteFolderId(note({ id: 'n1', folderId: 'root' }), [])).toBe('root');
  });

  it('skips the system Study folder when picking the top folder', () => {
    // The Study root hides inline note creation in favor of the Study pane's
    // own button — New Note must not drop notes there behind the user's back.
    const folders = [
      folder({ id: 'study', kind: 'study', order: 0 }),
      folder({ id: 'mine', order: 1 }),
    ];
    expect(resolveNewNoteFolderId(null, folders)).toBe('mine');
  });

  it('falls back to root when the Study folder is the only one', () => {
    const folders = [folder({ id: 'study', kind: 'study', order: 0 })];
    expect(resolveNewNoteFolderId(null, folders)).toBe('root');
  });

  it('still honors an active note that lives inside the Study folder', () => {
    // Explicitly being on a Study note is different from silently defaulting
    // there — notes created from the Study pane stay with their siblings.
    const folders = [folder({ id: 'study', kind: 'study', order: 0 })];
    const active = note({ id: 'n1', folderId: 'study' });
    expect(resolveNewNoteFolderId(active, folders)).toBe('study');
  });
});

describe('resolveNewNoteFolderId — while folders are still loading', () => {
  it('trusts the active note’s folder id before the folder list has loaded', () => {
    // folders is empty because it hasn't loaded yet, not because none exist — so
    // the note lands in the folder the user is on rather than at root.
    const active = note({ id: 'n1', folderId: 'f2' });
    expect(resolveNewNoteFolderId(active, [], false)).toBe('f2');
  });

  it('contrast: a *loaded* empty list redirects the same active folder to root', () => {
    const active = note({ id: 'n1', folderId: 'f2' });
    expect(resolveNewNoteFolderId(active, [], true)).toBe('root');
  });

  it('defers (null) with no active note while loading, rather than picking root', () => {
    // The empty list carries no information yet. Returning 'root' here would
    // permanently unfile the note on an account that does have folders.
    expect(resolveNewNoteFolderId(null, [], false)).toBeNull();
  });

  it('defers when the active note is at root and folders are still loading', () => {
    const active = note({ id: 'n1', folderId: 'root' });
    expect(resolveNewNoteFolderId(active, [], false)).toBeNull();
  });

  it('contrast: a *loaded* empty list with no active note resolves to root', () => {
    expect(resolveNewNoteFolderId(null, [], true)).toBe('root');
  });
});
