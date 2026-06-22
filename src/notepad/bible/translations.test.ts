import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, DEFAULT_TRANSLATION, isBibleTranslation, translationInfo } from './translations';

describe('translations registry', () => {
  it('exposes BSB, KJV, WEB with labels and attribution', () => {
    expect(TRANSLATIONS.map((t) => t.id)).toEqual(['BSB', 'KJV', 'WEB']);
    for (const t of TRANSLATIONS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.fullName.length).toBeGreaterThan(0);
      expect(t.attribution.length).toBeGreaterThan(0);
    }
  });
  it('defaults to BSB', () => { expect(DEFAULT_TRANSLATION).toBe('BSB'); });
  it('guards unknown values', () => {
    expect(isBibleTranslation('KJV')).toBe(true);
    expect(isBibleTranslation('NIV')).toBe(false);
    expect(isBibleTranslation(null)).toBe(false);
  });
  it('returns info by id', () => { expect(translationInfo('KJV').fullName).toMatch(/King James/i); });
});
