-- supabase/migrations/048_bible_etymology.sql
-- Etymology Study feature (v1: Psalms + Hebrew).
-- Two shared, public-read tables mirroring the bible_strongs caching pattern.
-- Rows are written ONLY by the offline seed script and the etymology-insight
-- edge function, both via the service role (which bypasses RLS) — so SELECT is
-- the only policy either table needs.

create table if not exists public.bible_etymology (
  strongs        text primary key,
  lemma          text not null,
  root           text not null,
  root_gloss     text not null,
  development    text not null,
  related        jsonb not null default '[]'::jsonb,
  study_value    int  not null default 0,
  source         text not null default '',
  model_used     text,
  prompt_version text,
  reviewed       boolean not null default false,
  created_at     timestamptz not null default now()
);

alter table public.bible_etymology enable row level security;

create policy "bible_etymology public read"
  on public.bible_etymology for select
  using (true);

create table if not exists public.bible_etymology_verse_insight (
  strongs        text not null,
  verse_id       text not null,
  body           text not null,
  model_used     text,
  prompt_version text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  primary key (strongs, verse_id)
);

alter table public.bible_etymology_verse_insight enable row level security;

create policy "bible_etymology_verse_insight public read"
  on public.bible_etymology_verse_insight for select
  using (true);
