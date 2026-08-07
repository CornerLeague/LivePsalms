-- 062_note_distillates.sql
-- Per-note derived signals. Slice 2a creates it with the SAFETY fields only;
-- slice 2b widens it with the distillate signals (themes, posture, questions,
-- scripture engaged). One row per note, one place to look, one place to delete
-- — which is why 2a does not put the classification in a table of its own and
-- then need a second home three weeks later.
--
-- ⚠️ THIS IS DERIVED PERSONAL DATA. It says something about what a person wrote
-- in their journal, so it inherits every protection the source has: the same
-- owner-only RLS as `notes`, and the same delete cascade. A note deleted takes
-- its distillate with it.
--
-- WHY `lament` IS ITS OWN CLASS, not folded into `ok`:
--
-- This app exists for people writing their worst days. Its frame is
-- Brueggemann's disorientation and its corpus is the Psalter, which contains an
-- entire psalm (88) that ends in darkness with no resolution. The likeliest way
-- the crisis layer fails is by working too well — firing on lament and
-- replacing the app's most important moments with a resource card.
--
-- `lament` therefore records distinctly. It is the number that says whether
-- that failure is materialising, and a schema that cannot express it cannot
-- measure it. `ok` and `lament` behave identically at the gate; they differ
-- only in what they let us count.

create table if not exists public.note_distillates (
  note_id            uuid primary key references public.notes(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,

  -- ── safety (2a) ────────────────────────────────────────────────────────
  -- NULL = not yet classified. The gate treats NULL exactly as it treats
  -- 'risk': withheld from generation. See _shared/note-safety.ts — the
  -- asymmetry is deliberate and argued in the design's §1.2.
  safety_class       text check (safety_class in ('ok', 'lament', 'risk')),
  classified_at      timestamptz,
  classifier_version text,
  -- Did the cheap deterministic prefilter fire on this note? Recorded so the
  -- prefilter's precision is measurable later. It decides nothing on its own.
  prefilter_hit      boolean not null default false,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists note_distillates_user
  on public.note_distillates (user_id);

-- The backfill and the "is anything still unclassified?" check both scan for
-- NULL safety_class, and that query runs over every note a user owns.
create index if not exists note_distillates_unclassified
  on public.note_distillates (user_id)
  where safety_class is null;

alter table public.note_distillates enable row level security;

-- Mirrors public.notes exactly (migration 002). Owner-only, all four verbs.
-- The classification is written by the service role inside the edge function,
-- which bypasses RLS — these policies exist so the OWNER can read and delete
-- their own derived data, which the transparency contract requires.
create policy "Users can view own note distillates"
  on public.note_distillates for select using (auth.uid() = user_id);
create policy "Users can insert own note distillates"
  on public.note_distillates for insert with check (auth.uid() = user_id);
create policy "Users can update own note distillates"
  on public.note_distillates for update using (auth.uid() = user_id);
create policy "Users can delete own note distillates"
  on public.note_distillates for delete using (auth.uid() = user_id);
