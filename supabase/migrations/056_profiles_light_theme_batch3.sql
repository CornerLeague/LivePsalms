-- 056_profiles_light_theme_batch3.sql
-- Third batch of light-mode palettes: maple-spice, licorice, soft-sand,
-- olive-gray, abyssal-teal. Widens the light_theme check constraint; run
-- after 054 (works whether or not 054/055 were already applied, as long as
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
    'plum-wine',
    'maple-spice',
    'licorice',
    'soft-sand',
    'olive-gray',
    'abyssal-teal'
  ));
