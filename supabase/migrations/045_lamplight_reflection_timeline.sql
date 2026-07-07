-- 045_lamplight_reflection_timeline.sql
-- Waymarks (Reflection Timeline) data model. One file, four concerns:
--   1. lamplight_reflection_state  — hide/annotate satellite, natural-key (survives regeneration)
--   2. lamplight_settings.timezone — IANA tz for the local-month-close cohort + client arrival rule
--   3. lamplight_artifacts type CHECK — add 'yearly_reflection' (cairn identity; decision 11)
--   4. lamplight_jobs partial-unique index — one active job per (user, kind, period_key)
-- References public.profiles(id) with RLS auth.uid() = user_id, mirroring 008.

-- ── 1. hide/annotate satellite (spec §3.2, decision 16) ──────────────────────
-- Keyed by the NATURAL key (user_id, artifact_type, period_key), never artifact_id,
-- so state survives any regeneration. Generation NEVER writes this table.
create table public.lamplight_reflection_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  artifact_type text not null
    check (artifact_type in ('reflection_recap','yearly_reflection')),
  period_key text not null,
  hidden_at timestamptz,               -- null = visible
  annotation text,                     -- null = none; ALWAYS rendered as the USER'S words
  annotation_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, artifact_type, period_key)
);

alter table public.lamplight_reflection_state enable row level security;

create policy "Users can view own lamplight_reflection_state"
  on public.lamplight_reflection_state for select using (auth.uid() = user_id);
create policy "Users can insert own lamplight_reflection_state"
  on public.lamplight_reflection_state for insert with check (auth.uid() = user_id);
create policy "Users can update own lamplight_reflection_state"
  on public.lamplight_reflection_state for update using (auth.uid() = user_id);
create policy "Users can delete own lamplight_reflection_state"
  on public.lamplight_reflection_state for delete using (auth.uid() = user_id);

-- reuse existing update_updated_at() (defined in 003_triggers.sql; no params)
create trigger set_lamplight_reflection_state_updated_at
  before update on public.lamplight_reflection_state
  for each row execute function public.update_updated_at();

-- ── 2. timezone column (spec §3.3, decision 13) ──────────────────────────────
alter table public.lamplight_settings add column if not exists timezone text;  -- IANA; null ⇒ UTC fallback

-- ── 3. add 'yearly_reflection' to the artifact type CHECK (spec §3.4, decision 11) ──
-- Constraint from 008 was inline-unnamed → Postgres auto-name lamplight_artifacts_type_check.
alter table public.lamplight_artifacts
  drop constraint if exists lamplight_artifacts_type_check,
  add constraint lamplight_artifacts_type_check
    check (type in ('daily_devotion','weekly_insight','reflection_recap','tier_celebration','yearly_reflection'));

-- ── 4. one active reflection job per (user, kind, period_key) (spec §16 item 1) ──
-- Mirrors the 011 embedding-refresh partial index. Prevents duplicate queued/running
-- jobs for the same month while allowing a fresh attempt after a terminal state.
create unique index if not exists lamplight_jobs_active_period_uniq
  on public.lamplight_jobs (user_id, kind, (payload->>'period_key'))
  where status in ('queued','running');
