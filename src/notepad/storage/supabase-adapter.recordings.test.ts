import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseStorageAdapter } from './supabase-adapter';
import type { SupabaseClient } from '@supabase/supabase-js';

const cleanup = vi.hoisted(() => ({ removeRecordingsForNote: vi.fn(async () => undefined) }));
vi.mock('../recordings/recordings-client', () => ({
  removeRecordingsForNote: cleanup.removeRecordingsForNote,
}));

function makeClient(deleteError: { message: string } | null = null) {
  const eq = vi.fn(async () => ({ error: deleteError }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ delete: del }));
  return { client: { from } as unknown as SupabaseClient, from, del, eq };
}

beforeEach(() => vi.clearAllMocks());

describe('SupabaseStorageAdapter.deleteNote recordings cleanup', () => {
  it('deletes the row first, then best-effort storage cleanup', async () => {
    const { client, eq } = makeClient();
    const adapter = new SupabaseStorageAdapter(client, 'user-1');
    await adapter.deleteNote('note-1');
    expect(eq).toHaveBeenCalledWith('id', 'note-1');
    expect(cleanup.removeRecordingsForNote).toHaveBeenCalledWith('user-1', 'note-1');
    expect(eq.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.removeRecordingsForNote.mock.invocationCallOrder[0],
    );
  });

  it('row-delete failure throws and skips cleanup', async () => {
    const { client } = makeClient({ message: 'nope' });
    const adapter = new SupabaseStorageAdapter(client, 'user-1');
    await expect(adapter.deleteNote('note-1')).rejects.toBeTruthy();
    expect(cleanup.removeRecordingsForNote).not.toHaveBeenCalled();
  });
});
