// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

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
  afterEach(() => cleanup());
  it('renders the image with its alt text', async () => {
    render(<ZoomableMap image={image} height={210} />);
    expect(await screen.findByAltText('A map of Roman Judea')).toBeTruthy();
  });

  it('shows a fallback when the image fails to load', async () => {
    render(<ZoomableMap image={image} height={210} />);
    const img = screen.getByAltText('A map of Roman Judea') as HTMLImageElement;
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
});
