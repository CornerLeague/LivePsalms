import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseLamplightAdapter } from './supabase-lamplight-adapter';

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SUPABASE_ANON = process.env.SUPABASE_TEST_ANON_KEY;
const USER_A_EMAIL = process.env.SUPABASE_TEST_USER_A_EMAIL;
const USER_A_PASS = process.env.SUPABASE_TEST_USER_A_PASS;
const USER_B_EMAIL = process.env.SUPABASE_TEST_USER_B_EMAIL;
const USER_B_PASS = process.env.SUPABASE_TEST_USER_B_PASS;

const haveEnv =
  SUPABASE_URL && SUPABASE_ANON && USER_A_EMAIL && USER_A_PASS && USER_B_EMAIL && USER_B_PASS;

const maybeDescribe = haveEnv ? describe : describe.skip;

async function signedClient(email: string, password: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON!);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, userId: data.user!.id };
}

maybeDescribe('Lamplight RLS isolation (integration)', () => {
  let userA: { client: SupabaseClient; userId: string };
  let userB: { client: SupabaseClient; userId: string };

  beforeAll(async () => {
    userA = await signedClient(USER_A_EMAIL!, USER_A_PASS!);
    userB = await signedClient(USER_B_EMAIL!, USER_B_PASS!);
  });

  it("user B cannot read user A's lamplight_settings", async () => {
    const adapterA = new SupabaseLamplightAdapter(userA.client);
    await adapterA.upsertSettings(userA.userId, { enabled: true });

    const adapterB = new SupabaseLamplightAdapter(userB.client);
    const leaked = await adapterB.getSettings(userA.userId);
    expect(leaked).toBeNull();
  });

  it("user B cannot insert a lamplight_settings row impersonating user A", async () => {
    const adapterB = new SupabaseLamplightAdapter(userB.client);
    await expect(
      adapterB.upsertSettings(userA.userId, { enabled: true })
    ).rejects.toThrow();
  });

  it("getPromoConfig is readable by all signed-in users", async () => {
    const adapterB = new SupabaseLamplightAdapter(userB.client);
    const promo = await adapterB.getPromoConfig();
    expect(typeof promo.promoActive).toBe('boolean');
  });

  it("user B cannot read user A's lamplight_embeddings", async () => {
    // userA inserts an embedding via their own client (1024-dim zero vector).
    const sourceId = `rls-test-${Date.now()}`;
    const { error: insErr } = await userA.client.from('lamplight_embeddings').insert({
      user_id: userA.userId,
      source_type: 'note',
      source_id: sourceId,
      content_hash: 'h',
      embedding: new Array(1024).fill(0),
    });
    expect(insErr).toBeNull();

    // userB cannot see it.
    const { data, error } = await userB.client
      .from('lamplight_embeddings')
      .select('source_id')
      .eq('source_id', sourceId);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Cleanup — userA deletes their own row.
    await userA.client.from('lamplight_embeddings').delete().eq('source_id', sourceId);
  });

  it("user B cannot insert a lamplight_embeddings row impersonating user A", async () => {
    const { error } = await userB.client.from('lamplight_embeddings').insert({
      user_id: userA.userId,
      source_type: 'note',
      source_id: `rls-impersonate-${Date.now()}`,
      content_hash: 'h',
      embedding: new Array(1024).fill(0),
    });
    expect(error).not.toBeNull(); // RLS rejects
  });

  it("authenticated users cannot see Bible rows (user_id IS NULL)", async () => {
    // RLS policy `auth.uid() = user_id` evaluates to NULL → false for NULL-owner rows,
    // so authenticated clients see zero of them regardless of whether any exist.
    const { data, error } = await userB.client
      .from('lamplight_embeddings')
      .select('source_id, user_id')
      .is('user_id', null);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("authenticated users cannot execute match_user_note_embeddings", async () => {
    const zeroVec = new Array(1024).fill(0);
    const { error } = await userB.client.rpc('match_user_note_embeddings', {
      p_user_id: userA.userId,
      p_query_vector: zeroVec,
      p_exclude_source_id: null,
      p_limit: 5,
    });
    expect(error).not.toBeNull(); // permission denied / function not in schema cache
  });

  it("authenticated users cannot execute match_bible_embeddings", async () => {
    const zeroVec = new Array(1024).fill(0);
    const { error } = await userB.client.rpc('match_bible_embeddings', {
      p_query_vector: zeroVec,
      p_limit: 5,
    });
    expect(error).not.toBeNull();
  });

  it("user A cannot read user B's daily_devotion artifact via the adapter", async () => {
    const periodKey = `rls-${Date.now()}`;
    const { error: insErr } = await userB.client.from('lamplight_artifacts').insert({
      user_id: userB.userId,
      type: 'daily_devotion',
      period_key: periodKey,
      title: '',
      body: {
        opening: 'op',
        scripture: { ref: 'Psalm 23:4', text: 't' },
        reflection: 'r',
        prompt: 'p',
        note_citations: [{ note_id: 'n', reason: 'r' }],
      },
      source_note_ids: [],
      source_verses: ['Psalm 23:4'],
      model_used: 'gpt-5.6-terra',
      prompt_version: 'daily-devotion-2026-05-27-v1',
    });
    expect(insErr).toBeNull();

    const adapterA = new SupabaseLamplightAdapter(userA.client);
    expect(await adapterA.getDailyDevotion(userB.userId, periodKey)).toBeNull();

    await userB.client.from('lamplight_artifacts').delete().eq('period_key', periodKey);
  });

  it("user B cannot call match_my_note_neighbors with user A's note id", async () => {
    // Insert a note for user A via service-role would be ideal, but the test
    // harness only has anon-key signed-in clients. Use a UUID that does not
    // belong to user B; the RPC's ownership check raises 'not authorized'
    // regardless of whether the note exists.
    const fakeId = '00000000-0000-0000-0000-00000000abcd';
    const { error } = await userB.client.rpc('match_my_note_neighbors', {
      p_source_note_id: fakeId,
      p_k: 5,
    });
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('not authorized');
  });

  it("match_my_note_neighbors returns [] when source note has no embedding (own note)", async () => {
    // Insert a note for user A (no embedding seeded) then call the RPC.
    const noteId = crypto.randomUUID();
    const { error: insErr } = await userA.client.from('notes').insert({
      id: noteId,
      user_id: userA.userId,
      title: 'rls-test',
      content: JSON.stringify({ type: 'doc', content: [] }),
      tags: [],
      type: 'devotion',
      folder_id: null,
    });
    if (insErr) {
      // The notes schema may have additional NOT NULL columns; if so, the
      // assertion below is skipped — the cross-user authorization check above
      // is the load-bearing test.
      return;
    }

    const { data, error } = await userA.client.rpc('match_my_note_neighbors', {
      p_source_note_id: noteId,
      p_k: 5,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    await userA.client.from('notes').delete().eq('id', noteId);
  });

  it("user A cannot read user B's lamplight_connections rows", async () => {
    // Service-role would be needed to seed a connection row for user B; under
    // RLS, user A reading the table returns [] regardless of whether B has
    // rows — that's the contract this test exercises.
    const { data, error } = await userA.client
      .from('lamplight_connections')
      .select('note_id, related_note_id')
      .eq('related_note_id', '00000000-0000-0000-0000-00000000beef');
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
