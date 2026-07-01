-- supabase/migrations/042_scripture_focus_lists.sql
-- Per-user Scripture Focus Lists: a curated, ordered set of verses pulled up as a
-- clean reading stack (e.g. following along in a church service). Items store the
-- REFERENCE + a denormalized label, never verse text -- text is fetched live per
-- the active translation. Owner-only RLS mirrors 027_bible_highlights.sql
-- (auth.uid() = user_id; user_id references public.profiles, not auth.users).
create table if not exists public.scripture_focus_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.scripture_focus_list_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.scripture_focus_lists(id) on delete cascade,
  book        text not null,        -- OSIS abbrev, e.g. 'eph'
  chapter     integer not null,
  verse_start integer not null,
  verse_end   integer not null,     -- = verse_start for a single verse
  label       text not null,        -- denormalized display ref, e.g. 'Ephesians 2:8'
  position    integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists scripture_focus_lists_user_idx
  on public.scripture_focus_lists (user_id, position);
create index if not exists scripture_focus_list_items_list_idx
  on public.scripture_focus_list_items (list_id, position);

alter table public.scripture_focus_lists enable row level security;
alter table public.scripture_focus_list_items enable row level security;

-- Lists: owner-only on every verb.
create policy "Users can view own focus lists"
  on public.scripture_focus_lists for select using (auth.uid() = user_id);
create policy "Users can insert own focus lists"
  on public.scripture_focus_lists for insert with check (auth.uid() = user_id);
create policy "Users can update own focus lists"
  on public.scripture_focus_lists for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own focus lists"
  on public.scripture_focus_lists for delete using (auth.uid() = user_id);

-- Items: scoped through the parent list's owner.
create policy "Users can view own focus list items"
  on public.scripture_focus_list_items for select
  using (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "Users can insert own focus list items"
  on public.scripture_focus_list_items for insert
  with check (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "Users can update own focus list items"
  on public.scripture_focus_list_items for update
  using (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "Users can delete own focus list items"
  on public.scripture_focus_list_items for delete
  using (exists (select 1 from public.scripture_focus_lists l where l.id = list_id and l.user_id = auth.uid()));
