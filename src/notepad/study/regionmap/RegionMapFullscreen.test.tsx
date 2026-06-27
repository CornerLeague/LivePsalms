// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);

vi.mock('./ZoomableMap', () => ({
  ZoomableMap: ({ image }: { image: { src: string; alt: string } }) => <img src={image.src} alt={image.alt} />,
}));

import { RegionMapFullscreen } from './RegionMapFullscreen';
import type { RegionMap } from './region-maps';

const map: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'Today.', attribution: 'Wikimedia', license: 'Pending human review' },
};

describe('RegionMapFullscreen', () => {
  it('renders a modal dialog containing the map', () => {
    render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByAltText('Roman Judea, first century')).toBeTruthy();
  });

  it('closes via the ✕ button', () => {
    const onClose = vi.fn();
    render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close fullscreen/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the Escape key', () => {
    const onClose = vi.fn();
    render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open and restores it on close', () => {
    const { unmount } = render(<RegionMapFullscreen map={map} activeTab="then" onTabChange={() => {}} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
