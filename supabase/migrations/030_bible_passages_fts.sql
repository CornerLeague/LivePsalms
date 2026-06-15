-- Full-text search over BSB verse text for the /verse keyword picker.
-- Stored generated column so the GIN index is on materialized tsvector data.
-- Language 'english' (BSB is English-only in v1). Public-read RLS already
-- present on bible_passages (009); FTS adds no new policy.

alter table public.bible_passages
  add column if not exists text_tsv tsvector
  generated always as (to_tsvector('english', text)) stored;

create index if not exists bible_passages_text_tsv
  on public.bible_passages using gin (text_tsv);
