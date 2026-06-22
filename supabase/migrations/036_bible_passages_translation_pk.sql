-- 036_bible_passages_translation_pk.sql
-- Allow multiple translations per verse reference. `id` stays the pure OSIS
-- reference ("jhn.1.1"); `translation` joins it in the primary key so BSB, KJV,
-- and WEB "jhn.1.1" coexist. All existing rows are translation='BSB', so there
-- is no collision and no data rewrite.

alter table public.bible_passages drop constraint bible_passages_pkey;
alter table public.bible_passages add primary key (translation, id);

-- Reads filter by translation then book/chapter (chapter scan) — index the triple.
create index if not exists bible_passages_translation_book_chapter
  on public.bible_passages (translation, book, chapter);
