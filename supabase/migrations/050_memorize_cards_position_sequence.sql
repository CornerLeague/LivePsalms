-- supabase/migrations/050_memorize_cards_position_sequence.sql
-- Greptile finding on PR #88: the client computed `position = max(existing)+1`
-- in SupabaseMemorizeAdapter.add, which races — two concurrent signed-in writers
-- can read the same max and write the same position (a tie; ordering-only, no
-- data loss, but real). Fix: move position allocation SERVER-SIDE onto a
-- Postgres sequence used as the column DEFAULT, so it is atomic and unique
-- across concurrent inserts (same pattern Postgres uses internally for `serial`).
-- Additive/behavioral only — does not touch existing rows, RLS, or policies.
create sequence if not exists public.memorize_cards_position_seq;

alter table public.memorize_cards
  alter column position set default nextval('public.memorize_cards_position_seq');

-- Tie the sequence's lifecycle to the column it backs (what `serial` does
-- implicitly), so it is dropped automatically if the column/table is dropped.
alter sequence public.memorize_cards_position_seq
  owned by public.memorize_cards.position;

-- Seed the sequence strictly above the current max so newly-assigned positions
-- never collide with existing rows. `is_called = false` means the NEXT call to
-- nextval() returns exactly this value (not value+1). With 0 existing rows,
-- COALESCE(max, 0) + 1 = 1, so the first sequence-assigned position is 1.
select setval(
  'public.memorize_cards_position_seq',
  coalesce((select max(position) from public.memorize_cards), 0) + 1,
  false
);

-- A signed-in INSERT that omits `position` evaluates the column DEFAULT
-- (nextval) AS the `authenticated` role under RLS. Supabase does not
-- auto-grant sequence privileges to `authenticated`/`service_role` — same as
-- tables and functions, sequences need an explicit GRANT (see Supabase's own
-- "grant ... on all sequences in schema ... to postgres, anon, authenticated,
-- service_role" pattern for db-pull permission fixes). Without USAGE here,
-- every signed-in add() would fail with "permission denied for sequence
-- memorize_cards_position_seq" — a full prod outage for Memorize inserts.
grant usage, select on sequence public.memorize_cards_position_seq to authenticated;
grant usage, select on sequence public.memorize_cards_position_seq to service_role;
