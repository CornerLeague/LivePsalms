import { describe, it, expect } from 'vitest';
import { REGION_MAPS } from './region-maps';

describe('REGION_MAPS registry integrity', () => {
  it('has at least the seed regions', () => {
    expect(REGION_MAPS['judah-monarchy']).toBeDefined();
    expect(REGION_MAPS['judea-roman']).toBeDefined();
  });

  it('every region has complete then/now image metadata and a matching key', () => {
    for (const [key, region] of Object.entries(REGION_MAPS)) {
      expect(region.key).toBe(key);
      expect(region.label.length).toBeGreaterThan(0);
      for (const tab of ['then', 'now'] as const) {
        const img = region[tab];
        expect(img.src, `${key}.${tab}.src`).toMatch(/^\/maps\/[a-z0-9-]+\/(then|now)\.(jpg|png|webp)$/);
        expect(img.alt.length, `${key}.${tab}.alt`).toBeGreaterThan(0);
        expect(img.caption.length, `${key}.${tab}.caption`).toBeGreaterThan(0);
        expect(img.attribution.length, `${key}.${tab}.attribution`).toBeGreaterThan(0);
        expect(img.license.length, `${key}.${tab}.license`).toBeGreaterThan(0);
      }
    }
  });
});
