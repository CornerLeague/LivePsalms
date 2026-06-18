import { describe, it, expect } from 'vitest';
import { SupabaseStorageAdapter } from './supabase-adapter';

// mapFolder is a pure mapper that never touches the client, so a dummy client
// is fine for exercising the read path.
function makeAdapter() {
  return new SupabaseStorageAdapter({} as never, 'user-1');
}

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
