-- 058_library.sql — the Lamplight grounding corpus (depth overhaul, slice 1b).
--
-- Two tables of PUBLIC reference data, mirroring bible_passages /
-- bible_cross_references: anyone may read, only the service role writes.
-- Content is loaded by scripts/ingest-library.ts; see
-- docs/runbooks/library-ingest.md for the per-source license evidence trail.
--
-- library_sources is the attribution registry — its `attribution` column is
-- rendered verbatim by the in-app Sources screen, which is how the CC-BY
-- obligations (OpenBible.info, STEPBible) are satisfied. Do not drop a source
-- row while its chunks are live.
--
-- Vector conventions follow migration 016: `extensions.vector(512)` is
-- fully-qualified everywhere (a function's `set search_path` applies at runtime,
-- not at CREATE FUNCTION parse time, so an unqualified `vector(512)` in a
-- signature fails with "type vector does not exist"), and the HNSW index uses
-- `extensions.vector_cosine_ops`. Same 512-dim voyage-context-3 space as
-- lamplight_embeddings, so one query embedding serves notes, Bible, and library.

-- ── Sources ───────────────────────────────────────────────────────────────
create table public.library_sources (
  id text primary key,                    -- 'treasury-of-david'
  title text not null,                    -- 'The Treasury of David'
  author text not null,                   -- 'Charles H. Spurgeon'
  era text not null,                      -- '1869–1885'
  tradition text not null,                -- 'Baptist (Reformed)'
  register text not null check (register in ('devotional','exegetical','confessional','lexical','topical')),
  license text not null,                  -- 'Public domain' | 'CC BY 4.0' | 'Unlicense'
  attribution text not null,              -- render-ready credit line, shown verbatim in-app
  ingest_version integer not null default 1,
  created_at timestamptz not null default now()
);

-- ── Chunks ────────────────────────────────────────────────────────────────
-- One row per retrievable excerpt. Verse anchors are nullable: confessional,
-- lexical, and topical chunks are not tied to a passage. Anchored rows use the
-- same lowercase-OSIS book codes as bible_passages, normalized through STEPBible
-- TVTMS at ingest so KJV-keyed classics align with BSB numbering.
create table public.library_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.library_sources(id) on delete cascade,
  book text,                              -- lowercase OSIS, e.g. 'psa'
  chapter integer,
  verse_start integer,
  verse_end integer,
  strongs text,                           -- lexical chunks only, e.g. 'H7462'
  topic text,                             -- topical chunks only, e.g. 'anxiety'
  heading text not null,                  -- the source's own section label
  content text not null,
  token_count integer not null,
  embedding extensions.vector(512),       -- null until the ingest embedding pass runs
  created_at timestamptz not null default now()
);

-- Idempotency key for re-runnable ingest. `nulls not distinct` (PG15+) makes the
-- nullable anchor columns compare as equal rather than always-distinct, so a
-- re-run updates the same row instead of inserting a duplicate. Plain columns
-- (not an expression index) so PostgREST `on_conflict` can target it.
-- Same pattern as lamplight_embeddings' source uniqueness constraint.
create unique index library_chunks_ident
  on public.library_chunks (source_id, heading, book, chapter, verse_start)
  nulls not distinct;

-- Verse-anchor retrieval channel: chunks overlapping a given book+chapter.
create index library_chunks_verse
  on public.library_chunks (book, chapter, verse_start, verse_end);

create index library_chunks_source on public.library_chunks (source_id);

create index library_chunks_strongs
  on public.library_chunks (strongs) where strongs is not null;

create index library_chunks_topic
  on public.library_chunks (topic) where topic is not null;

-- Semantic retrieval channel.
create index library_chunks_embedding_hnsw
  on public.library_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ── RLS: public read, service-role write ──────────────────────────────────
alter table public.library_sources enable row level security;
alter table public.library_chunks enable row level security;

create policy "Anyone can read library_sources"
  on public.library_sources for select using (true);

create policy "Anyone can read library_chunks"
  on public.library_chunks for select using (true);

-- ── Semantic match RPC ────────────────────────────────────────────────────
-- Mirrors match_bible_embeddings: SECURITY DEFINER, search_path pinned so the
-- `<=>` operator resolves, revoked from public + authenticated (edge functions
-- call it with the service role). p_registers filters by source register, which
-- is how Today's Lamp asks for devotional voices only.
create or replace function public.match_library_chunks(
  p_query_vector extensions.vector(512),
  p_limit int default 50,
  p_registers text[] default null
)
returns table (
  id uuid,
  source_id text,
  heading text,
  content text,
  similarity float,
  book text,
  chapter int,
  verse_start int,
  verse_end int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.id,
         c.source_id,
         c.heading,
         c.content,
         1 - (c.embedding <=> p_query_vector) as similarity,
         c.book,
         c.chapter,
         c.verse_start,
         c.verse_end
    from public.library_chunks c
    join public.library_sources s on s.id = c.source_id
   where c.embedding is not null
     and (p_registers is null or s.register = any(p_registers))
   order by c.embedding <=> p_query_vector
   limit p_limit
$$;

revoke execute on function public.match_library_chunks(extensions.vector(512), int, text[])
  from public, authenticated;
