import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SUPABASE_ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SUPABASE_SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const USER_A_EMAIL = process.env.SUPABASE_TEST_USER_A_EMAIL;
const USER_A_PASS = process.env.SUPABASE_TEST_USER_A_PASS;

const haveEnv =
  SUPABASE_URL && SUPABASE_ANON && SUPABASE_SERVICE && USER_A_EMAIL && USER_A_PASS;
const maybeDescribe = haveEnv ? describe : describe.skip;

async function signedClient(email: string, password: string) {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON!);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, userId: data.user!.id };
}
const serviceClient = (): SupabaseClient => createClient(SUPABASE_URL!, SUPABASE_SERVICE!);

maybeDescribe('profiles privileged-column guard (integration)', () => {
  let userA: { client: SupabaseClient; userId: string };

  beforeAll(async () => {
    userA = await signedClient(USER_A_EMAIL!, USER_A_PASS!);
    await serviceClient().from('profiles').update({ is_admin: false }).eq('id', userA.userId);
  });

  it('blocks an authenticated client from setting is_admin', async () => {
    const { error } = await userA.client
      .from('profiles').update({ is_admin: true }).eq('id', userA.userId);
    expect(error).not.toBeNull();

    const { data } = await serviceClient()
      .from('profiles').select('is_admin').eq('id', userA.userId).single();
    expect(data?.is_admin).toBe(false);
  });

  it('blocks an authenticated client from escalating is_admin via upsert', async () => {
    const { error } = await userA.client
      .from('profiles').upsert({ id: userA.userId, is_admin: true });
    expect(error).not.toBeNull();

    const { data } = await serviceClient()
      .from('profiles').select('is_admin').eq('id', userA.userId).single();
    expect(data?.is_admin).toBe(false);
  });

  it('blocks an authenticated client from setting note_count', async () => {
    const { error } = await userA.client
      .from('profiles').update({ note_count: 999999 }).eq('id', userA.userId);
    expect(error).not.toBeNull();

    const { data } = await serviceClient()
      .from('profiles').select('note_count').eq('id', userA.userId).single();
    expect(data?.note_count).not.toBe(999999);
  });

  it('blocks an authenticated client from setting highest_note_count', async () => {
    const { error } = await userA.client
      .from('profiles').update({ highest_note_count: 999999 }).eq('id', userA.userId);
    expect(error).not.toBeNull();
  });

  it('blocks an authenticated client from setting last_acknowledged_tier_threshold', async () => {
    const { error } = await userA.client
      .from('profiles').update({ last_acknowledged_tier_threshold: 9999 }).eq('id', userA.userId);
    expect(error).not.toBeNull();
  });

  it('still allows a normal field update (username)', async () => {
    const uniq = `rls_${Date.now().toString(36)}`.slice(0, 20);
    const { error } = await userA.client
      .from('profiles').update({ username: uniq }).eq('id', userA.userId);
    expect(error).toBeNull();
  });

  it('still allows the owner to self-update theme', async () => {
    const { error } = await userA.client
      .from('profiles').update({ theme: 'dark' }).eq('id', userA.userId);
    expect(error).toBeNull();

    const { data } = await serviceClient()
      .from('profiles').select('theme').eq('id', userA.userId).single();
    expect(data?.theme).toBe('dark');

    // restore default so the row is left clean for other runs
    await userA.client.from('profiles').update({ theme: 'system' }).eq('id', userA.userId);
  });

  it('regression: a qualifying note insert still bumps note_count via the trigger', async () => {
    const svc = serviceClient();
    const before = await svc.from('profiles').select('note_count').eq('id', userA.userId).single();
    const longText = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
    const content = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }],
    });
    const { data: note, error: insErr } = await userA.client
      .from('notes').insert({ user_id: userA.userId, title: 'guard-test', content, word_count: 25 })
      .select('id').single();
    expect(insErr).toBeNull();

    const after = await svc.from('profiles').select('note_count').eq('id', userA.userId).single();
    expect((after.data?.note_count ?? 0)).toBeGreaterThan(before.data?.note_count ?? 0);

    await userA.client.from('notes').delete().eq('id', note!.id);
  });

  it('allows the service role to set is_admin', async () => {
    const svc = serviceClient();
    const { error } = await svc.from('profiles').update({ is_admin: true }).eq('id', userA.userId);
    expect(error).toBeNull();
    await svc.from('profiles').update({ is_admin: false }).eq('id', userA.userId);
  });
});
