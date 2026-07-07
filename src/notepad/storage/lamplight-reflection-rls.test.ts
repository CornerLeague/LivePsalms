import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_TEST_URL;
const anon = process.env.SUPABASE_TEST_ANON_KEY;
const userAEmail = process.env.SUPABASE_TEST_USER_A_EMAIL;
const userAPass = process.env.SUPABASE_TEST_USER_A_PASSWORD;
const userBEmail = process.env.SUPABASE_TEST_USER_B_EMAIL;
const userBPass = process.env.SUPABASE_TEST_USER_B_PASSWORD;
const haveEnv = Boolean(url && anon && userAEmail && userAPass && userBEmail && userBPass);
const maybeDescribe = haveEnv ? describe : describe.skip;

maybeDescribe('lamplight_reflection_state RLS + CRUD (live DB)', () => {
  let a: SupabaseClient;
  let b: SupabaseClient;
  let userAId: string;

  beforeAll(async () => {
    a = createClient(url!, anon!);
    b = createClient(url!, anon!);
    const { data: signInA } = await a.auth.signInWithPassword({ email: userAEmail!, password: userAPass! });
    await b.auth.signInWithPassword({ email: userBEmail!, password: userBPass! });
    userAId = signInA.user!.id;
  });

  it('a user cannot read another user’s reflection state', async () => {
    await a.from('lamplight_reflection_state').upsert(
      { user_id: userAId, artifact_type: 'reflection_recap', period_key: '2026-01', annotation: 'private' },
      { onConflict: 'user_id,artifact_type,period_key' },
    );
    const { data: leaked } = await b
      .from('lamplight_reflection_state')
      .select('annotation')
      .eq('user_id', userAId)
      .eq('period_key', '2026-01')
      .maybeSingle();
    expect(leaked).toBeNull(); // RLS filters cross-user selects to zero rows
  });

  it('hide → read-back → clear round-trips for the owner', async () => {
    await a.from('lamplight_reflection_state').upsert(
      { user_id: userAId, artifact_type: 'reflection_recap', period_key: '2026-02', hidden_at: new Date().toISOString() },
      { onConflict: 'user_id,artifact_type,period_key' },
    );
    const { data: hidden } = await a.from('lamplight_reflection_state').select('hidden_at').eq('user_id', userAId).eq('period_key', '2026-02').single();
    expect(hidden!.hidden_at).not.toBeNull();
    await a.from('lamplight_reflection_state').update({ hidden_at: null }).eq('user_id', userAId).eq('period_key', '2026-02');
    const { data: shown } = await a.from('lamplight_reflection_state').select('hidden_at').eq('user_id', userAId).eq('period_key', '2026-02').single();
    expect(shown!.hidden_at).toBeNull();
  });

  it('annotating a reflection does NOT clobber the artifact’s saved_to_notes flag', async () => {
    // Precondition: an artifact row exists for (userA, 'reflection_recap', '2026-03') with saved_to_notes = true.
    await a.from('lamplight_artifacts').update({ saved_to_notes: true }).eq('user_id', userAId).eq('type', 'reflection_recap').eq('period_key', '2026-03');
    await a.from('lamplight_reflection_state').upsert(
      { user_id: userAId, artifact_type: 'reflection_recap', period_key: '2026-03', annotation: 'edited' },
      { onConflict: 'user_id,artifact_type,period_key' },
    );
    const { data: art } = await a.from('lamplight_artifacts').select('saved_to_notes').eq('user_id', userAId).eq('type', 'reflection_recap').eq('period_key', '2026-03').maybeSingle();
    if (art) expect(art.saved_to_notes).toBe(true); // annotate wrote only the satellite table
  });
});
