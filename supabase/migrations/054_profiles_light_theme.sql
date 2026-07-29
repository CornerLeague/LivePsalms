-- 054_profiles_light_theme.sql
-- Per-user light-mode palette (cross-device), independent of the light/dark/
-- system mode in theme (039). Only takes effect while the resolved mode is
-- light; 'classic' is the untouched default light look. localStorage remains
-- the device-level fast path; this column syncs for signed-in users.
-- Modeled on theme (039) / text_size (051): a plain owner-writable column
-- guarded only by RLS, NOT a privileged column — the 021
-- protect_privileged_profile_columns trigger guards only is_admin /
-- note_count / highest_note_count, so a normal owner UPDATE of light_theme
-- passes.
alter table public.profiles
  add column light_theme text not null default 'classic';

alter table public.profiles
  add constraint profiles_light_theme_check
  check (light_theme in (
    'classic',
    'ivory-sand',
    'oat-milk',
    'blush-petal',
    'stormy-sky',
    'olive-grove',
    'terracotta-clay',
    'graphite'
  ));
