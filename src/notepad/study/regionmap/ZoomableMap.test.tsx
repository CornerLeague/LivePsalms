// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// Mock the lazy-loaded library so the dynamic import resolves deterministically.
vi.mock('react-zoom-pan-pinch', () => ({
  TransformWrapper: ({ children }: { children: unknown }) => (
    <div>{typeof children === 'function' ? (children as (r: { zoomIn: () => void; zoomOut: () => void }) => unknown)({ zoomIn: () => {}, zoomOut: () => {} }) : (children as React.ReactNode)}</div>
  ),
  TransformComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ZoomableMap } from './ZoomableMap';

const image = { src: '/maps/judea-roman/then.jpg', alt: 'A map of Roman Judea', caption: 'c', attribution: 'a', license: 'Public Domain' };

describe('ZoomableMap', () => {
  it('renders the image with its alt text', async () => {
    render(<ZoomableMap image={image} height={210} />);
    expect(await screen.findByAltText('A map of Roman Judea')).toBeTruthy();
  });

  it('shows a fallback when the image fails to load', async () => {
    render(<ZoomableMap image={image} height={210} />);
    const imgs = screen.getAllByAltText('A map of Roman Judea') as HTMLImageElement[];
    const img = imgs[imgs.length - 1]; // Get the most recent instance
    // Manually trigger the onError by calling the handler directly (jsdom limitation workaround)
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: img, enumerable: true });
    img.dispatchEvent(event);
    expect(await screen.findByText(/unavailable/i)).toBeTruthy();
  });

  it('renders an overlay slot when provided', async () => {
    render(<ZoomableMap image={image} height={210} overlayTopRight={<button>EXPANDO</button>} />);
    expect(await screen.findByText('EXPANDO')).toBeTruthy();
  });

  it('clears the unavailable fallback when the image changes (switching back to a working tab)', async () => {
    const { rerender } = render(<ZoomableMap image={image} height={210} />);
    const imgs = screen.getAllByAltText('A map of Roman Judea') as HTMLImageElement[];
    const img = imgs[imgs.length - 1];
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: img, enumerable: true });
    img.dispatchEvent(event);
    expect(await screen.findByText(/unavailable/i)).toBeTruthy();

    const other = { ...image, src: '/maps/judah-monarchy/then.jpg', alt: 'A different region map' };
    rerender(<ZoomableMap image={other} height={210} />);
    expect(screen.queryByText(/unavailable/i)).toBeNull();
    expect(await screen.findByAltText('A different region map')).toBeTruthy();
  });
});
