import { describe, it, expect } from 'vitest';
import { planTypeFolderSeed, reconcileTypeFolderSeed } from './seed-type-folders';
import type { Folder, Note, NoteType } from '../types';

const folder = (over: Partial<Folder> & { id: string }): Folder => ({
  id: over.id,
  name: over.name ?? over.id,
  parentId: over.parentId ?? null,
  order: over.order ?? 0,
  icon: over.icon,
  color: over.color,
  kind: over.kind,
  seededType: over.seededType,
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

describe('reconcileTypeFolderSeed', () => {
  it('plans every folder and move on a fresh account', () => {
    const plan = reconcileTypeFolderSeed([note('n1', 'general'), note('n2', 'devotion')], []);
    expect(plan!.foldersToCreate.map((f) => f.name)).toEqual(['General', 'Devotions']);
    expect(plan!.existingByType).toEqual([]);
    expect(plan!.moves).toEqual([
      { noteId: 'n1', type: 'general' },
      { noteId: 'n2', type: 'devotion' },
    ]);
  });

  it('reuses a seed folder left by a partial run instead of recreating it', () => {
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general'), note('n2', 'devotion')],
      [folder({ id: 'g', name: 'General', seededType: 'general' })],
    );
    // General already exists — only Devotions is created; both notes still move.
    expect(plan!.foldersToCreate.map((f) => f.name)).toEqual(['Devotions']);
    expect(plan!.existingByType).toEqual([['general', 'g']]);
    expect(plan!.moves.map((m) => m.noteId)).toEqual(['n1', 'n2']);
  });

  it('re-finds a seeded folder by tag even after the user renamed it', () => {
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general')],
      // Renamed away from 'General', but still tagged — a name match would miss
      // it and create a duplicate; the tag keeps the resume exact.
      [folder({ id: 'g', name: 'My Notes', seededType: 'general' })],
    );
    expect(plan!.foldersToCreate).toEqual([]);
    expect(plan!.existingByType).toEqual([['general', 'g']]);
    expect(plan!.moves).toEqual([{ noteId: 'n1', type: 'general' }]);
  });

  it('does not treat a folder tagged for another type as this type’s folder', () => {
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general')],
      // Named 'General' but tagged devotion — the tag wins, so General is still
      // created rather than dumping general notes into a devotion folder.
      [folder({ id: 'd', name: 'General', seededType: 'devotion' })],
    );
    expect(plan!.foldersToCreate.map((f) => f.name)).toEqual(['General']);
    expect(plan!.existingByType).toEqual([]);
  });

  it('falls back to a name match for folders seeded before tagging existed', () => {
    // An older build's partial run left an untagged 'General' folder; the resume
    // must still recognize it so it isn't duplicated.
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general')],
      [folder({ id: 'g', name: 'General' })],
    );
    expect(plan!.foldersToCreate).toEqual([]);
    expect(plan!.existingByType).toEqual([['general', 'g']]);
  });

  it('keeps a resumed folder’s order aligned with sidebar order', () => {
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general'), note('n2', 'devotion')],
      [folder({ id: 'g', name: 'General' })],
    );
    // Devotions is second among the used types, so it keeps order 1 even though
    // it's the only folder being created this pass.
    expect(plan!.foldersToCreate[0].order).toBe(1);
  });

  it('does not match the system Study folder even when the name lines up', () => {
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general')],
      [folder({ id: 's', name: 'General', kind: 'study' })],
    );
    expect(plan!.foldersToCreate.map((f) => f.name)).toEqual(['General']);
    expect(plan!.existingByType).toEqual([]);
  });

  it('only moves notes still at root, leaving filed notes put', () => {
    const plan = reconcileTypeFolderSeed(
      [note('n1', 'general', 'g'), note('n2', 'general')],
      [folder({ id: 'g', name: 'General' })],
    );
    expect(plan!.foldersToCreate).toEqual([]);
    expect(plan!.moves).toEqual([{ noteId: 'n2', type: 'general' }]);
  });

  it('returns null when nothing is left at root', () => {
    expect(
      reconcileTypeFolderSeed([note('n1', 'general', 'g')], [folder({ id: 'g', name: 'General' })]),
    ).toBeNull();
  });
});
