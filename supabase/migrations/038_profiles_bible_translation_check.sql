-- 038_profiles_bible_translation_check.sql
-- Constrain profiles.bible_translation to the supported public-domain set.
--
-- 037 added the column (text, default 'BSB') but with no CHECK, so a direct
-- write (a migration, an admin script, or a future edge function) could persist
-- an out-of-vocabulary value that would silently degrade to the BSB fallback
-- everywhere it is read. This constraint keeps the schema self-documenting and
-- prevents enum drift. All existing rows are 'BSB'/'KJV'/'WEB' (the app validates
-- every write and the column defaults to 'BSB'), so the constraint validates
-- cleanly against current data.
--
-- Kept as a separate migration (not folded into 037) because 037 is already
-- applied to production; editing an applied migration would diverge the recorded
-- history. Adding the allowed set here means widening it later is a one-line
-- follow-up migration that drops + re-adds this named constraint.
alter table public.profiles
  add constraint profiles_bible_translation_check
  check (bible_translation in ('BSB', 'KJV', 'WEB'));
