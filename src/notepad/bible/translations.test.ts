import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, DEFAULT_TRANSLATION, isBibleTranslation, translationInfo, passageRowsTranslation } from './translations';

describe('translations registry', () => {
  it('exposes BSB, KJV, WEB, NLT, ESV with labels and attribution', () => {
    expect(TRANSLATIONS.map((t) => t.id)).toEqual(['BSB', 'KJV', 'WEB', 'NLT', 'ESV']);
    for (const t of TRANSLATIONS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.fullName.length).toBeGreaterThan(0);
      expect(t.attribution.length).toBeGreaterThan(0);
    }
  });
  it('keeps the public-domain trio local and the licensed pair api-sourced', () => {
    expect(translationInfo('BSB').source).toBe('local');
    expect(translationInfo('KJV').source).toBe('local');
    expect(translationInfo('WEB').source).toBe('local');
    expect(translationInfo('NLT').source).toBe('api');
    expect(translationInfo('ESV').source).toBe('api');
  });
  it('carries the publisher copyright lines both licences require', () => {
    expect(translationInfo('NLT').attribution).toMatch(/Tyndale House/);
    expect(translationInfo('ESV').attribution).toMatch(/Crossway/);
  });
  it('defaults to BSB', () => { expect(DEFAULT_TRANSLATION).toBe('BSB'); });
  it('guards unknown values', () => {
    expect(isBibleTranslation('KJV')).toBe(true);
    expect(isBibleTranslation('ESV')).toBe(true);
    expect(isBibleTranslation('NIV')).toBe(false);
    expect(isBibleTranslation(null)).toBe(false);
  });
  it('returns info by id', () => { expect(translationInfo('KJV').fullName).toMatch(/King James/i); });
  it('stands local translations in for themselves and api ones in for BSB', () => {
    expect(passageRowsTranslation('KJV')).toBe('KJV');
    expect(passageRowsTranslation('WEB')).toBe('WEB');
    expect(passageRowsTranslation('NLT')).toBe('BSB');
    expect(passageRowsTranslation('ESV')).toBe('BSB');
  });
});
