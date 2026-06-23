-- 040_profiles_bible_verse_layout.sql
-- Per-user Bible verse layout (cross-device). localStorage remains the
-- device-level fast path; this column syncs the preference for signed-in users.
-- Modeled on theme (039): a plain owner-writable column guarded only by RLS,
-- NOT a privileged column — the 021 protect_privileged_profile_columns trigger
-- guards only is_admin / note_count / highest_note_count, so a normal owner
-- UPDATE of bible_verse_layout passes.
alter table public.profiles
  add column bible_verse_layout text not null default 'inline';

alter table public.profiles
  add constraint profiles_bible_verse_layout_check
  check (bible_verse_layout in ('inline', 'lines', 'spaced'));
