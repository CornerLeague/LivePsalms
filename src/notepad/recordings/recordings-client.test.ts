import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockSupabase: unknown = null;
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

import {
  recordingObjectKey,
  extensionForMime,
  uploadRecording,
  listRecordings,
  signedRecordingUrl,
  deleteRecording,
  renameRecording,
  removeRecordingsForNote,
} from './recordings-client';

/** Chainable supabase query mock: every method returns itself; awaiting resolves `result`. */
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['insert', 'select', 'update', 'delete', 'eq', 'order', 'single']) {
    q[m] = vi.fn(() => q);
  }
  (q as { then: unknown }).then = (res: (v: unknown) => void) => Promise.resolve(result).then(res);
  return q as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
}

const dbRow = {
  id: 'rec-1',
  note_id: 'note-1',
  title: '',
  duration_seconds: 12,
  storage_path: 'user-1/note-1/rec-1.webm',
  mime_type: 'audio/webm',
  size_bytes: 3456,
  created_at: '2026-07-03T00:00:00Z',
};

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const storageApi = {
    createSignedUploadUrl: vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/put', token: 't', path: 'p' },
      error: null,
    })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/get' }, error: null })),
    remove: vi.fn(async () => ({ data: null, error: null })),
    list: vi.fn(async () => ({ data: [{ name: 'rec-1.webm' }, { name: 'rec-2.mp4' }], error: null })),
    ...overrides,
  };
  return {
    storage: { from: vi.fn(() => storageApi) },
    from: vi.fn(() => chain({ data: dbRow, error: null })),
    _storageApi: storageApi,
  };
}

beforeEach(() => {
  mockSupabase = null;
  vi.clearAllMocks();
});

describe('recordingObjectKey / extensionForMime', () => {
  it('builds {userId}/{noteId}/{recordingId}.{ext} with no bucket prefix', () => {
    expect(recordingObjectKey('u1', 'n1', 'r1', 'webm')).toBe('u1/n1/r1.webm');
  });
  it('maps mime types to extensions', () => {
    expect(extensionForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMime('audio/mp4')).toBe('mp4');
  });
});

describe('null-supabase guards', () => {
  it('uploadRecording rejects', async () => {
    await expect(
      uploadRecording(
        { userId: 'u', noteId: 'n', recordingId: 'r', blob: new Blob(), mimeType: 'audio/webm', durationSeconds: 1 },
        undefined,
        vi.fn(),
      ),
    ).rejects.toThrow('supabase not configured');
  });
  it('listRecordings returns []', async () => {
    expect(await listRecordings('n')).toEqual([]);
  });
  it('signedRecordingUrl returns null', async () => {
    expect(await signedRecordingUrl('u/n/r.webm')).toBeNull();
  });
  it('removeRecordingsForNote resolves', async () => {
    await expect(removeRecordingsForNote('u', 'n')).resolves.toBeUndefined();
  });
});

describe('uploadRecording', () => {
  it('happy path: signed URL → put → insert → mapped row', async () => {
    const client = makeClient();
    mockSupabase = client;
    const put = vi.fn(async () => undefined);
    const blob = new Blob(['abc'], { type: 'audio/webm' });
    const rec = await uploadRecording(
      { userId: 'user-1', noteId: 'note-1', recordingId: 'rec-1', blob, mimeType: 'audio/webm', durationSeconds: 12 },
      undefined,
      put,
    );
    expect(client._storageApi.createSignedUploadUrl).toHaveBeenCalledWith('user-1/note-1/rec-1.webm');
    expect(put).toHaveBeenCalledWith('https://signed.example/put', blob, 'audio/webm', undefined);
    expect(rec).toEqual({
      id: 'rec-1',
      noteId: 'note-1',
      title: '',
      durationSeconds: 12,
      storagePath: 'user-1/note-1/rec-1.webm',
      mimeType: 'audio/webm',
      sizeBytes: 3456,
      createdAt: '2026-07-03T00:00:00Z',
    });
  });

  it('signed-URL error propagates', async () => {
    const client = makeClient({
      createSignedUploadUrl: vi.fn(async () => ({ data: null, error: { message: 'nope' } })),
    });
    mockSupabase = client;
    await expect(
      uploadRecording(
        { userId: 'u', noteId: 'n', recordingId: 'r', blob: new Blob(), mimeType: 'audio/webm', durationSeconds: 1 },
        undefined,
        vi.fn(),
      ),
    ).rejects.toThrow('nope');
  });

  it('insert failure removes the uploaded object then rejects', async () => {
    const client = makeClient();
    client.from = vi.fn(() => chain({ data: null, error: { message: 'insert failed' } }));
    mockSupabase = client;
    await expect(
      uploadRecording(
        { userId: 'u', noteId: 'n', recordingId: 'r', blob: new Blob(), mimeType: 'audio/webm', durationSeconds: 1 },
        undefined,
        vi.fn(async () => undefined),
      ),
    ).rejects.toThrow('insert failed');
    expect(client._storageApi.remove).toHaveBeenCalledWith(['u/n/r.webm']);
  });
});

describe('deleteRecording', () => {
  it('removes the storage object before the row', async () => {
    const client = makeClient();
    mockSupabase = client;
    await deleteRecording({ id: 'rec-1', storagePath: 'u/n/rec-1.webm' });
    expect(client._storageApi.remove).toHaveBeenCalledWith(['u/n/rec-1.webm']);
    expect(client._storageApi.remove.mock.invocationCallOrder[0]).toBeLessThan(
      client.from.mock.invocationCallOrder[0],
    );
  });

  it('storage failure rejects and skips the row delete', async () => {
    const client = makeClient({ remove: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) });
    mockSupabase = client;
    await expect(deleteRecording({ id: 'rec-1', storagePath: 'u/n/rec-1.webm' })).rejects.toThrow('boom');
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('renameRecording', () => {
  it('updates the title by id', async () => {
    const client = makeClient();
    const q = chain({ data: null, error: null });
    client.from = vi.fn(() => q);
    mockSupabase = client;
    await renameRecording('rec-1', 'Morning prayer');
    expect(q.update).toHaveBeenCalledWith({ title: 'Morning prayer' });
    expect(q.eq).toHaveBeenCalledWith('id', 'rec-1');
  });
});

describe('removeRecordingsForNote', () => {
  it('lists the note folder and removes every object', async () => {
    const client = makeClient();
    mockSupabase = client;
    await removeRecordingsForNote('user-1', 'note-1');
    expect(client._storageApi.list).toHaveBeenCalledWith('user-1/note-1');
    expect(client._storageApi.remove).toHaveBeenCalledWith([
      'user-1/note-1/rec-1.webm',
      'user-1/note-1/rec-2.mp4',
    ]);
  });

  it('never throws: list error resolves quietly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient({ list: vi.fn(async () => ({ data: null, error: { message: 'down' } })) });
    mockSupabase = client;
    await expect(removeRecordingsForNote('u', 'n')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
