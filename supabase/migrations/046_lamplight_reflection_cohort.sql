-- Waymarks scheduled generation (§8, §11): pick each Plus user whose local month just
-- closed and who has notes there but no reflection yet, and POST the generate function
-- once per hour. Idempotent — the upsert + not-exists guards make re-firing safe.

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
    where e.tier = 'plus'
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
      and j.attempts >= 3
  );
$$;

revoke execute on function public.select_monthly_reflection_cohort() from public, anon, authenticated;

-- 2. Hourly sweep ----------------------------------------------------------------
-- MIRROR migration 011's sweep verbatim for the vault + net.http_post idiom.
select cron.schedule(
  'lamplight_reflection_sweep',
  '0 * * * *',
  $cron$
  do $$
  declare
    fn_url   text := (select decrypted_secret from vault.decrypted_secrets where name = 'embed_fn_url');
    svc_key  text := (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key');
    target   record;
  begin
    if fn_url is null or svc_key is null then
      return;
    end if;
    for target in select * from public.select_monthly_reflection_cohort() loop
      perform net.http_post(
        url     := fn_url,
        headers := jsonb_build_object('Authorization', 'Bearer ' || svc_key, 'Content-Type', 'application/json'),
        body    := jsonb_build_object('kind', 'monthly_reflection', 'user_id', target.user_id, 'period_key', target.period_key)
      );
    end loop;
  end;
  $$;
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
