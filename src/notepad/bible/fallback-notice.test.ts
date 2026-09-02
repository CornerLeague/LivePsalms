import { describe, it, expect } from 'vitest';
import { searchFallbackNotice, readerFallbackNotice, lamplightFallbackNotice } from './fallback-notice';

describe('fallback notices', () => {
  it('are silent for every local translation', () => {
    for (const t of ['BSB', 'KJV', 'WEB'] as const) {
      expect(searchFallbackNotice(t)).toBeNull();
      expect(readerFallbackNotice(t)).toBeNull();
      expect(lamplightFallbackNotice(t)).toBeNull();
    }
  });

  it('name both the shown translation and the BSB stand-in for api ones', () => {
    expect(searchFallbackNotice('NLT')).toBe("Results are BSB text — NLT can't be searched.");
    expect(readerFallbackNotice('ESV')).toMatch(/BSB/);
    expect(lamplightFallbackNotice('ESV')).toBe('Lamplight quotes Scripture from the BSB, not the ESV.');
  });
});
