// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';

afterEach(() => cleanup());

vi.mock('./ZoomableMap', () => ({
  ZoomableMap: ({ image, overlayTopRight }: { image: { src: string; alt: string }; overlayTopRight?: React.ReactNode }) => (
    <div><img src={image.src} alt={image.alt} />{overlayTopRight}</div>
  ),
}));

import { RegionMapView } from './RegionMapView';
import type { RegionMap, MapTab } from './region-maps';

const map: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea and Galilee in the first century AD.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'The same region today.', attribution: 'Wikimedia', license: 'Pending human review' },
};

function Harness() {
  const [tab, setTab] = useState<MapTab>('then');
  return <RegionMapView map={map} activeTab={tab} onTabChange={setTab} />;
}

const comingSoonMap: RegionMap = {
  key: 'judea-roman',
  label: 'Roman Judea & Galilee',
  then: { src: '/maps/judea-roman/then.jpg', alt: 'Roman Judea, first century', caption: 'Roman Judea and Galilee in the first century AD.', attribution: 'Smith 1915', license: 'Public Domain' },
  now: { src: '/maps/judea-roman/now.jpg', alt: 'Modern Israel reference map', caption: 'The same region today.', attribution: 'not yet sourced', license: 'Pending human review', comingSoon: true },
};

function ComingSoonHarness() {
  const [tab, setTab] = useState<MapTab>('then');
  return <RegionMapView map={comingSoonMap} activeTab={tab} onTabChange={setTab} />;
}

describe('RegionMapView', () => {
  it('swaps the image and caption when the Today tab is selected', () => {
    render(<Harness />);
    expect(screen.getByAltText('Roman Judea, first century')).toBeTruthy();
    expect(screen.getByText('Roman Judea and Galilee in the first century AD.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    expect(screen.getByAltText('Modern Israel reference map')).toBeTruthy();
    expect(screen.getByText('The same region today.')).toBeTruthy();
  });

  it('exposes both tabs with correct aria-selected state', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Biblical times' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('false');
  });

  it('wires the content pane as a tabpanel labelled by the active tab', () => {
    render(<Harness />);
    const panel = screen.getByRole('tabpanel');
    const activeTab = screen.getByRole('tab', { selected: true });
    expect(panel.id).toBeTruthy();
    expect(activeTab.id).toBeTruthy();
    expect(panel.getAttribute('aria-labelledby')).toBe(activeTab.id);
    expect(activeTab.getAttribute('aria-controls')).toBe(panel.id);

    // The single panel re-labels to whichever tab is active after a switch.
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      screen.getByRole('tab', { selected: true }).id,
    );
  });

  it('fires onExpand from the expand button when provided', () => {
    const onExpand = vi.fn();
    render(<RegionMapView map={map} activeTab="then" onTabChange={() => {}} onExpand={onExpand} />);
    fireEvent.click(screen.getByRole('button', { name: /expand map/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('switches tabs via ArrowRight and ArrowLeft', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Biblical times' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Today' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Biblical times' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows a "coming soon" message on the Today tab (no image) and restores the Biblical-times map on switch back', () => {
    render(<ComingSoonHarness />);
    expect(screen.getByAltText('Roman Judea, first century')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    expect(screen.queryByAltText('Modern Israel reference map')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Biblical times' }));
    expect(screen.getByAltText('Roman Judea, first century')).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});
