import { describe, it, expect } from 'vitest';
import { navItems } from './projects';

describe('navItems', () => {
  it('points the Purpose entry at the marketing home page', () => {
    const purpose = navItems.find((item) => item.label === 'Purpose');
    expect(purpose).toBeDefined();
    expect(purpose?.href).toBe('/home');
  });

  it('no longer links to the removed /purpose stack page', () => {
    expect(navItems.some((item) => item.href === '/purpose')).toBe(false);
  });
});
