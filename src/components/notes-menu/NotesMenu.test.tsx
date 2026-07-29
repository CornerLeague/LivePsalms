// @vitest-environment jsdom
// src/components/notes-menu/NotesMenu.test.tsx
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotesMenu } from './NotesMenu';
import { ThemeContext, type ThemeContextValue } from '@/notepad/theme/theme-context';

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

function themeValue(overrides: Partial<ThemeContextValue> = {}): ThemeContextValue {
  return {
    theme: 'system',
    resolvedTheme: 'light',
    setTheme: vi.fn(),
    lightTheme: 'classic',
    setLightTheme: vi.fn(),
    ...overrides,
  };
}

function renderMenu(
  props: Partial<React.ComponentProps<typeof NotesMenu>> = {},
  theme: ThemeContextValue = themeValue(),
) {
  return render(
    <MemoryRouter>
      <ThemeContext.Provider value={theme}>
        <NotesMenu {...props} />
      </ThemeContext.Provider>
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

  it('renders the Instagram link label without a trailing arrow glyph', () => {
    renderMenu();
    openMenu();
    const menu = screen.getByRole('menu');
    const link = within(menu).getByRole('menuitem', { name: 'Instagram' });
    expect(link).toHaveTextContent('Instagram');
    expect(link.textContent).not.toContain('↗');
  });

  it('closes on Escape', () => {
    renderMenu();
    const trigger = openMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the Appearance section with all 12 palette swatches in light mode', () => {
    renderMenu();
    openMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Appearance')).toBeInTheDocument();
    const group = within(menu).getByRole('group', { name: 'Light color theme' });
    expect(within(group).getAllByRole('button')).toHaveLength(12);
    expect(within(group).getAllByRole('button')[0]).toHaveAccessibleName('Classic');
  });

  it('hides the Appearance section while dark is resolved', () => {
    renderMenu({}, themeValue({ resolvedTheme: 'dark' }));
    openMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByText('Appearance')).not.toBeInTheDocument();
  });

  it('selects a palette without closing the menu', () => {
    const setLightTheme = vi.fn();
    renderMenu({}, themeValue({ setLightTheme }));
    const trigger = openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Stormy Sky' }));
    expect(setLightTheme).toHaveBeenCalledWith('stormy-sky');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('marks the active palette swatch as pressed', () => {
    renderMenu({}, themeValue({ lightTheme: 'graphite' }));
    openMenu();
    expect(screen.getByRole('button', { name: 'Graphite' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-pressed', 'false');
  });
});
