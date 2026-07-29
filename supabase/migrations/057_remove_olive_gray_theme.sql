-- 057_remove_olive_gray_theme.sql
-- Retire the olive-gray palette. Any profile still pointing at it falls back
-- to classic BEFORE the constraint narrows, so the ADD can't fail on existing
-- rows. Clients treat an unknown stored value the same way (allow-list guard
-- in loadEnum / isLightTheme), so nothing breaks in the deploy gap.
update public.profiles
  set light_theme = 'classic'
  where light_theme = 'olive-gray';

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
    'abyssal-teal'
  ));
