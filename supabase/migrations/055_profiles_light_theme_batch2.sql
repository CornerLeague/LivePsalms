-- 055_profiles_light_theme_batch2.sql
-- Second batch of light-mode palettes: vanilla-latte, matcha-brew,
-- roman-coffee, plum-wine. Widens the 054 check constraint; run after 054
-- (works whether or not 054 was already applied to this database, as long as
-- the column exists).
alter table public.profiles
  drop constraint if exists profiles_light_theme_check;

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
    'graphite',
    'vanilla-latte',
    'matcha-brew',
    'roman-coffee',
    'plum-wine'
  ));
