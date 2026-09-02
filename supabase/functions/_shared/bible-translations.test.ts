import { describe, it, expect } from 'vitest';
import { VALID_TRANSLATIONS, isValidTranslation } from './bible-translations';
import { TRANSLATIONS } from '../../../src/notepad/bible/translations';

describe('edge-function translation allowlist', () => {
  it('matches the client registry exactly', () => {
    expect([...VALID_TRANSLATIONS]).toEqual(TRANSLATIONS.map((t) => t.id));
  });
  it('guards values', () => {
    expect(isValidTranslation('NLT')).toBe(true);
    expect(isValidTranslation('NIV')).toBe(false);
    expect(isValidTranslation(undefined)).toBe(false);
  });
});
