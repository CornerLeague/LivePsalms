// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeStorageAdapter, resetFakeAdapterIds } from '../collection/fake-storage-adapter';
import { LocalStorageAdapter } from './local-storage';

describe('ensureStudyFolder — FakeStorageAdapter', () => {
  beforeEach(() => resetFakeAdapterIds());

  it('creates a Study folder when none exists', async () => {
    const adapter = new FakeStorageAdapter();
    const folder = await adapter.ensureStudyFolder();
    expect(folder.kind).toBe('study');
    expect(folder.name).toBe('Study');
    expect(folder.parentId).toBeNull();
    expect((await adapter.getFolders()).filter((f) => f.kind === 'study')).toHaveLength(1);
  });

  it('is idempotent — second call returns the same folder', async () => {
    const adapter = new FakeStorageAdapter();
    const first = await adapter.ensureStudyFolder();
    const second = await adapter.ensureStudyFolder();
    expect(second.id).toBe(first.id);
    expect((await adapter.getFolders()).filter((f) => f.kind === 'study')).toHaveLength(1);
  });
});

describe('ensureStudyFolder — LocalStorageAdapter', () => {
  beforeEach(() => localStorage.clear());

  it('creates then reuses the Study folder', async () => {
    const adapter = new LocalStorageAdapter();
    const first = await adapter.ensureStudyFolder();
    expect(first.kind).toBe('study');
    const second = await adapter.ensureStudyFolder();
    expect(second.id).toBe(first.id);
    expect((await adapter.getFolders()).filter((f) => f.kind === 'study')).toHaveLength(1);
  });
});
