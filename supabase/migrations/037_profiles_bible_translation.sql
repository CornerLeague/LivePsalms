-- 037_profiles_bible_translation.sql
-- Per-user default Bible translation (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
alter table public.profiles
  add column bible_translation text not null default 'BSB';
