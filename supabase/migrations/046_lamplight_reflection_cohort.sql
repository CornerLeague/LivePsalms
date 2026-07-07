-- Waymarks scheduled generation (§8, §11): pick each Plus user whose local month just
-- closed and who has notes there but no reflection yet, enqueue a lamplight_jobs row per
-- cohort member, and sweep-post the generate function once per hour to drain the queue.
-- Idempotent — the ON CONFLICT + not-exists guards make re-firing safe.
--
-- FINAL-REVIEW FIX (job-queue sweep, mirrors 011's embedding_refresh architecture): the
-- original version of this file POSTed `{kind, user_id, period_key}` straight at a raw
-- Edge Function URL per cohort row — a dead path, because (a) the vault secret it read
-- was embed-note's URL, whose contract is `{job_id}`/`{sweep:true}` and 400s anything
-- else, and (b) even repointed at lamplight-generate, that function derives identity
-- ONLY from the caller's bearer JWT (never body.user_id), so a service-role sweep call
-- has no user and gets 401. The fix below enqueues jobs instead of calling per-user, then
-- fires ONE `{"sweep":true}` POST — exactly how 011 drains embedding_refresh.

-- 1. Cohort selector -------------------------------------------------------------
create or replace function public.select_monthly_reflection_cohort()
returns table (user_id uuid, period_key text)
language sql
stable
security definer
set search_path = public
as $$
  with plus_users as (
    select e.user_id, coalesce(s.timezone, 'UTC') as tz
    from lamplight_entitlements e
    left join lamplight_settings s on s.user_id = e.user_id
    -- roll-up 7 (final-review rider): never sweep a user who has opted out of
    -- Lamplight entirely — coalesce false so a missing settings row (not yet
    -- opted in) also excludes them, matching 008's `enabled boolean not null
    -- default false` (opt-in is off until the user explicitly turns it on).
    where e.tier = 'plus' and coalesce(s.enabled, false)
  ),
  closed_month as (
    select
      pu.user_id,
      pu.tz,
      to_char(date_trunc('month', (now() at time zone pu.tz)) - interval '1 month', 'YYYY-MM') as period_key,
      date_trunc('month', (now() at time zone pu.tz)) - interval '1 month' as local_start,
      date_trunc('month', (now() at time zone pu.tz))                       as local_end
    from plus_users pu
  )
  select cm.user_id, cm.period_key
  from closed_month cm
  where exists (
    select 1 from notes n
    where n.user_id = cm.user_id
      and (n.created_at at time zone cm.tz) >= cm.local_start
      and (n.created_at at time zone cm.tz) <  cm.local_end
  )
  and not exists (
    select 1 from lamplight_artifacts a
    where a.user_id = cm.user_id and a.type = 'reflection_recap' and a.period_key = cm.period_key
  )
  and not exists (
    select 1 from lamplight_jobs j
    where j.kind = 'monthly_reflection'
      and j.user_id = cm.user_id
      and j.payload->>'period_key' = cm.period_key
      and j.status = 'failed'
      and j.attempts >= 3 -- 3 = RETRY_ATTEMPT_CAP (spec §17)
  );
$$;

revoke execute on function public.select_monthly_reflection_cohort() from public, anon, authenticated;

-- 2. Hourly enqueue + sweep --------------------------------------------------------
-- Step 1 (enqueue): turn each cohort row into a lamplight_jobs row instead of calling
-- the user out directly. RETRY-CAP FIX (controller-found): a plain INSERT created a
-- FRESH row every hour for a persistently-failing (user, period) — the 045 partial
-- unique index (lamplight_jobs_active_period_uniq, arbiter columns (user_id, kind,
-- (payload->>'period_key')) where status in ('queued','running')) only dedupes
-- queued/running duplicates, so it never blocked a new INSERT against an existing
-- `failed` row, and attempts on that new row always started at 0 — the ledger's
-- RETRY_ATTEMPT_CAP (spec §17) could never be reached. Fixed by resurrecting a failed
-- sub-cap row IN PLACE (status -> 'queued', attempts preserved) instead of inserting a
-- duplicate, so attempts genuinely accumulates 1->2->3 across hourly cycles; only a
-- (user, period) with NO existing job row (first-ever enqueue, or the row was already
-- cleared by a success/ineligibility disposal) gets a fresh INSERT. Data-modifying CTEs
-- share one snapshot, so the INSERT cannot see the UPDATE's effect — hence the explicit
-- `not exists resurrected` anti-join AND the `not exists failed-row` guard (the latter
-- also covers failed-at-cap rows the cohort somehow still selected — belt only, the
-- cohort already excludes those). The 045 arbiter clause stays: it still guards
-- queued/running duplicates across concurrent cron firings, same as before.
-- Step 2 (sweep): ONE net.http_post of {"sweep": true} to lamplight-generate, using the
-- SAME vault + service_role_key header idiom as 011's sweep — but reading a NEW vault
-- secret (lamplight_generate_fn_url) rather than reusing embed_fn_url, since that secret
-- points at the embed-note function, not this one (see docs/lamplight/post-deploy-signal-layer.md).
select cron.schedule(
  'lamplight_reflection_sweep',
  '0 * * * *',
  $cron$
  with cohort as (
    select user_id, period_key from public.select_monthly_reflection_cohort()
  ),
  resurrected as (
    -- A failed sub-cap row is re-queued IN PLACE (attempts preserved) so the ledger
    -- accumulates 1->2->3 across hourly cycles; at 3 (= RETRY_ATTEMPT_CAP, spec §17) the
    -- cohort's deferred exclusion stops selecting this (user, period) entirely.
    update public.lamplight_jobs j
       set status = 'queued'
      from cohort c
     where j.user_id = c.user_id
       and j.kind = 'monthly_reflection'
       and j.payload->>'period_key' = c.period_key
       and j.status = 'failed'
       and j.attempts < 3 -- 3 = RETRY_ATTEMPT_CAP (spec §17)
    returning j.user_id, j.payload->>'period_key' as period_key
  )
  insert into public.lamplight_jobs (user_id, kind, payload, status)
  select c.user_id, 'monthly_reflection', jsonb_build_object('period_key', c.period_key), 'queued'
    from cohort c
   where not exists (select 1 from resurrected r
                      where r.user_id = c.user_id and r.period_key = c.period_key)
     and not exists (select 1 from public.lamplight_jobs j
                      where j.user_id = c.user_id and j.kind = 'monthly_reflection'
                        and j.payload->>'period_key' = c.period_key
                        and j.status = 'failed')
  on conflict (user_id, kind, (payload->>'period_key')) where status in ('queued','running') do nothing;

  with config as (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'lamplight_generate_fn_url') as url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')           as key
  )
  select net.http_post(
    url := config.url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || config.key,
      'Content-Type', 'application/json'
    ),
    body := '{"sweep": true}'::jsonb
  )
  from config
  where config.url is not null and config.key is not null;
  $cron$
);

-- 3. Claim RPC (sibling of claim_lamplight_jobs, kind pinned) ---------------------
create or replace function public.claim_lamplight_reflection_jobs(p_limit int)
returns setof public.lamplight_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update lamplight_jobs j
     set status = 'running', started_at = now()
   where j.id in (
     select id from lamplight_jobs
      where status = 'queued'
        and scheduled_at <= now()
        and kind = 'monthly_reflection'
      order by scheduled_at
      limit p_limit
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke execute on function public.claim_lamplight_reflection_jobs(int) from public, anon, authenticated;
