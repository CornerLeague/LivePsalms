// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';

// Drive useIsMobile from a mutable ref so a single mounted instance can be
// re-rendered across the mobile breakpoint — exactly what a window resize does
// in the real app (the dock stays mounted; only the hook's return value flips).
const mobileState = { value: true };
vi.mock('@/hooks/use-mobile', () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => mobileState.value,
}));

import { MobileBottomDock } from './MobileBottomDock';

afterEach(cleanup);

describe('MobileBottomDock — hook stability across a breakpoint resize', () => {
  it('does not crash when the viewport flips mobile → desktop while mounted', () => {
    mobileState.value = true;
    const { rerender, container } = render(
      <MemoryRouter><MobileBottomDock /></MemoryRouter>,
    );
    expect(container.querySelector('[data-testid="mobile-bottom-dock"]')).not.toBeNull();

    // A hook placed after `if (!isMobile) return null` makes the desktop render
    // run one fewer hook than the prior mobile render, so React throws
    // "Rendered fewer hooks than expected" and the whole tree unmounts.
    mobileState.value = false;
    expect(() =>
      rerender(<MemoryRouter><MobileBottomDock /></MemoryRouter>),
    ).not.toThrow();
    expect(container.querySelector('[data-testid="mobile-bottom-dock"]')).toBeNull();
  });

  it('does not crash when the viewport flips desktop → mobile while mounted', () => {
    mobileState.value = false;
    const { rerender, container } = render(
      <MemoryRouter><MobileBottomDock /></MemoryRouter>,
    );
    expect(container.querySelector('[data-testid="mobile-bottom-dock"]')).toBeNull();

    mobileState.value = true;
    expect(() =>
      rerender(<MemoryRouter><MobileBottomDock /></MemoryRouter>),
    ).not.toThrow();
    expect(container.querySelector('[data-testid="mobile-bottom-dock"]')).not.toBeNull();
  });
});
