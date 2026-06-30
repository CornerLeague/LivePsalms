import { describe, it, expect, vi } from 'vitest';
import { verifyStudyThread } from './verify-thread.ts';

// Minimal chainable supabase mock: from().select().eq().eq().eq().maybeSingle()
function mockSupabase(maybeSingleResult: { data: unknown; error: unknown }) {
  const eq = vi.fn();
  const builder = { select: vi.fn(() => builder), eq, maybeSingle: vi.fn(async () => maybeSingleResult) };
  eq.mockImplementation(() => builder);
  const from = vi.fn(() => builder);
  return { client: { from } as never, from, eq, builder };
}

describe('verifyStudyThread', () => {
  it('returns the thread grounding when the row is owned and study-scoped', async () => {
    const { client } = mockSupabase({ data: { id: 't1', book: 'rom', chapter: 8, passage_ref: 'rom.8' }, error: null });
    const out = await verifyStudyThread(client, { threadId: 't1', userId: 'u1' });
    expect(out).toEqual({ ok: true, thread: { threadId: 't1', book: 'rom', chapter: 8, passageRef: 'rom.8' } });
  });

  it('returns thread_not_found when no row matches (wrong user / wrong surface / missing)', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const out = await verifyStudyThread(client, { threadId: 't1', userId: 'u1' });
    expect(out).toEqual({ ok: false, reason: 'thread_not_found' });
  });

  it('scopes the lookup by id, user_id, and study surface', async () => {
    const { client, eq } = mockSupabase({ data: { id: 't1', book: 'rom', chapter: 8, passage_ref: 'rom.8' }, error: null });
    await verifyStudyThread(client, { threadId: 't1', userId: 'u1' });
    expect(eq).toHaveBeenCalledWith('id', 't1');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq).toHaveBeenCalledWith('surface', 'study');
  });

  it('throws on a transient query error so the handler maps to 500, not a misleading 404', async () => {
    const { client } = mockSupabase({ data: null, error: { message: 'db connection reset' } });
    await expect(verifyStudyThread(client, { threadId: 't1', userId: 'u1' })).rejects.toBeDefined();
  });
});
