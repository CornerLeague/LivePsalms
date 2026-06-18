import { describe, it, expect } from 'vitest';
import { SupabaseStorageAdapter } from './supabase-adapter';

// mapFolder is a pure mapper that never touches the client, so a dummy client
// is fine for exercising the read path.
function makeAdapter() {
  return new SupabaseStorageAdapter({} as never, 'user-1');
}

// Capturing client that records the payload passed to .insert()
function makeCapturingAdapter() {
  let captured: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        captured = payload;
        return { select: () => ({ single: async () => ({ data: { ...payload }, error: null }) }) };
      },
    }),
  };
  return { adapter: new SupabaseStorageAdapter(client as never, 'u1'), get: () => captured };
}

describe('SupabaseStorageAdapter.importFolder kind', () => {
  it('preserves kind in the insert payload', async () => {
    const { adapter, get } = makeCapturingAdapter();
    await adapter.importFolder({ id: 'f1', name: 'Study', parentId: null, order: 0, kind: 'study' });
    expect(get()?.kind).toBe('study');
  });
});

describe('SupabaseStorageAdapter.mapFolder kind', () => {
  it('reads kind from the row', () => {
    const adapter = makeAdapter();
    const folder = adapter.mapFolder({
      id: 'f1',
      name: 'Study',
      parent_id: null,
      order: 0,
      icon: 'book',
      color: null,
      kind: 'study',
    });
    expect(folder.kind).toBe('study');
  });

  it('leaves kind undefined when the column is null', () => {
    const adapter = makeAdapter();
    const folder = adapter.mapFolder({
      id: 'f2',
      name: 'Sermons',
      parent_id: null,
      order: 1,
      icon: null,
      color: null,
      kind: null,
    });
    expect(folder.kind).toBeUndefined();
  });
});
