import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SUPABASE_ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SUPABASE_SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.SUPABASE_TEST_ADMIN_EMAIL;
const ADMIN_PASS = process.env.SUPABASE_TEST_ADMIN_PASS;
const USER_A_EMAIL = process.env.SUPABASE_TEST_USER_A_EMAIL;
const USER_A_PASS = process.env.SUPABASE_TEST_USER_A_PASS;

const haveEnv =
  SUPABASE_URL && SUPABASE_ANON && SUPABASE_SERVICE &&
  ADMIN_EMAIL && ADMIN_PASS && USER_A_EMAIL && USER_A_PASS;

const maybeDescribe = haveEnv ? describe : describe.skip;

async function signedClient(email: string, password: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON!);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, userId: data.user!.id };
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE!);
}

maybeDescribe('Lamplight admin RPCs (integration)', () => {
  let admin: { client: SupabaseClient; userId: string };
  let userA: { client: SupabaseClient; userId: string };

  beforeAll(async () => {
    admin = await signedClient(ADMIN_EMAIL!, ADMIN_PASS!);
    userA = await signedClient(USER_A_EMAIL!, USER_A_PASS!);
    const svc = serviceClient();
    await svc.from('profiles').update({ is_admin: true }).eq('id', admin.userId);
    await svc.from('profiles').update({ is_admin: false }).eq('id', userA.userId);
  });

  afterAll(async () => {
    const svc = serviceClient();
    await svc.from('profiles').update({ is_admin: false }).eq('id', admin.userId);
  });

  it('is_lamplight_admin returns true for admin, false for non-admin', async () => {
    const { data: aData, error: aErr } = await admin.client.rpc('is_lamplight_admin');
    expect(aErr).toBeNull();
    expect(aData).toBe(true);

    const { data: uData, error: uErr } = await userA.client.rpc('is_lamplight_admin');
    expect(uErr).toBeNull();
    expect(uData).toBe(false);
  });

  it('is_lamplight_admin returns false for unauthenticated callers', async () => {
    const anonClient = createClient(SUPABASE_URL!, SUPABASE_ANON!);
    const { data, error } = await anonClient.rpc('is_lamplight_admin');
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it('lamplight_usage: user can read own rows, admin reads all, others blocked', async () => {
    const svc = serviceClient();
    const tag = `usage-rls-${Date.now()}`;

    // userA owns a row.
    const { error: insErr } = await svc.from('lamplight_usage').insert({
      user_id: userA.userId,
      model: 'voyage-3-large',
      artifact_kind: tag,
      tokens_in: 100, tokens_out: 0,
      status: 'ok',
    });
    expect(insErr).toBeNull();

    // userA sees their row.
    const { data: ownData, error: ownErr } = await userA.client
      .from('lamplight_usage').select('id').eq('artifact_kind', tag);
    expect(ownErr).toBeNull();
    expect(ownData?.length).toBe(1);

    // admin sees the same row.
    const { data: admData, error: admErr } = await admin.client
      .from('lamplight_usage').select('id').eq('artifact_kind', tag);
    expect(admErr).toBeNull();
    expect(admData?.length).toBe(1);

    // Direct INSERT from authenticated client is blocked (no INSERT policy).
    const { error: blockedErr } = await userA.client
      .from('lamplight_usage').insert({
        user_id: userA.userId,
        model: 'voyage-3-large',
        artifact_kind: `${tag}-blocked`,
        tokens_in: 0, tokens_out: 0,
        status: 'ok',
      });
    expect(blockedErr).not.toBeNull();

    // Cleanup.
    await svc.from('lamplight_usage').delete().eq('artifact_kind', tag);
  });

  it('admin can read another user\'s lamplight_jobs; non-admin cannot', async () => {
    const svc = serviceClient();
    const tag = `job-rls-${Date.now()}`;

    // Insert a job owned by userA via service-role (bypasses RLS).
    const { data: inserted, error: insErr } = await svc.from('lamplight_jobs').insert({
      user_id: userA.userId,
      kind: 'embedding_refresh',
      status: 'failed',
      payload: { note_id: tag, content_hash: 'h' },
      attempts: 3,
      error: 'voyage_500',
      finished_at: new Date().toISOString(),
    }).select('id').single();
    expect(insErr).toBeNull();
    const jobId = inserted!.id as string;

    // Admin sees it.
    const { data: admData, error: admErr } = await admin.client
      .from('lamplight_jobs').select('id').eq('id', jobId);
    expect(admErr).toBeNull();
    expect(admData?.length).toBe(1);

    // Insert a job owned by admin and check userA cannot see it.
    const { data: admOwn, error: admOwnErr } = await svc.from('lamplight_jobs').insert({
      user_id: admin.userId,
      kind: 'embedding_refresh',
      status: 'failed',
      payload: { note_id: `${tag}-admin`, content_hash: 'h' },
      attempts: 3,
      error: 'voyage_500',
      finished_at: new Date().toISOString(),
    }).select('id').single();
    expect(admOwnErr).toBeNull();
    const { data: userViewOfAdmin } = await userA.client
      .from('lamplight_jobs').select('id').eq('id', admOwn!.id);
    expect(userViewOfAdmin?.length ?? 0).toBe(0);

    // Cleanup.
    await svc.from('lamplight_jobs').delete().in('id', [jobId, admOwn!.id]);
  });

  it('admin_list_lamplight_jobs: admin gets rows; non-admin raises', async () => {
    const svc = serviceClient();
    const tag = `list-rpc-${Date.now()}`;
    await svc.from('lamplight_jobs').insert({
      user_id: userA.userId, kind: 'embedding_refresh', status: 'failed',
      payload: { note_id: tag, content_hash: 'h' },
      attempts: 3, error: 'voyage_429',
      finished_at: new Date().toISOString(),
    });

    const { data, error } = await admin.client.rpc('admin_list_lamplight_jobs', {
      p_status: ['failed'], p_user_search: USER_A_EMAIL,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as Array<{ payload: { note_id: string } }>).some(r => r.payload?.note_id === tag)).toBe(true);

    const { error: nonAdmErr } = await userA.client.rpc('admin_list_lamplight_jobs', {});
    expect(nonAdmErr).not.toBeNull();
    expect(nonAdmErr!.message).toMatch(/not authorized/);

    await svc.from('lamplight_jobs').delete().eq('payload->>note_id', tag);
  });

  it('admin_lamplight_job_counts: returns {queued, running, done, failed, since}', async () => {
    const { data, error } = await admin.client.rpc('admin_lamplight_job_counts', {});
    expect(error).toBeNull();
    const obj = data as Record<string, unknown>;
    expect(obj).toHaveProperty('queued');
    expect(obj).toHaveProperty('running');
    expect(obj).toHaveProperty('done');
    expect(obj).toHaveProperty('failed');
    expect(obj).toHaveProperty('since');

    const { error: nonAdmErr } = await userA.client.rpc('admin_lamplight_job_counts', {});
    expect(nonAdmErr).not.toBeNull();
    expect(nonAdmErr!.message).toMatch(/not authorized/);
  });

  it('admin_requeue_lamplight_job resets fields; non-admin raises', async () => {
    const svc = serviceClient();
    const tag = `requeue-${Date.now()}`;
    const { data: inserted } = await svc.from('lamplight_jobs').insert({
      user_id: userA.userId, kind: 'embedding_refresh', status: 'failed',
      payload: { note_id: tag, content_hash: 'h' },
      attempts: 3, error: 'voyage_500',
      finished_at: new Date().toISOString(),
    }).select('*').single();
    const jobId = inserted!.id as string;

    const { data, error } = await admin.client.rpc('admin_requeue_lamplight_job', { p_job_id: jobId });
    expect(error).toBeNull();
    const row = data as { status: string; attempts: number; error: string | null; finished_at: string | null };
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(0);
    expect(row.error).toBeNull();
    expect(row.finished_at).toBeNull();

    const { error: nonAdmErr } = await userA.client.rpc('admin_requeue_lamplight_job', { p_job_id: jobId });
    expect(nonAdmErr).not.toBeNull();
    expect(nonAdmErr!.message).toMatch(/not authorized/);

    await svc.from('lamplight_jobs').delete().eq('id', jobId);
  });

  it('admin_requeue_failed_lamplight_jobs returns count requeued; capped at 100', async () => {
    const svc = serviceClient();
    const tag = `bulk-requeue-${Date.now()}`;
    const fakeKind = `embedding_refresh_${tag}`;
    for (let i = 0; i < 3; i++) {
      await svc.from('lamplight_jobs').insert({
        user_id: userA.userId, kind: fakeKind, status: 'failed',
        payload: { note_id: `${tag}-${i}`, content_hash: 'h' },
        attempts: 3, error: 'voyage_500',
        finished_at: new Date().toISOString(),
      });
    }

    const { data, error } = await admin.client.rpc('admin_requeue_failed_lamplight_jobs', {
      p_kind: fakeKind, p_limit: 100,
    });
    expect(error).toBeNull();
    expect(data).toBe(3);

    const { data: rows } = await svc.from('lamplight_jobs').select('status').eq('kind', fakeKind);
    expect(rows!.every(r => r.status === 'queued')).toBe(true);

    await svc.from('lamplight_jobs').delete().eq('kind', fakeKind);
  });

  it('admin_lamplight_usage_top aggregates correctly; non-admin raises', async () => {
    const svc = serviceClient();
    const tag = `usage-top-${Date.now()}`;
    await svc.from('lamplight_usage').insert([
      { user_id: userA.userId, model: 'voyage-3-large', artifact_kind: tag,
        tokens_in: 100, tokens_out: 0, status: 'ok' },
      { user_id: userA.userId, model: 'gpt-5.6-terra', artifact_kind: tag,
        tokens_in: 50, tokens_out: 30, status: 'ok' },
      { user_id: userA.userId, model: 'voyage-3-large', artifact_kind: tag,
        tokens_in: 0, tokens_out: 0, status: 'error', error_code: 'voyage_429' },
    ]);

    const { data, error } = await admin.client.rpc('admin_lamplight_usage_top', {
      p_window_days: 7, p_limit: 200,
    });
    expect(error).toBeNull();
    const rows = data as Array<{ user_id: string; tokens_in: number; tokens_out: number; calls: number; errors: number }>;
    const mine = rows.find(r => r.user_id === userA.userId);
    expect(mine).toBeTruthy();
    expect(Number(mine!.tokens_in)).toBeGreaterThanOrEqual(150);
    expect(Number(mine!.tokens_out)).toBeGreaterThanOrEqual(30);
    expect(Number(mine!.errors)).toBeGreaterThanOrEqual(1);

    const { error: nonAdmErr } = await userA.client.rpc('admin_lamplight_usage_top', {});
    expect(nonAdmErr).not.toBeNull();
    expect(nonAdmErr!.message).toMatch(/not authorized/);

    await svc.from('lamplight_usage').delete().eq('artifact_kind', tag);
  });
});
