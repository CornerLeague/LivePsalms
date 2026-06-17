-- supabase/migrations/033_bible_cross_references.sql
-- Cross-references derived from OpenBible.info (CC BY, TSK-derived), ~340k links.
-- Public read (reference data). Data loaded by scripts/ingest-cross-references.ts.
-- crosses_testament lets the rail surface OT<->NT connections specially.

create table public.bible_cross_references (
  id bigint generated always as identity primary key,
  from_book text not null,                 -- lowercase OSIS, matches bible_passages.book
  from_chapter integer not null,
  from_verse integer not null,
  to_book text not null,
  to_chapter integer not null,
  to_verse_start integer not null,
  to_verse_end integer not null,
  votes integer not null default 0,        -- relevance weight; order by desc for top-N
  crosses_testament boolean not null default false,
  source text not null default 'OpenBible.info (CC BY)',
  unique (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end)
);

create index bible_cross_references_from
  on public.bible_cross_references (from_book, from_chapter, from_verse, votes desc);
create index bible_cross_references_crosses
  on public.bible_cross_references (from_book, from_chapter, from_verse)
  where crosses_testament = true;

alter table public.bible_cross_references enable row level security;

create policy "Anyone can read bible_cross_references"
  on public.bible_cross_references for select using (true);
