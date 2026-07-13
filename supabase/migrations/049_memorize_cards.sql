-- supabase/migrations/049_memorize_cards.sql
-- Per-user Memorize cards: a flat, per-user set of memorization cards (card = one
-- verse). Unlike scripture_focus_lists (which store ref-only), a card SNAPSHOTS the
-- verse text + translation so a quiz stays stable even if the reader's translation
-- later changes. Owner-only RLS mirrors 042_scripture_focus_lists.sql
-- (auth.uid() = user_id; user_id references public.profiles, not auth.users).
create table if not exists public.memorize_cards (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  book              text not null,        -- OSIS abbrev, e.g. 'jhn'
  chapter           integer not null,
  verse             integer not null,     -- one verse per card
  translation       text not null,        -- snapshot's translation, e.g. 'BSB'
  text              text not null,        -- frozen snapshot of the verse text
  mastery           integer not null default 0,   -- 0-100
  attempts          integer not null default 0,
  last_practiced_at timestamptz,          -- null until first practice
  position          integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, book, chapter, verse, translation)
);

create index if not exists memorize_cards_user_idx
  on public.memorize_cards (user_id, position);

alter table public.memorize_cards enable row level security;

-- Owner-only on every verb.
create policy "Users can view own memorize cards"
  on public.memorize_cards for select using (auth.uid() = user_id);
create policy "Users can insert own memorize cards"
  on public.memorize_cards for insert with check (auth.uid() = user_id);
create policy "Users can update own memorize cards"
  on public.memorize_cards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own memorize cards"
  on public.memorize_cards for delete using (auth.uid() = user_id);

-- Reuse the shared updated_at trigger fn (defined once in 003_triggers.sql).
create trigger memorize_cards_updated_at
  before update on public.memorize_cards
  for each row execute function public.update_updated_at();
