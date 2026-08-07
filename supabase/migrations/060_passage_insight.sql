-- 060_passage_insight.sql
-- Study Insights Door 1 ("The Passage"): the generated, globally shared cache.
--
-- Insights are NOT personal. The historical setting of Psalm 27 is the same for
-- every reader, so a generated door is a public asset: generated once by
-- whoever opens the passage first, then served to everyone as a plain DB read.
-- That mirrors bible_etymology_verse_insight (migration 048), which established
-- the pattern — public read, service-role write, prompt_version stamped so the
-- rows stay reviewable and a targeted refresh stays possible.
--
-- Two grains only, `chapter` and single `verse`. Arbitrary ranges would explode
-- the key space (Psalm 119 alone has 15,576 of them); a multi-verse selection
-- resolves to the chapter grain in the client.

create table if not exists public.bible_passage_insight (
  scope           text not null check (scope in ('verse', 'chapter')),
  ref_id          text not null,                 -- 'psa.27.4' | 'psa.27'
  -- Narrow on purpose. B3 adds 'deeper'; until then a typo must not write rows
  -- nobody ever reads back.
  door            text not null check (door in ('passage')),
  section         text not null,                 -- 'overview' | 'in_chapter' | 'chapter_shape' | 'reflection'
  -- May be empty: a section with no warrant in the grounding renders nothing
  -- rather than filler, and an empty body is a real, cacheable answer.
  body            text not null,
  sources         jsonb not null default '[]',   -- library chunk provenance
  model_used      text,
  -- Load-bearing for the refresh script: rows are served regardless of version
  -- (a reader is never blocked by a prompt bump), so this column is the only
  -- way to find what is stale later.
  prompt_version  text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  primary key (scope, ref_id, section)
);

-- A whole door loads in one query.
create index if not exists bible_passage_insight_door
  on public.bible_passage_insight (scope, ref_id, door);

-- Finds everything generated under a superseded prompt, for scripts/refresh-passage-insights.ts.
create index if not exists bible_passage_insight_prompt_version
  on public.bible_passage_insight (prompt_version);

alter table public.bible_passage_insight enable row level security;

-- Public read: a cached door costs a DB query and is free to everyone, signed
-- out included. Generation is gated in the edge function, not here.
create policy "bible_passage_insight public read"
  on public.bible_passage_insight for select
  using (true);

-- No insert/update/delete policy: writes are service-role only, which bypasses
-- RLS. A reader can never write a row.
