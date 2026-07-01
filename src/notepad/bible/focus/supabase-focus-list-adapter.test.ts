import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseFocusListAdapter } from './supabase-focus-list-adapter';

// Chainable supabase builder mock. delete()/eq()/update()/select() return the
// builder; the builder is thenable and resolves to { error } (the delete-path).
// in() resolves to { data, error } (terminates the select chain); upsert()
// resolves to { error }. from() records the table name.
const { from, del, eq, update, select, inFn, upsert } = vi.hoisted(() => ({
  from: vi.fn(), del: vi.fn(), eq: vi.fn(), update: vi.fn(),
  select: vi.fn(), inFn: vi.fn(), upsert: vi.fn(),
}));

function wire(
  deleteError: unknown = null,
  { rows = [] as unknown[], selectError = null as unknown, upsertError = null as unknown } = {},
) {
  const builder = {
    delete: del, eq, update, select, upsert, in: inFn,
    then: (r: (v: { error: unknown }) => unknown) => Promise.resolve(r({ error: deleteError })),
  };
  del.mockReturnValue(builder);
  eq.mockReturnValue(builder);
  update.mockReturnValue(builder);
  select.mockReturnValue(builder);
  from.mockReturnValue(builder);
  inFn.mockResolvedValue({ data: rows, error: selectError });
  upsert.mockResolvedValue({ error: upsertError });
}

beforeEach(() => {
  from.mockReset(); del.mockReset(); eq.mockReset(); update.mockReset();
  select.mockReset(); inFn.mockReset(); upsert.mockReset(); wire();
});

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

  it('renameList updates scripture_focus_lists by id', async () => {
    await adapter().renameList('list-7', 'New Name');
    expect(from).toHaveBeenCalledWith('scripture_focus_lists');
    expect(eq).toHaveBeenCalledWith('id', 'list-7');
  });

  it('throws when the renameList update returns an error', async () => {
    wire({ message: 'boom' });
    await expect(adapter().renameList('list-7', 'New Name')).rejects.toBeTruthy();
  });
});

describe('SupabaseFocusListAdapter — reorderItems is atomic', () => {
  const rows = [
    { id: 'a', list_id: 'L', book: 'jhn', chapter: 3, verse_start: 16, verse_end: 16, label: 'John 3:16' },
    { id: 'b', list_id: 'L', book: 'ps', chapter: 23, verse_start: 1, verse_end: 3, label: 'Psalm 23:1-3' },
    { id: 'c', list_id: 'L', book: 'eph', chapter: 2, verse_start: 8, verse_end: 9, label: 'Ephesians 2:8-9' },
  ];

  it('renumbers positions densely in a SINGLE upsert (no per-row update loop)', async () => {
    wire(null, { rows });
    await adapter().reorderItems('L', ['c', 'a', 'b']);

    // The whole reorder must be one write so a partial failure can't scramble the DB.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    // Fetched exactly the rows being reordered.
    expect(inFn).toHaveBeenCalledWith('id', ['c', 'a', 'b']);
    // Full rows preserved, positions renumbered to match the requested order.
    expect(upsert.mock.calls[0][0]).toEqual([
      { ...rows.find((r) => r.id === 'c'), position: 0 },
      { ...rows.find((r) => r.id === 'a'), position: 1 },
      { ...rows.find((r) => r.id === 'b'), position: 2 },
    ]);
  });

  it('throws when the upsert fails (nothing partially written)', async () => {
    wire(null, { rows: [rows[0]], upsertError: { message: 'boom' } });
    await expect(adapter().reorderItems('L', ['a'])).rejects.toBeTruthy();
  });
});
