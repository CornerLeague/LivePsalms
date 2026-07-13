import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseMemorizeAdapter } from './supabase-memorize-adapter';

// `add()` performs two separate `.from('memorize_cards')` calls: (1) a dedupe
// SELECT — `.select(...).eq('user_id', ...)`, awaited after `eq()`; (2) a WRITE
// — either `.insert(rows).select(...)` (pre-fix) or `.upsert(rows, opts).select(...)`
// (post-fix), awaited after the trailing `select()`. Each `.from()` call gets its
// own builder object (via mockReturnValueOnce) so the two legs' `select` verbs
// don't collide — the dedupe leg's `select()` is chainable (returns the eq-chain
// builder), the write leg's `select()` is terminal (resolves {data, error}).
const { from, selectEq, eq, insertFn, upsert, writeSelect } = vi.hoisted(() => ({
  from: vi.fn(),
  selectEq: vi.fn(),
  eq: vi.fn(),
  insertFn: vi.fn(),
  upsert: vi.fn(),
  writeSelect: vi.fn(),
}));

function wire({
  existing = [] as unknown[],
  selectError = null as unknown,
  written = [] as unknown[],
  writeError = null as unknown,
} = {}) {
  from.mockReset();
  selectEq.mockReset();
  eq.mockReset();
  insertFn.mockReset();
  upsert.mockReset();
  writeSelect.mockReset();

  const dedupeBuilder = { select: selectEq, eq };
  const writeBuilder = { insert: insertFn, upsert, select: writeSelect };

  selectEq.mockReturnValue(dedupeBuilder);
  eq.mockResolvedValue({ data: existing, error: selectError });

  insertFn.mockReturnValue(writeBuilder);
  upsert.mockReturnValue(writeBuilder);
  writeSelect.mockResolvedValue({ data: written, error: writeError });

  from.mockReturnValueOnce(dedupeBuilder).mockReturnValueOnce(writeBuilder);
}

beforeEach(() => wire());

const adapter = () => new SupabaseMemorizeAdapter({ from } as never, 'user-1');

/** The row payload actually sent to the write leg, whichever verb fired it. */
function capturedRows(): Array<Record<string, unknown>> {
  if (upsert.mock.calls.length > 0) return upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
  if (insertFn.mock.calls.length > 0) return insertFn.mock.calls[0][0] as Array<Record<string, unknown>>;
  throw new Error('add() called neither insert nor upsert');
}

const A = { book: 'jhn', chapter: 3, verse: 16, translation: 'BSB' };
const newCard = (over: Partial<typeof A> & { text?: string } = {}) => ({
  book: 'jhn', chapter: 1, verse: 1, translation: 'BSB', text: 'In the beginning...', ...over,
});

describe('SupabaseMemorizeAdapter.add — position math (P2)', () => {
  it('starts new card positions strictly above the current max existing position (no ties)', async () => {
    // remove() never renumbers, so a mid-deck deletion can leave gappy DB
    // positions like 0, 2 while there are only 2 existing rows.
    wire({
      existing: [
        { ...A, verse: 16, position: 0 },
        { ...A, verse: 17, position: 2 },
      ],
    });

    await adapter().add([newCard({ verse: 20 })]);

    const rows = capturedRows();
    // RED today: current code writes `seen.size` (2), tying the existing
    // position-2 row. The fix must write 3 (max(0,2)+1).
    expect(rows[0].position).toBe(3);
  });
});

describe('SupabaseMemorizeAdapter.add — upsert contract (P1)', () => {
  it('writes via upsert with ignoreDuplicates + onConflict on the unique columns, not insert', async () => {
    wire({ existing: [] });

    await adapter().add([newCard()]);

    // RED today: current code calls `.insert(rows)`, never `.upsert(...)`.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'user_id, book, chapter, verse, translation',
      ignoreDuplicates: true,
    });
  });
});

describe('SupabaseMemorizeAdapter.add — mixed batch (P1)', () => {
  it('still writes a genuinely-new card even when the batch also contains a known dupe', async () => {
    wire({ existing: [{ ...A, position: 0 }] });

    await adapter().add([
      { ...A, text: 'For God so loved the world...' }, // known dupe of A
      newCard({ verse: 17, text: 'For God did not send his Son...' }), // genuinely new
    ]);

    const rows = capturedRows();
    expect(rows.some((r) => r.verse === 17)).toBe(true);
  });
});
