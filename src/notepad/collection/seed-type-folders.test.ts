import { describe, it, expect } from 'vitest';
import { planTypeFolderSeed } from './seed-type-folders';
import type { Folder, Note, NoteType } from '../types';

const folder = (over: Partial<Folder> & { id: string }): Folder => ({
  id: over.id,
  name: over.name ?? over.id,
  parentId: over.parentId ?? null,
  order: over.order ?? 0,
  icon: over.icon,
  color: over.color,
  kind: over.kind,
});

const note = (id: string, type: NoteType, folderId = 'root'): Note => ({
  id,
  title: id,
  content: '',
  folderId,
  type,
  tags: [],
  wordCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('planTypeFolderSeed', () => {
  it('creates one folder per note type in use, in sidebar order', () => {
    const plan = planTypeFolderSeed(
      [note('n1', 'theme'), note('n2', 'general'), note('n3', 'sermon')],
      [],
    );
    expect(plan!.folders.map((f) => f.name)).toEqual(['General', 'Sermons', 'Themes']);
  });

  it('carries the legacy type colors onto the folders', () => {
    const plan = planTypeFolderSeed([note('n1', 'devotion')], []);
    expect(plan!.folders[0]).toMatchObject({
      type: 'devotion',
      name: 'Devotions',
      color: '#6B8B7A',
    });
  });

  it('moves every root note into its type’s folder', () => {
    const plan = planTypeFolderSeed(
      [note('n1', 'general'), note('n2', 'devotion'), note('n3', 'general')],
      [],
    );
    expect(plan!.moves).toEqual([
      { noteId: 'n1', type: 'general' },
      { noteId: 'n2', type: 'devotion' },
      { noteId: 'n3', type: 'general' },
    ]);
  });

  it('treats a note pointing at a deleted folder as a root note', () => {
    // Matches buildFolderTreeView's orphan rule — the legacy type buckets
    // rendered these too, so the backfill has to file them.
    const plan = planTypeFolderSeed([note('n1', 'general', 'ghost')], []);
    expect(plan!.moves).toEqual([{ noteId: 'n1', type: 'general' }]);
  });

  it('leaves notes already inside a live folder alone', () => {
    const plan = planTypeFolderSeed(
      [note('n1', 'general', 'live'), note('n2', 'devotion')],
      [folder({ id: 'live', kind: undefined })],
    );
    // 'live' is a user folder, so the account has already adopted folders.
    expect(plan).toBeNull();
  });
});

describe('planTypeFolderSeed — accounts it declines', () => {
  it('declines when the account already has a user folder', () => {
    expect(planTypeFolderSeed([note('n1', 'general')], [folder({ id: 'mine' })])).toBeNull();
  });

  it('declines when every note is already filed', () => {
    expect(
      planTypeFolderSeed([note('n1', 'general', 'f1')], [folder({ id: 'f1' })]),
    ).toBeNull();
  });

  it('declines on an empty account', () => {
    expect(planTypeFolderSeed([], [])).toBeNull();
  });

  it('proceeds when the only folder is the system Study folder', () => {
    // Study is created for the user by Study mode, not by them — it isn't
    // evidence they've adopted folders.
    const plan = planTypeFolderSeed(
      [note('n1', 'general')],
      [folder({ id: 'study', kind: 'study' })],
    );
    expect(plan!.folders.map((f) => f.name)).toEqual(['General']);
  });

  it('declines when notes live in the Study folder and nowhere else', () => {
    const plan = planTypeFolderSeed(
      [note('n1', 'general', 'study')],
      [folder({ id: 'study', kind: 'study' })],
    );
    expect(plan).toBeNull();
  });
});
