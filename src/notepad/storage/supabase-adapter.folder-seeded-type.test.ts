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

describe('SupabaseStorageAdapter — folder seeded_type insert', () => {
  it('writes seeded_type when creating a seeded folder', async () => {
    const { adapter, get } = makeCapturingAdapter();
    await adapter.createFolder({ name: 'General', parentId: null, order: 0, seededType: 'general' });
    expect(get()?.seeded_type).toBe('general');
  });

  it('writes null seeded_type for an ordinary folder', async () => {
    const { adapter, get } = makeCapturingAdapter();
    await adapter.createFolder({ name: 'Mine', parentId: null, order: 0 });
    expect(get()?.seeded_type).toBeNull();
  });

  it('preserves seeded_type through importFolder (local → cloud migration)', async () => {
    const { adapter, get } = makeCapturingAdapter();
    await adapter.importFolder({
      id: 'f1',
      name: 'Sermons',
      parentId: null,
      order: 0,
      seededType: 'sermon',
    });
    expect(get()?.seeded_type).toBe('sermon');
  });
});

describe('SupabaseStorageAdapter — folder seeded_type mapper', () => {
  it('reads seeded_type from the row', () => {
    const folder = makeAdapter().mapFolder({
      id: 'f1',
      name: 'Devotions',
      parent_id: null,
      order: 0,
      icon: null,
      color: null,
      kind: null,
      seeded_type: 'devotion',
    });
    expect(folder.seededType).toBe('devotion');
  });

  it('leaves seededType undefined when the column is null', () => {
    const folder = makeAdapter().mapFolder({
      id: 'f2',
      name: 'Mine',
      parent_id: null,
      order: 1,
      icon: null,
      color: null,
      kind: null,
      seeded_type: null,
    });
    expect(folder.seededType).toBeUndefined();
  });
});
