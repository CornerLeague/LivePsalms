-- 039_profiles_theme.sql
-- Per-user notepad color theme (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
-- Modeled on bible_translation (037/038): a plain owner-writable column, NOT a
-- privileged column — the 021 protect_privileged_profile_columns trigger guards
-- only is_admin / note_count / highest_note_count, so a normal owner UPDATE of
-- theme passes (verified by profiles-privileged-columns.test.ts).
alter table public.profiles
  add column theme text not null default 'system';

alter table public.profiles
  add constraint profiles_theme_check
  check (theme in ('light', 'dark', 'system'));
