// @vitest-environment jsdom
// src/components/notes-menu/NotesMenu.test.tsx
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotesMenu } from './NotesMenu';

// --- jsdom shims for Radix DropdownMenu (same rationale as RecordingsStrip.test.tsx) ---
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// Radix's modal menu installs a document-level focus trap; jsdom's synchronous
// focus events let it interfere. Making programmatic focus a no-op sidesteps it
// (no assertion depends on focus).
let realFocus: typeof HTMLElement.prototype.focus;
beforeAll(() => {
  realFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = () => {};
});
afterAll(() => {
  HTMLElement.prototype.focus = realFocus;
});
afterEach(cleanup);

function renderMenu(props: Partial<React.ComponentProps<typeof NotesMenu>> = {}) {
  return render(
    <MemoryRouter>
      <NotesMenu {...props} />
    </MemoryRouter>,
  );
}

// jsdom lacks PointerEvent, so Radix's trigger never opens from a plain click.
// It DOES open on Enter/Space keydown — a real supported path.
function openMenu(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Menu' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

describe('NotesMenu', () => {
  it('renders a hamburger trigger with menu aria attributes (closed)', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on activation and flips aria-expanded to true', () => {
    renderMenu();
    const trigger = openMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists all four nav links plus the Social/Instagram entry', () => {
    renderMenu();
    openMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Purpose')).toBeInTheDocument();
    expect(within(menu).getByText('Notebook')).toBeInTheDocument();
    expect(within(menu).getByText('Community')).toBeInTheDocument();
    expect(within(menu).getByText('Contact')).toBeInTheDocument();
    expect(within(menu).getByText('Social')).toBeInTheDocument();
    expect(within(menu).getByText(/Instagram/)).toBeInTheDocument();
  });

  it('fires onNavTrigger when a nav label is selected', () => {
    const onNavTrigger = vi.fn();
    renderMenu({ onNavTrigger });
    openMenu();
    fireEvent.click(screen.getByText('Purpose'));
    expect(onNavTrigger).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onNavTrigger when the Instagram (Social) link is selected', () => {
    const onNavTrigger = vi.fn();
    renderMenu({ onNavTrigger });
    openMenu();
    fireEvent.click(screen.getByText(/Instagram/));
    expect(onNavTrigger).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    renderMenu();
    const trigger = openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
