-- 061_passage_insight_door_key.sql
-- Study Insights B3: make `door` part of the key, and let the Deeper door exist.
--
-- Migration 060 shipped `primary key (scope, ref_id, section)` — no `door`. That
-- makes ('chapter','psa.27','overview') unique across ALL doors, so a section
-- name shared between two doors would have the second door's write silently
-- overwrite the first's row, and the first door's read (which DOES filter on
-- `door`) would come back with three sections instead of four. B2 wrote that
-- landmine down and left it for B3.
--
-- B3's four section keys — hermeneutics, historical_setting, theology,
-- read_with_care — do not collide with B2's. They are chosen not to, and a test
-- pins it. But "no collision today" is not a constraint, and the table holds
-- ZERO rows, so widening the key is free right now: no rewrite, no dedup, no
-- backfill. It will never be cheaper.
--
-- ⚠️ APPLY AND DEPLOY TOGETHER. Postgres requires an upsert's conflict target to
-- match a real unique constraint, so between this migration landing and the
-- `passage-insight` function being redeployed with
-- `onConflict: 'scope,ref_id,door,section'`, Door 1's generate path fails. It
-- fails LOUDLY rather than corrupting anything, and with 0 rows nobody is
-- affected — but do not leave the window open.
--
-- Re-running is safe: every step below checks the state it is about to change
-- rather than assuming, because 060 taught us that a hand-applied migration gets
-- run twice more often than anyone plans for.

-- ── 1. Widen the door check ──────────────────────────────────────────────────
-- 060 wrote `check (door in ('passage'))` inline, which means the constraint has
-- an AUTO-GENERATED name. Discover it rather than guessing at
-- `bible_passage_insight_door_check` — a guess that is wrong drops nothing and
-- then fails on the add, leaving the narrow check in place and B3 unable to
-- write a single row.
do $$
declare
  check_name text;
begin
  select conname into check_name
  from pg_constraint
  where conrelid = 'public.bible_passage_insight'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%door%';

  if check_name is not null then
    execute format('alter table public.bible_passage_insight drop constraint %I', check_name);
  end if;
end $$;

alter table public.bible_passage_insight
  add constraint bible_passage_insight_door_check
  check (door in ('passage', 'deeper'));

-- ── 2. Put `door` in the primary key ─────────────────────────────────────────
-- Discovered by column list rather than by name, so a re-run is a no-op instead
-- of an error, and so this works whatever 060's PK ended up called.
do $$
declare
  pk_name text;
  pk_cols text;
begin
  select c.conname,
         (select string_agg(a.attname, ',' order by k.ord)
            from unnest(c.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a
              on a.attrelid = c.conrelid and a.attnum = k.attnum)
    into pk_name, pk_cols
  from pg_constraint c
  where c.conrelid = 'public.bible_passage_insight'::regclass
    and c.contype = 'p';

  if pk_cols is distinct from 'scope,ref_id,door,section' then
    if pk_name is not null then
      execute format('alter table public.bible_passage_insight drop constraint %I', pk_name);
    end if;
    execute 'alter table public.bible_passage_insight add primary key (scope, ref_id, door, section)';
  end if;
end $$;

-- ── 3. Drop the index the new key makes redundant ────────────────────────────
-- 060 added (scope, ref_id, door) so a whole door loads in one query. The new
-- primary key's index leads with exactly those three columns, so it serves that
-- query already; a second index would only be another thing to write on insert.
drop index if exists public.bible_passage_insight_door;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: bible_passage_insight_door_check → CHECK (door = ANY (ARRAY['passage','deeper']))
--         primary key → (scope, ref_id, door, section)
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.bible_passage_insight'::regclass
--   order by contype;
