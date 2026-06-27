-- supabase/migrations/041_bible_lexicon.sql
-- Original-language interlinear + Strong's lexicon. Public read (reference data,
-- not user-scoped), mirroring bible_books / bible_cross_references. verse_id is
-- the translation-independent OSIS id (book.chapter.verse) used as the id prefix
-- in bible_passages (lowercase OSIS book codes).

create table public.bible_interlinear (
  verse_id text not null,                       -- OSIS id, e.g. 'jhn.3.16'
  position integer not null,                    -- word order within the verse, from 1
  original text not null,                        -- Hebrew/Aramaic/Greek script
  transliteration text not null default '',
  strongs text,                                  -- e.g. 'H430','G2316'; null for some particles
  morph text not null default '',                -- morphology / part of speech
  gloss text not null default '',                -- short English gloss
  language text not null check (language in ('hebrew', 'aramaic', 'greek')),
  primary key (verse_id, position)
);

create index bible_interlinear_verse on public.bible_interlinear (verse_id);

alter table public.bible_interlinear enable row level security;
create policy "Anyone can read bible_interlinear"
  on public.bible_interlinear for select using (true);

create table public.bible_strongs (
  strongs text primary key,                      -- e.g. 'H430'
  lemma text not null default '',
  transliteration text not null default '',
  pronunciation text not null default '',
  short_def text not null default '',
  full_def text not null default '',
  language text not null check (language in ('hebrew', 'aramaic', 'greek'))
);

alter table public.bible_strongs enable row level security;
create policy "Anyone can read bible_strongs"
  on public.bible_strongs for select using (true);
