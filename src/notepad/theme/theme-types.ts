export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'] as const;
export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Light-mode palette, independent of the light/dark/system mode above. Only
 * takes effect while the resolved mode is light; dark always renders the one
 * dark palette. 'classic' means no data-theme attribute — the untouched
 * `:root` light look.
 */
export type LightTheme =
  | 'classic'
  | 'ivory-sand'
  | 'oat-milk'
  | 'blush-petal'
  | 'stormy-sky'
  | 'olive-grove'
  | 'terracotta-clay'
  | 'graphite'
  | 'vanilla-latte'
  | 'matcha-brew'
  | 'roman-coffee'
  | 'plum-wine';

export const LIGHT_THEMES: readonly LightTheme[] = [
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
] as const;
export const DEFAULT_LIGHT_THEME: LightTheme = 'classic';

export function isLightTheme(value: unknown): value is LightTheme {
  return (LIGHT_THEMES as readonly unknown[]).includes(value);
}

/**
 * Picker metadata. Swatch hexes mirror the theme's CSS block in index.css
 * (page surface / body ink / accent) so the menu chips preview the real look.
 */
export const LIGHT_THEME_META: readonly {
  slug: LightTheme;
  label: string;
  swatch: { bg: string; ink: string; accent: string };
}[] = [
  { slug: 'classic', label: 'Classic', swatch: { bg: '#F0ECE8', ink: '#3A3426', accent: '#C49A78' } },
  { slug: 'ivory-sand', label: 'Ivory Sand', swatch: { bg: '#E4D6C5', ink: '#6F4429', accent: '#A5673F' } },
  { slug: 'oat-milk', label: 'Oat Milk', swatch: { bg: '#F2EDE2', ink: '#575B3F', accent: '#C47A5C' } },
  { slug: 'blush-petal', label: 'Blush Petal', swatch: { bg: '#E7B9B2', ink: '#6E3641', accent: '#9E4C58' } },
  { slug: 'stormy-sky', label: 'Stormy Sky', swatch: { bg: '#78898F', ink: '#F2EDE2', accent: '#D9C7A8' } },
  { slug: 'olive-grove', label: 'Olive Grove', swatch: { bg: '#6E775C', ink: '#F2EDE2', accent: '#C9B584' } },
  { slug: 'terracotta-clay', label: 'Terracotta', swatch: { bg: '#C47A5C', ink: '#F6EBDD', accent: '#7E4530' } },
  { slug: 'graphite', label: 'Graphite', swatch: { bg: '#4A4947', ink: '#EFECE6', accent: '#C49A78' } },
  { slug: 'vanilla-latte', label: 'Vanilla Latte', swatch: { bg: '#B5A391', ink: '#3C3129', accent: '#7A5C42' } },
  { slug: 'matcha-brew', label: 'Matcha Brew', swatch: { bg: '#677D6A', ink: '#F0EAD6', accent: '#D9D3AC' } },
  { slug: 'roman-coffee', label: 'Roman Coffee', swatch: { bg: '#796254', ink: '#F2E7DC', accent: '#E3C9AD' } },
  { slug: 'plum-wine', label: 'Plum Wine', swatch: { bg: '#754B4D', ink: '#F0DFDA', accent: '#DFB0AA' } },
] as const;

/** True when the path is a notepad workspace route that should be dark-eligible. */
export function isNotepadRoute(pathname: string): boolean {
  return pathname.startsWith('/notebook/notes') || pathname.startsWith('/notebook/u/');
}

/** Whether `.dark` should be on <html> for this route + resolved theme. */
export function shouldApplyDark(pathname: string, resolved: ResolvedTheme): boolean {
  return resolved === 'dark' && isNotepadRoute(pathname);
}

/**
 * The `data-theme` attribute value <html> should carry for this route + resolved
 * theme + palette, or null for none. Same route gating as `.dark`; dark mode and
 * 'classic' both mean "no attribute" so the existing palettes stay byte-for-byte.
 */
export function lightThemeAttribute(
  pathname: string,
  resolved: ResolvedTheme,
  lightTheme: LightTheme,
): Exclude<LightTheme, 'classic'> | null {
  if (resolved !== 'light' || lightTheme === 'classic' || !isNotepadRoute(pathname)) return null;
  return lightTheme;
}
