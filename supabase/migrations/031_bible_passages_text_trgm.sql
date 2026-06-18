-- Trigram GIN index over BSB verse text for the /verse prefix picker.
-- Backs the anchored `text ILIKE 'query%'` lookup (verses that *begin* with what
-- the user typed) so it stays fast as bible_passages grows. pg_trgm GIN supports
-- both prefix and contains ILIKE patterns.
--
-- Perf-only: the prefix search is correct without this index (the verse table is
-- small enough to seq-scan in a few ms); the index just keeps it index-backed at
-- scale. Public-read RLS already present on bible_passages (009); adds no policy.

create extension if not exists pg_trgm;

create index if not exists bible_passages_text_trgm
  on public.bible_passages using gin (text gin_trgm_ops);
