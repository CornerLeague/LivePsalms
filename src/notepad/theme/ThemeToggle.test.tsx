// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeContext, type ThemeContextValue } from './theme-context';
import { ThemeToggle } from './ThemeToggle';

function renderWith(value: ThemeContextValue) {
  return render(
    <ThemeContext.Provider value={value}>
      <ThemeToggle />
    </ThemeContext.Provider>,
  );
}

describe('ThemeToggle', () => {
  afterEach(() => cleanup());

  it('renders an accessible control reflecting the resolved theme', () => {
    renderWith({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() });
    const btn = screen.getByRole('button', { name: /Switch to dark theme/i });
    expect(btn).toBeTruthy();
  });

  it('sets dark when currently resolved light', () => {
    const setTheme = vi.fn();
    renderWith({ theme: 'system', resolvedTheme: 'light', setTheme });
    fireEvent.click(screen.getByRole('button', { name: /Switch to dark theme/i }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('sets light when currently resolved dark', () => {
    const setTheme = vi.fn();
    renderWith({ theme: 'dark', resolvedTheme: 'dark', setTheme });
    fireEvent.click(screen.getByRole('button', { name: /Switch to light theme/i }));
    expect(setTheme).toHaveBeenCalledWith('light');
  });
});
