// src/notepad-landing/sections/garden-scene/garden-scene.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GardenScene } from './garden-scene';

// mount-garden depends on WebGL which jsdom does not implement. Stub it.
vi.mock('../../three/garden/mount-garden', () => ({
  mountGarden: () => ({ cleanup: () => {} }),
}));

function renderScene(prm: boolean) {
  return render(
    <MemoryRouter>
      <div className="notepad-landing">
        <GardenScene prm={prm} />
      </div>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('<GardenScene /> — active mode (prm=false)', () => {
  it('renders the canvas, paper overlay, progress nav, and spacer', () => {
    renderScene(false);
    expect(document.querySelector('canvas.garden-canvas')).toBeInTheDocument();
    expect(document.querySelector('.garden-paper-overlay')).toBeInTheDocument();
    expect(document.querySelector('#garden-spacer')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /go to station/i })).toHaveLength(7);
  });

  it('first station has id="section-02" for hero CTA anchor compatibility', () => {
    renderScene(false);
    const target = document.getElementById('section-02');
    expect(target).not.toBeNull();
    expect(target?.className).toContain('garden-station--three-voices');
  });

  it('first station is active on initial render', () => {
    renderScene(false);
    const first = document.querySelector('.garden-station--three-voices');
    expect(first?.className).toContain('active');
  });
});

describe('<GardenScene /> — PRM mode (prm=true)', () => {
  it('does NOT render the canvas, overlay, progress, or spacer', () => {
    renderScene(true);
    expect(document.querySelector('canvas.garden-canvas')).toBeNull();
    expect(document.querySelector('.garden-paper-overlay')).toBeNull();
    expect(document.querySelector('#garden-spacer')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /go to station/i })).toHaveLength(0);
  });

  it('renders all seven section components from FallbackStack', () => {
    renderScene(true);
    // Each fallback section has a known heading from data/copy.ts
    expect(screen.getByRole('heading', { name: /psalm 119 calls the word a lamp to your feet/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /we make taking notes effortless/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your notes share connections just like the scriptures share connections\./i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /open any passage\. study it with your own notes in hand/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /a page that actually looks like yours/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your work counts/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your personal journey\. your prayer life\. your intimate walk with god\./i })).toBeInTheDocument();
  });
});

describe('<GardenScene /> — Living Graph station layout', () => {
  it('wraps the Living Graph text and (future) video slot in a .garden-station-pair grid', () => {
    renderScene(false);
    const station = document.querySelector('.garden-station--living-graph');
    expect(station).not.toBeNull();
    const pair = station?.querySelector('.garden-station-pair');
    expect(pair).not.toBeNull();
    expect(pair?.querySelector('.garden-station-content--left')).not.toBeNull();
    expect(pair?.querySelector('.living-graph-video-wrap')).not.toBeNull();
  });

  it('renders a muted, looping, playsInline video pointing at the shared graph assets', () => {
    renderScene(false);
    const video = document.querySelector<HTMLVideoElement>('.living-graph-video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('poster')).toBe('/notepad-feature-video-poster.jpg');

    const sources = Array.from(video?.querySelectorAll('source') ?? []);
    const srcs = sources.map((s) => s.getAttribute('src'));
    expect(srcs).toContain('/notepad-feature-video.webm');
    expect(srcs).toContain('/notepad-feature-video.mp4');
  });
});

describe('<GardenScene /> — Seven Papers station layout', () => {
  it('wraps the Seven Papers text and video in a .garden-station-pair grid', () => {
    renderScene(false);
    const station = document.querySelector('.garden-station--seven-papers');
    expect(station).not.toBeNull();
    const pair = station?.querySelector('.garden-station-pair');
    expect(pair).not.toBeNull();
    expect(pair?.querySelector('.garden-station-content--left')).not.toBeNull();
    expect(pair?.querySelector('.seven-papers-video-wrap')).not.toBeNull();
  });

  it('renders a muted, looping, playsInline video pointing at the highlight-deco feature assets', () => {
    renderScene(false);
    const video = document.querySelector<HTMLVideoElement>('.seven-papers-video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('poster')).toBe('/notepad-highlight-deco-feature-poster.jpg');
    const sources = Array.from(video?.querySelectorAll('source') ?? []);
    const srcs = sources.map((s) => s.getAttribute('src'));
    expect(srcs).toContain('/notepad-highlight-deco-feature.webm');
    expect(srcs).toContain('/notepad-highlight-deco-feature.mp4');
  });
});

describe('<GardenScene /> — Scripture Margin station layout', () => {
  it('wraps the Scripture Margin text and video in a .garden-station-pair grid', () => {
    renderScene(false);
    const station = document.querySelector('.garden-station--scripture-margin');
    expect(station).not.toBeNull();
    const pair = station?.querySelector('.garden-station-pair');
    expect(pair).not.toBeNull();
    expect(pair?.querySelector('.garden-station-content--left')).not.toBeNull();
    expect(pair?.querySelector('.scripture-margin-video-wrap')).not.toBeNull();
  });

  it('renders a muted, looping, playsInline video pointing at the bible-study assets', () => {
    renderScene(false);
    const video = document.querySelector<HTMLVideoElement>('.scripture-margin-video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('poster')).toBe('/notepad-bible-study-video-poster.jpg');
    const sources = Array.from(video?.querySelectorAll('source') ?? []);
    const srcs = sources.map((s) => s.getAttribute('src'));
    expect(srcs).toContain('/notepad-bible-study-video.webm');
    expect(srcs).toContain('/notepad-bible-study-video.mp4');
  });
});

describe('<GardenScene /> — Connections station layout', () => {
  it('wraps the Connections text and video in a .garden-station-pair grid', () => {
    renderScene(false);
    const station = document.querySelector('.garden-station--connections');
    expect(station).not.toBeNull();
    const pair = station?.querySelector('.garden-station-pair');
    expect(pair).not.toBeNull();
    expect(pair?.querySelector('.garden-station-content--left')).not.toBeNull();
    expect(pair?.querySelector('.connections-video-wrap')).not.toBeNull();
  });

  it('renders a muted, looping, playsInline video pointing at the connections assets', () => {
    renderScene(false);
    const video = document.querySelector<HTMLVideoElement>('.connections-video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.getAttribute('poster')).toBe('/notepad-connections-video-poster.jpg');
    const sources = Array.from(video?.querySelectorAll('source') ?? []);
    const srcs = sources.map((s) => s.getAttribute('src'));
    expect(srcs).toContain('/notepad-connections-video.webm');
    expect(srcs).toContain('/notepad-connections-video.mp4');
  });
});
