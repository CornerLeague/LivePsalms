-- 062_profiles_bible_translation_widen.sql
-- Widen profiles.bible_translation to admit the two api-sourced translations,
-- NLT and ESV. This is the "one-line follow-up" migration 038 was written to
-- make possible: it named its CHECK constraint so widening is a drop + re-add.
--
-- No other schema change is needed. bible_passages is untouched — its
-- (translation, id) primary key from 036 stays as it is, and NOTHING is ever
-- written to it for NLT or ESV: their text is fetched on demand by the
-- bible-text edge function and cached only in browser session memory, because
-- the ESV free licence forbids storing more than 500 verses locally.
alter table public.profiles
  drop constraint profiles_bible_translation_check;
alter table public.profiles
  add constraint profiles_bible_translation_check
  check (bible_translation in ('BSB', 'KJV', 'WEB', 'NLT', 'ESV'));
