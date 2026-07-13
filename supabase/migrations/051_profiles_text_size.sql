-- 051_profiles_text_size.sql
-- Shared 3-level text-size preference for BOTH the Journal note editor and the
-- Bible/Study reader (cross-device). localStorage remains the device-level
-- fast path; this column syncs the preference for signed-in users.
-- Modeled on verse layout (040): a plain owner-writable column guarded only by
-- RLS, NOT a privileged column — the 021 protect_privileged_profile_columns
-- trigger guards only is_admin / note_count / highest_note_count, so a normal
-- owner UPDATE of text_size passes.
alter table public.profiles
  add column text_size text not null default 'base';

alter table public.profiles
  add constraint profiles_text_size_check
  check (text_size in ('base', 'large', 'xlarge'));
