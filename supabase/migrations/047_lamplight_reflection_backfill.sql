-- Waymarks backfill discovery (§10): the last 12 local months a Plus reader wrote in but
-- has no reflection for yet. Client-callable and auth.uid()-scoped; RLS applies (security invoker).

create or replace function public.list_reflection_backfill_targets()
returns table (period_key text)
language sql
stable
security invoker
set search_path = public
as $$
  with tz as (
    select coalesce((select timezone from lamplight_settings where user_id = auth.uid()), 'UTC') as zone
  ),
  note_months as (
    select distinct
      to_char(date_trunc('month', (n.created_at at time zone (select zone from tz))), 'YYYY-MM') as period_key
    from notes n
    where n.user_id = auth.uid()
  )
  select nm.period_key
  from note_months nm
  where nm.period_key < to_char(date_trunc('month', (now() at time zone (select zone from tz))), 'YYYY-MM')
    and not exists (
      select 1 from lamplight_artifacts a
      where a.user_id = auth.uid() and a.type = 'reflection_recap' and a.period_key = nm.period_key
    )
  order by nm.period_key desc
  limit 12;
$$;

grant execute on function public.list_reflection_backfill_targets() to authenticated;
