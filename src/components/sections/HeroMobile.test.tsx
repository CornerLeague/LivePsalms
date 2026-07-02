// @vitest-environment jsdom
import { render as rtlRender, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

function render(ui: ReactElement, options?: Parameters<typeof rtlRender>[1]) {
  return rtlRender(ui, { wrapper: MemoryRouter, ...options });
}

function setMatchMedia(opts: { mobile: boolean; reducedMotion?: boolean }) {
  const { mobile, reducedMotion = false } = opts;
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const matches =
      query.includes('reduce') ? reducedMotion :
      query.includes('max-width') ? mobile :
      false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

// jsdom does not provide ResizeObserver; stub it so HeroDesktop can mount.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  (window as unknown as Record<string, unknown>).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(cleanup);

describe('Hero dispatcher', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
  });

  it('renders HeroMobile below 768px', async () => {
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    expect(screen.getByTestId('hero-mobile')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-desktop')).not.toBeInTheDocument();
  });

  it('renders HeroDesktop at or above 768px', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    setMatchMedia({ mobile: false });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    expect(screen.getByTestId('hero-desktop')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-mobile')).not.toBeInTheDocument();
  });
});

describe('HeroMobile content', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
  });

  it('renders the PSALMS wordmark', async () => {
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    expect(screen.getByLabelText(/psalms/i)).toBeInTheDocument();
  });

  it('renders a <video> with /hero_main_video.mp4 src and /tropical_jungle.webp poster', async () => {
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    const video = container.querySelector<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('/hero_main_video.mp4');
    expect(video?.getAttribute('poster')).toBe('/tropical_jungle.webp');
    // Use DOM properties (not hasAttribute) — React may set these as
    // properties rather than attributes on the rendered element.
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
  });

  it('does NOT render the silhouette as an <img> (asset is now a video poster)', async () => {
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    expect(container.querySelector('img[src="/tropical_jungle.webp"]')).toBeNull();
  });

  it('mounts and unmounts cleanly when prefers-reduced-motion is set', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true, reducedMotion: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { unmount } = render(<Hero introActive={false} />);
    expect(() => unmount()).not.toThrow();
  });

  it('renders the quote text and attribution', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    expect(screen.getByText(/He leads me beside still waters/)).toBeInTheDocument();
    expect(screen.getByText(/He restores my soul/)).toBeInTheDocument();
    expect(screen.getByText(/Psalm 23:2-3/)).toBeInTheDocument();
  });

  it('quote container starts hidden (data-visible="false") on mount', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    // IntersectionObserver does NOT fire (default jsdom: undefined). Stub a passive one.
    class PassiveIO {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn();
      root = null; rootMargin = ''; thresholds = [];
    }
    vi.stubGlobal('IntersectionObserver', PassiveIO);
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    expect(getByTestId('hero-mobile-quote').getAttribute('data-visible')).toBe('false');
    vi.unstubAllGlobals();
  });

  it('renders all three BRIDGE_COPY lines', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { BRIDGE_COPY } = await import('./hero-bridge-content');
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    expect(screen.getByText(BRIDGE_COPY.invitation)).toBeInTheDocument();
    expect(screen.getByText(BRIDGE_COPY.thesis)).toBeInTheDocument();
    expect(screen.getByText(BRIDGE_COPY.assurance)).toBeInTheDocument();
  });

  it('applies var(--app-bg) as the root background color', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    const root = screen.getByTestId('hero-mobile');
    expect(root.style.backgroundColor).toBe('var(--app-bg)');
  });

  it('does NOT apply text-white to the root container', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    const root = screen.getByTestId('hero-mobile');
    expect(root.className).not.toMatch(/text-white/);
  });

  it('does NOT apply a dark umber background class to the root container', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    render(<Hero introActive={false} />);
    const root = screen.getByTestId('hero-mobile');
    expect(root.className).not.toMatch(/deep-umber/);
  });

  it('renders the quote DOM-before the video', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container, getByTestId } = render(<Hero introActive={false} />);
    const quote = getByTestId('hero-mobile-quote');
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4) means video appears AFTER quote in the DOM.
    expect(quote.compareDocumentPosition(video!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('sets autoplay on the video when prefers-reduced-motion is NOT set', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    const video = container.querySelector<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    expect(video?.autoplay).toBe(true);
  });

  it('does NOT set autoplay on the video when prefers-reduced-motion IS set', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true, reducedMotion: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    const video = container.querySelector<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    expect(video?.autoplay).toBe(false);
  });

  it('marks the decorative video as aria-hidden', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    const video = container.querySelector<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('aria-hidden')).toBe('true');
  });

  it('mounts the hero-mask-clip SVG def', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    const clipPath = container.querySelector('clipPath#hero-mask-clip');
    expect(clipPath).not.toBeNull();
  });

  it('wraps the video in a clip-pathed container at 88vw aspect-[5/3]', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { container } = render(<Hero introActive={false} />);
    const wrapper = container.querySelector<HTMLDivElement>(
      '[data-testid="hero-mobile-video-mask"]',
    );
    expect(wrapper).not.toBeNull();
    // jsdom serialises url(#frag) as url("#frag") — match either quoted or unquoted form.
    expect(wrapper?.style.clipPath).toMatch(/url\(["']?#hero-mask-clip["']?\)/);
    expect(wrapper?.className).toContain('w-[88vw]');
    expect(wrapper?.className).toContain('max-w-md');
    expect(wrapper?.className).toContain('aspect-[5/3]');
    expect(wrapper?.className).toContain('overflow-hidden');
    const video = wrapper?.querySelector<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    // The video itself now fills the wrapper rather than carrying its own size.
    expect(video?.className).toContain('w-full');
    expect(video?.className).toContain('h-full');
    expect(video?.className).toContain('object-cover');
    expect(video?.className).not.toContain('w-[60vw]');
    expect(video?.className).not.toContain('aspect-video');
  });

  it('outer column wrapper uses the breathing-room spacing (pt-10 pb-16 px-5 gap-10)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const root = getByTestId('hero-mobile');
    // The column wrapper is the first child div inside the root.
    const column = root.querySelector<HTMLDivElement>(':scope > div.flex.flex-col');
    expect(column).not.toBeNull();
    // Reduced top padding (pt-10, was pt-20) lifts the whole stack up so the
    // Notepad link clears the floating bottom dock; inter-element gap-10 is kept.
    expect(column?.className).toContain('pt-10');
    expect(column?.className).toContain('pb-16');
    expect(column?.className).toContain('px-5');
    expect(column?.className).toContain('gap-10');
  });

  it('quote attribution contains an aria-hidden decorative red-square accent', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const quote = getByTestId('hero-mobile-quote');
    const attr = quote.querySelector<HTMLParagraphElement>('.quote-attr');
    expect(attr).not.toBeNull();
    const accent = attr?.querySelector<HTMLSpanElement>('span[aria-hidden="true"]');
    expect(accent).not.toBeNull();
    // The accent uses the --accent-red token with a #d9483a fallback.
    expect(accent?.className).toMatch(/bg-\[var\(--accent-red,#d9483a\)\]/);
  });

  it('quote container is left-anchored (self-start, text-left, no text-center, no px-8)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const quote = getByTestId('hero-mobile-quote');
    expect(quote.className).toContain('self-start');
    expect(quote.className).toContain('text-left');
    expect(quote.className).not.toContain('text-center');
    expect(quote.className).not.toContain('px-8');
  });

  it('renders the "Open your Notebook" text link (arrow, no pill) linking to /notebook/notes', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const cta = getByTestId('hero-notepad-link');
    expect(cta.tagName).toBe('A');
    expect(cta).toHaveAttribute('href', '/notebook/notes');
    // No pill chrome — it's the hero text link with an arrow.
    expect(cta.className).not.toContain('two-path-cta-notepad');
    expect(cta).toHaveTextContent('Open your Notebook');
    const arrow = cta.querySelector('[data-testid="hero-notepad-arrow"]');
    expect(arrow).not.toBeNull();
    // Arrow carries the subtle left↔right nudge animation on mobile.
    expect(arrow?.className).toContain('hero-notepad-arrow--bob');
  });

  it('quote container is sized to w-[70vw]', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const quote = getByTestId('hero-mobile-quote');
    expect(quote.className).toContain('w-[70vw]');
  });

  it('bridge wrapper has height 300svh when motion is enabled', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const bridge = getByTestId('hero-mobile-bridge');
    expect(bridge.style.height).toBe('300svh');
  });

  it('bridge contains three <p> beats with spatial position classes when motion is enabled', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true });
    vi.resetModules();
    const { BRIDGE_COPY } = await import('./hero-bridge-content');
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const bridge = getByTestId('hero-mobile-bridge');
    const beats = bridge.querySelectorAll<HTMLParagraphElement>('p');
    expect(beats).toHaveLength(3);
    expect(beats[0].className).toContain('bridge-beat-left');
    expect(beats[0].className).toContain('bridge-line-side');
    expect(beats[0].textContent).toBe(BRIDGE_COPY.invitation);
    expect(beats[1].className).toContain('bridge-beat-right');
    expect(beats[1].className).toContain('bridge-thesis');
    expect(beats[1].textContent).toBe(BRIDGE_COPY.thesis);
    expect(beats[2].className).toContain('bridge-beat-center');
    expect(beats[2].className).toContain('bridge-line-center');
    expect(beats[2].textContent).toBe(BRIDGE_COPY.assurance);
  });

  it('bridge renders a static stack (no 300svh wrapper) when prefers-reduced-motion is set', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    setMatchMedia({ mobile: true, reducedMotion: true });
    vi.resetModules();
    const { BRIDGE_COPY } = await import('./hero-bridge-content');
    const { Hero } = await import('./Hero');
    const { getByTestId } = render(<Hero introActive={false} />);
    const bridge = getByTestId('hero-mobile-bridge');
    // No 300svh outer wrapper; bridge IS the static <section>.
    expect(bridge.style.height).not.toBe('300svh');
    expect(bridge.tagName).toBe('SECTION');
    // All three beats still in the DOM and not positioned via .bridge-beat
    // (which would absolute-stack them at center 50/50).
    const beats = bridge.querySelectorAll<HTMLParagraphElement>('p');
    expect(beats).toHaveLength(3);
    expect(beats[0].textContent).toBe(BRIDGE_COPY.invitation);
    expect(beats[1].textContent).toBe(BRIDGE_COPY.thesis);
    expect(beats[2].textContent).toBe(BRIDGE_COPY.assurance);
    for (const beat of beats) {
      expect(beat.className).not.toContain('bridge-beat-left');
      expect(beat.className).not.toContain('bridge-beat-right');
      expect(beat.className).not.toContain('bridge-beat-center');
    }
  });
});
