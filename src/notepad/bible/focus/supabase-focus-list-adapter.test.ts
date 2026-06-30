import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseFocusListAdapter } from './supabase-focus-list-adapter';

// Chainable supabase builder mock: delete()/eq() return `this`; the final eq()
// resolves to { error }. from() records the table name.
const { from, del, eq } = vi.hoisted(() => {
  const del = vi.fn();
  const eq = vi.fn();
  const from = vi.fn();
  return { from, del, eq };
});

function wire(error: unknown = null) {
  const builder = { delete: del, eq, then: (r: (v: { error: unknown }) => unknown) => Promise.resolve(r({ error })) };
  del.mockReturnValue(builder);
  eq.mockReturnValue(builder);
  from.mockReturnValue(builder);
}

beforeEach(() => { from.mockReset(); del.mockReset(); eq.mockReset(); wire(); });

const adapter = () => new SupabaseFocusListAdapter({ from } as never, 'user-1');

describe('SupabaseFocusListAdapter — single-call mutations', () => {
  it('removeItem deletes the item row by id', async () => {
    await adapter().removeItem('item-9');
    expect(from).toHaveBeenCalledWith('scripture_focus_list_items');
    expect(eq).toHaveBeenCalledWith('id', 'item-9');
  });

  it('deleteList deletes the list row by id', async () => {
    await adapter().deleteList('list-3');
    expect(from).toHaveBeenCalledWith('scripture_focus_lists');
    expect(eq).toHaveBeenCalledWith('id', 'list-3');
  });

  it('throws when the delete returns an error', async () => {
    wire({ message: 'boom' });
    await expect(adapter().removeItem('x')).rejects.toBeTruthy();
  });
});
