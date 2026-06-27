// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const useRegionMap = vi.fn();
vi.mock('./useRegionMap', () => ({ useRegionMap: (b: string) => useRegionMap(b) }));
vi.mock('./ZoomableMap', () => ({
  ZoomableMap: ({ image, overlayTopRight }: { image: { src: string; alt: string }; overlayTopRight?: React.ReactNode }) => (
    <div style={{ position: 'relative' }}>
      <img src={image.src} alt={image.alt} />
      {overlayTopRight && <div style={{ position: 'absolute', top: 8, right: 8 }}>{overlayTopRight}</div>}
    </div>
  ),
}));

import { RegionMapBlock } from './RegionMapBlock';
import type { RegionMap } from './region-maps';

const map: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'Today.', attribution: 'Wikimedia', license: 'Pending human review' },
};

describe('RegionMapBlock', () => {
  afterEach(cleanup);

  it('renders nothing for an unmapped book', () => {
    useRegionMap.mockReturnValue(null);
    const { container } = render(<RegionMapBlock book="jas" />);
    expect(container.firstChild).toBeNull();
  });

  it('is collapsed by default and expands on click', () => {
    useRegionMap.mockReturnValue(map);
    render(<RegionMapBlock book="jhn" />);
    const toggle = screen.getByRole('button', { name: /map of the region/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tablist')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('opens fullscreen and restores focus to the expand trigger on close', () => {
    useRegionMap.mockReturnValue(map);
    render(<RegionMapBlock book="jhn" />);
    fireEvent.click(screen.getByRole('button', { name: /map of the region/i }));
    const expand = screen.getByRole('button', { name: /expand map/i });
    expand.focus();
    fireEvent.click(expand);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(expand);
  });
});
