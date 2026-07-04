// src/notepad/recordings/pending-store.test.ts
// Pure-logic tests: exercise the store against an INJECTED in-memory backend
// (jsdom/node have no IndexedDB, and we add no fake-indexeddb dependency). The
// real IDB backend is not exercised here; it is validated by the browser at
// runtime. What matters for correctness is (a) round-trip + per-user filtering
// through the public API, and (b) swallow-and-warn degradation so a broken
// backend never throws into the caller (the upload path).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  savePending,
  deletePending,
  loadPendingForUser,
  _setBackendForTests,
  type PendingBackend,
  type PendingRecording,
} from './pending-store';

/** Minimal in-memory stand-in for the IDB backend, keyed by recordingId. */
function makeMemoryBackend(): PendingBackend & { rows: Map<string, PendingRecording> } {
  const rows = new Map<string, PendingRecording>();
  return {
    rows,
    put: async (record) => {
      rows.set(record.recordingId, record);
    },
    delete: async (recordingId) => {
      rows.delete(recordingId);
    },
    loadByUser: async (userId) => [...rows.values()].filter((r) => r.userId === userId),
  };
}

/** A backend whose every operation rejects — models IDB unavailable / quota. */
const throwingBackend: PendingBackend = {
  put: () => Promise.reject(new Error('quota exceeded')),
  delete: () => Promise.reject(new Error('open failed')),
  loadByUser: () => Promise.reject(new Error('open failed')),
};

function makeRecord(over: Partial<PendingRecording> = {}): PendingRecording {
  return {
    userId: 'user-1',
    noteId: 'note-1',
    recordingId: 'rec-1',
    blob: new Blob(['audio'], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationSeconds: 12,
    error: null,
    createdAt: 1000,
    ...over,
  };
}

describe('pending-store', () => {
  afterEach(() => {
    _setBackendForTests(null);
    vi.restoreAllMocks();
  });

  describe('with an in-memory backend', () => {
    let mem: ReturnType<typeof makeMemoryBackend>;
    beforeEach(() => {
      mem = makeMemoryBackend();
      _setBackendForTests(mem);
    });

    it('round-trips save → load, preserving the full payload including the Blob', async () => {
      const record = makeRecord({ durationSeconds: 42, error: 'boom' });
      await savePending(record);
      const loaded = await loadPendingForUser('user-1');
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toMatchObject({
        recordingId: 'rec-1',
        noteId: 'note-1',
        durationSeconds: 42,
        error: 'boom',
        createdAt: 1000,
      });
      expect(loaded[0].blob).toBeInstanceOf(Blob);
    });

    it('save upserts on the recordingId key (no duplicate rows)', async () => {
      await savePending(makeRecord({ error: null }));
      await savePending(makeRecord({ error: 'failed later' }));
      const loaded = await loadPendingForUser('user-1');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].error).toBe('failed later');
    });

    it('delete removes the row', async () => {
      await savePending(makeRecord());
      await deletePending('rec-1');
      expect(await loadPendingForUser('user-1')).toHaveLength(0);
    });

    it('loadPendingForUser returns only the given user\'s rows', async () => {
      await savePending(makeRecord({ recordingId: 'a', userId: 'user-1' }));
      await savePending(makeRecord({ recordingId: 'b', userId: 'user-2' }));
      await savePending(makeRecord({ recordingId: 'c', userId: 'user-1' }));
      const forUser1 = await loadPendingForUser('user-1');
      expect(forUser1.map((r) => r.recordingId).sort()).toEqual(['a', 'c']);
      const forUser2 = await loadPendingForUser('user-2');
      expect(forUser2.map((r) => r.recordingId)).toEqual(['b']);
    });

    it('loadPendingForUser returns [] when the user has no rows', async () => {
      expect(await loadPendingForUser('nobody')).toEqual([]);
    });
  });

  describe('degradation (backend throws)', () => {
    beforeEach(() => {
      _setBackendForTests(throwingBackend);
    });

    it('savePending resolves without throwing and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(savePending(makeRecord())).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('[recordings] pending-store unavailable', expect.any(Error));
    });

    it('deletePending resolves without throwing and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(deletePending('rec-1')).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith('[recordings] pending-store unavailable', expect.any(Error));
    });

    it('loadPendingForUser resolves to [] without throwing and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(loadPendingForUser('user-1')).resolves.toEqual([]);
      expect(warn).toHaveBeenCalledWith('[recordings] pending-store unavailable', expect.any(Error));
    });
  });
});
