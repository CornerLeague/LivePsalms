// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { heroNotepadLinkOpacity, HeroNotepadLink } from './HeroNotepadLink';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, vi } from 'vitest';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
});

describe('heroNotepadLinkOpacity', () => {
  it('is 0 before the intro is revealed, regardless of progress', () => {
    expect(heroNotepadLinkOpacity(false, 0)).toBe(0);
    expect(heroNotepadLinkOpacity(false, 0.5)).toBe(0);
  });

  it('is fully visible in the calm opening frame (progress 0)', () => {
    expect(heroNotepadLinkOpacity(true, 0)).toBe(1);
  });

  it('stays fully visible until the fade window opens', () => {
    expect(heroNotepadLinkOpacity(true, 0.02)).toBe(1);
  });

  it('is fully faded out by the end of the early window', () => {
    expect(heroNotepadLinkOpacity(true, 0.12)).toBe(0);
  });

  it('clamps to 0 past the window (during collapse / manifesto)', () => {
    expect(heroNotepadLinkOpacity(true, 0.2)).toBe(0);
    expect(heroNotepadLinkOpacity(true, 1)).toBe(0);
  });

  it('interpolates linearly across the window midpoint', () => {
    expect(heroNotepadLinkOpacity(true, 0.07)).toBeCloseTo(0.5, 5);
  });
});

describe('HeroNotepadLink', () => {
  function renderLink(props: Partial<{ onNavTrigger: () => void }> = {}) {
    return render(
      <MemoryRouter>
        <HeroNotepadLink onNavTrigger={props.onNavTrigger} />
      </MemoryRouter>,
    );
  }

  it('renders a link to /notepad/notes with an accessible name', () => {
    renderLink();
    const link = screen.getByRole('link', { name: /open your notebook/i });
    expect(link).toHaveAttribute('href', '/notepad/notes');
  });

  it('renders the arrow glyph, hidden from assistive tech', () => {
    const { container } = renderLink();
    const arrow = container.querySelector('[data-testid="hero-notepad-arrow"]');
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
  });

  it('fires onNavTrigger and navigates to /notepad/notes on click', () => {
    const onNavTrigger = vi.fn();
    renderLink({ onNavTrigger });
    fireEvent.click(screen.getByRole('link', { name: /open your notebook/i }));
    expect(onNavTrigger).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/notepad/notes');
  });

  it('does not throw when onNavTrigger is omitted, still navigates', () => {
    renderLink();
    fireEvent.click(screen.getByRole('link', { name: /open your notebook/i }));
    expect(navigateMock).toHaveBeenCalledWith('/notepad/notes');
  });
});
