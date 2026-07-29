import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useThemePreference } from './useThemePreference';
import { shouldApplyDark, lightThemeAttribute } from './theme-types';
import { ThemeContext } from './theme-context';

/**
 * Owns notepad theme state and applies the `.dark` class to <html> only while a
 * notepad workspace route is mounted AND the resolved theme is dark (Approach C).
 * Because `.dark` lives on <html> while in the notepad, portaled Radix surfaces
 * and Tailwind `dark:` variants resolve correctly; because it is stripped on exit
 * (or on light), marketing/auth never render dark.
 *
 * The light palette rides the same gating as `data-theme` on <html>: present only
 * on notepad routes, in resolved light, for a non-classic palette — so dark and
 * `data-theme` are mutually exclusive and classic light stays attribute-free.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { theme, resolvedTheme, setTheme, lightTheme, setLightTheme } =
    useThemePreference({ userId });
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    const root = document.documentElement;
    const on = shouldApplyDark(pathname, resolvedTheme);
    root.classList.toggle('dark', on);
    const palette = lightThemeAttribute(pathname, resolvedTheme, lightTheme);
    if (palette) root.setAttribute('data-theme', palette);
    else root.removeAttribute('data-theme');
    return () => {
      root.classList.remove('dark');
      root.removeAttribute('data-theme');
    };
  }, [pathname, resolvedTheme, lightTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, lightTheme, setLightTheme }),
    [theme, resolvedTheme, setTheme, lightTheme, setLightTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
