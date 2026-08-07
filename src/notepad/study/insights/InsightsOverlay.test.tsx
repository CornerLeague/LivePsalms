// @vitest-environment jsdom
// src/notepad/study/insights/InsightsOverlay.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InsightsOverlay, type InsightsDoor } from './InsightsOverlay';

afterEach(cleanup);

const reference: InsightsDoor = {
  id: 'reference',
  label: 'Sources & Reference',
  blurb: 'What we hold on this passage.',
  render: () => <div>reference-door-content</div>,
};
const passage: InsightsDoor = {
  id: 'passage',
  label: 'The Passage',
  blurb: 'A reading of these verses.',
  render: () => <div>passage-door-content</div>,
};

const base = {
  book: 'psa', chapter: 27, selectedVerse: null as number | null,
  doors: [reference], onClose: () => {},
};

describe('InsightsOverlay', () => {
  it('renders as a modal dialog labelled by the passage', () => {
    render(<InsightsOverlay {...base} />);
    const dialog = screen.getByRole('dialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toContain('Psalm 27');
  });

  it('closes on the close control', () => {
    const onClose = vi.fn();
    render(<InsightsOverlay {...base} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<InsightsOverlay {...base} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('locks body scroll while open and restores it on close', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<InsightsOverlay {...base} />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps working when onClose is a fresh identity on every render', () => {
    // RegionMapFullscreen fixed this exact bug once: an inline onClose re-ran the
    // setup effect, teleporting focus and breaking tab navigation. Re-rendering
    // with a new handler must not tear down and re-arm the listeners.
    const first = vi.fn();
    const { rerender } = render(<InsightsOverlay {...base} onClose={first} />);
    const second = vi.fn();
    rerender(<InsightsOverlay {...base} onClose={second} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('shows the verse scope when a verse is selected, and can widen to the chapter', () => {
    render(<InsightsOverlay {...base} selectedVerse={4} />);
    expect(screen.getByTestId('insights-scope').textContent).toContain('Psalm 27:4');

    fireEvent.click(screen.getByRole('button', { name: /whole chapter/i }));
    expect(screen.getByTestId('insights-scope').textContent).toContain('Psalm 27');
    expect(screen.getByTestId('insights-scope').textContent).not.toContain('27:4');
  });

  it('can narrow back to the selected verse after widening', () => {
    render(<InsightsOverlay {...base} selectedVerse={4} />);
    fireEvent.click(screen.getByRole('button', { name: /whole chapter/i }));
    fireEvent.click(screen.getByRole('button', { name: /verse 4/i }));

    expect(screen.getByTestId('insights-scope').textContent).toContain('Psalm 27:4');
  });

  it('offers no scope control when no verse is selected', () => {
    render(<InsightsOverlay {...base} selectedVerse={null} />);

    expect(screen.getByTestId('insights-scope').textContent).toContain('Psalm 27');
    expect(screen.queryByRole('button', { name: /whole chapter/i })).toBeNull();
  });

  it('passes the resolved scope to the door it renders', () => {
    const seen = vi.fn();
    const spy: InsightsDoor = { ...reference, render: (scope) => { seen(scope); return null; } };
    render(<InsightsOverlay {...base} doors={[spy]} selectedVerse={4} />);

    expect(seen).toHaveBeenCalledWith({ book: 'psa', chapter: 27, verse: 4 });
  });

  it('renders a single door directly, with no chooser to click through', () => {
    render(<InsightsOverlay {...base} doors={[reference]} />);

    expect(screen.getByText('reference-door-content')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sources & Reference/ })).toBeNull();
  });

  it('offers a chooser once there is more than one door', () => {
    render(<InsightsOverlay {...base} doors={[passage, reference]} />);

    expect(screen.queryByText('passage-door-content')).toBeNull();
    expect(screen.getByRole('button', { name: /The Passage/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sources & Reference/ })).toBeTruthy();
  });

  it('opens the chosen door and offers a way back to the chooser', () => {
    render(<InsightsOverlay {...base} doors={[passage, reference]} />);
    fireEvent.click(screen.getByRole('button', { name: /The Passage/ }));
    expect(screen.getByText('passage-door-content')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /all insights/i }));
    expect(screen.queryByText('passage-door-content')).toBeNull();
    expect(screen.getByRole('button', { name: /Sources & Reference/ })).toBeTruthy();
  });
});

describe('InsightsOverlay on a phone (B4)', () => {
  // The overlay is the one deliberately full-bleed surface in the app: it
  // portals to document.body at `position: fixed; inset: 0`, over a workspace
  // whose tab bar already pads for the home indicator. Nothing here did.

  it('clears the notch at the top and the home indicator at the bottom', () => {
    render(<InsightsOverlay {...base} />);
    const header = screen.getByRole('banner');
    const body = screen.getByTestId('insights-body');

    expect(header.getAttribute('style')).toContain('env(safe-area-inset-top)');
    expect(body.getAttribute('style')).toContain('env(safe-area-inset-bottom)');
  });

  it('clears the side insets too, for a landscape notch', () => {
    render(<InsightsOverlay {...base} />);
    expect(screen.getByRole('banner').getAttribute('style')).toContain('env(safe-area-inset-left)');
    expect(screen.getByTestId('insights-body').getAttribute('style')).toContain('env(safe-area-inset-left)');
  });

  it('gives the close control a thumb-sized target', () => {
    // 28×28 is fine for a mouse and below the 44px floor for a finger — on the
    // control that gets a reader OUT of a full-screen surface.
    render(<InsightsOverlay {...base} />);
    const close = screen.getByRole('button', { name: /close/i });
    expect(close.getAttribute('style')).toContain('min-width: 44px');
    expect(close.getAttribute('style')).toContain('min-height: 44px');
  });

  it('gives the back-to-chooser control a thumb-sized target', () => {
    render(<InsightsOverlay {...base} doors={[passage, reference]} />);
    fireEvent.click(screen.getByRole('button', { name: /The Passage/ }));
    const back = screen.getByRole('button', { name: /all insights/i });
    expect(back.getAttribute('style')).toContain('min-height: 44px');
  });

  it('ellipsizes a long passage label rather than pushing the controls off-screen', () => {
    // 360px, "2 Thessalonians 3", a "Whole chapter" toggle and an "All
    // insights" back control in one flex row with no wrapping rule.
    render(<InsightsOverlay {...base} book="2th" chapter={3} selectedVerse={17} doors={[passage, reference]} />);
    fireEvent.click(screen.getByRole('button', { name: /The Passage/ }));

    const label = screen.getByTestId('insights-scope-label');
    expect(label.getAttribute('style')).toContain('ellipsis');
    // The controls must not be the things that shrink.
    for (const name of [/all insights/i, /close/i, /whole chapter/i]) {
      expect(screen.getByRole('button', { name }).getAttribute('style')).toContain('flex-shrink: 0');
    }
  });
});
