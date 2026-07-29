import { describe, it, expect } from 'vitest';
import {
  isLightTheme,
  lightThemeAttribute,
  LIGHT_THEMES,
  LIGHT_THEME_META,
} from './theme-types';

describe('isLightTheme', () => {
  it('accepts every member of LIGHT_THEMES', () => {
    for (const t of LIGHT_THEMES) expect(isLightTheme(t)).toBe(true);
  });

  it('rejects non-members and non-strings', () => {
    expect(isLightTheme('neon')).toBe(false);
    expect(isLightTheme(null)).toBe(false);
    expect(isLightTheme(undefined)).toBe(false);
    expect(isLightTheme(3)).toBe(false);
  });
});

describe('LIGHT_THEME_META', () => {
  it('covers every light theme exactly once, classic first', () => {
    expect(LIGHT_THEME_META.map((m) => m.slug)).toEqual([...LIGHT_THEMES]);
    expect(LIGHT_THEME_META[0].slug).toBe('classic');
  });
});

describe('lightThemeAttribute', () => {
  const notepadPath = '/notebook/notes';

  it('returns the palette on a notepad route in resolved light', () => {
    expect(lightThemeAttribute(notepadPath, 'light', 'stormy-sky')).toBe('stormy-sky');
  });

  it('returns null for classic (attribute-free default)', () => {
    expect(lightThemeAttribute(notepadPath, 'light', 'classic')).toBeNull();
  });

  it('returns null while dark is resolved — dark always wins', () => {
    expect(lightThemeAttribute(notepadPath, 'dark', 'graphite')).toBeNull();
  });

  it('returns null off notepad routes so marketing/auth never recolor', () => {
    expect(lightThemeAttribute('/', 'light', 'olive-grove')).toBeNull();
    expect(lightThemeAttribute('/about', 'light', 'olive-grove')).toBeNull();
  });
});
