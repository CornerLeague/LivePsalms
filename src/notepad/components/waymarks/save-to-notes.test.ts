// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSaveToNotesHandler } from './save-to-notes';
import { NoteCollection } from '../../collection/note-collection';
import { FakeStorageAdapter, resetFakeAdapterIds } from '../../collection/fake-storage-adapter';
import type { Note } from '../../types';
import type { ReflectionRecord } from '../../storage/lamplight-adapter';

const record: ReflectionRecord = {
  periodKey: '2026-05',
  title: 'The Month You Stopped Waiting',
  artifact: {
    title: 'The Month You Stopped Waiting',
    letter: 'You began May circling one decision.\n\nOn the twelfth you set it down.',
    markers: [{ date: '2026-05-12', verse: 'Ps 27:14', phrase: 'the day the circling stopped' }],
  },
  createdAt: '2026-05-31T09:00:00.000Z',
  savedToNotes: false,
};

function seedNote(adapter: FakeStorageAdapter, overrides: Partial<Note> = {}) {
  adapter.notes.push({
    id: `id-seed-${adapter.notes.length}`,
    title: 'Seeded',
    content: '',
    folderId: 'root',
    type: 'devotion',
    tags: [],
    wordCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}

describe('buildSaveToNotesHandler', () => {
  let adapter: FakeStorageAdapter;
  let collection: NoteCollection;

  beforeEach(() => {
    localStorage.clear();
    resetFakeAdapterIds();
    adapter = new FakeStorageAdapter();
    collection = new NoteCollection(adapter);
  });

  it('skips creation when a devotion note with the record title already exists, so retry cannot duplicate', async () => {
    seedNote(adapter, { title: record.title, type: 'devotion' });
    await collection.init();

    await buildSaveToNotesHandler(collection)(record);

    // The note-before-flag ordering (see WaymarksPeriodDetail.saveToNotes) accepts
    // "note created, flag write failed → retry" — this dedupe is what keeps that
    // retry from inserting a second copy. The existing note is left untouched.
    expect(adapter.notes).toHaveLength(1);
    expect(adapter.notes[0]).toMatchObject({
      title: record.title,
      content: '',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('creates the note when no matching devotion note exists', async () => {
    await collection.init();

    await buildSaveToNotesHandler(collection)(record);

    expect(adapter.notes).toHaveLength(1);
    expect(adapter.notes[0]).toMatchObject({ title: record.title, type: 'devotion' });
    const doc = JSON.parse(adapter.notes[0].content) as {
      content: Array<{ type: string; content: Array<{ text: string }> }>;
    };
    expect(doc.content[0]).toMatchObject({ type: 'heading' });
    expect(doc.content[0].content[0].text).toBe(record.title);
    expect(doc.content.slice(1).map((p) => p.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('still creates when only a same-title general note exists (dedupe is scoped to devotion notes)', async () => {
    seedNote(adapter, { title: record.title, type: 'general' });
    await collection.init();

    await buildSaveToNotesHandler(collection)(record);

    // A user's own note that happens to share the title must not swallow the save.
    expect(adapter.notes).toHaveLength(2);
    expect(adapter.notes.filter((n) => n.type === 'devotion')).toHaveLength(1);
    expect(adapter.notes.find((n) => n.type === 'devotion')).toMatchObject({ title: record.title });
  });
});
