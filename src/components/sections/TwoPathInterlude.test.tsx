// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

afterEach(cleanup);

function setMatchMedia(hoverable: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('hover: hover') ? hoverable : false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// Provide a baseline matchMedia stub before any module-level gsap side-effects fire.
setMatchMedia(true);

describe('TwoPathInterlude', () => {
  beforeEach(() => {
    setMatchMedia(true);
    vi.resetModules();
  });

  it('renders the mobile-only "— or —" label', async () => {
    setMatchMedia(true);
    vi.resetModules();
    const { TwoPathInterlude } = await import('./TwoPathInterlude');
    render(
      <MemoryRouter>
        <TwoPathInterlude />
      </MemoryRouter>,
    );
    expect(screen.getByText(/—\s*or\s*—/)).toBeInTheDocument();
  });

  it('renders plain CTA labels (single occurrence each) on touch devices', async () => {
    setMatchMedia(false);
    vi.resetModules();
    const { TwoPathInterlude } = await import('./TwoPathInterlude');
    const { container } = render(
      <MemoryRouter>
        <TwoPathInterlude />
      </MemoryRouter>,
    );
    // On touch: plain <span class="two-path-cta-label"> renders — no TextStaggerHover wrapper.
    const labels = container.querySelectorAll('span.two-path-cta-label');
    expect(labels).toHaveLength(2);
    const texts = Array.from(labels).map((el) => el.textContent);
    expect(texts).toContain('Read Below');
    expect(texts).toContain('Open your Notebook');
  });

  it('renders TextStaggerHover (duplicated label spans) when (hover: hover) matches', async () => {
    setMatchMedia(true);
    vi.resetModules();
    const { TwoPathInterlude } = await import('./TwoPathInterlude');
    const { container } = render(
      <MemoryRouter>
        <TwoPathInterlude />
      </MemoryRouter>,
    );
    // TextStaggerHover renders an Active + a Hidden (aria-hidden) child span,
    // each splitting text into per-character motion spans. The outer wrapper
    // gets class "two-path-cta-label relative inline-block align-baseline".
    // On hover mode, the label spans are TextStaggerHover wrappers (not plain spans).
    const readBelowLabels = container.querySelectorAll(
      'span.two-path-cta-label.relative',
    );
    expect(readBelowLabels.length).toBeGreaterThanOrEqual(2);
  });
});
