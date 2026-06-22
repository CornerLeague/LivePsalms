import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useThemePreference } from './useThemePreference';
import { shouldApplyDark } from './theme-types';
import { ThemeContext } from './theme-context';

/**
 * Owns notepad theme state and applies the `.dark` class to <html> only while a
 * notepad workspace route is mounted AND the resolved theme is dark (Approach C).
 * Because `.dark` lives on <html> while in the notepad, portaled Radix surfaces
 * and Tailwind `dark:` variants resolve correctly; because it is stripped on exit
 * (or on light), marketing/auth never render dark.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { theme, resolvedTheme, setTheme } = useThemePreference({ userId });
  const { pathname } = useLocation();

  useEffect(() => {
    const root = document.documentElement;
    const on = shouldApplyDark(pathname, resolvedTheme);
    root.classList.toggle('dark', on);
    return () => { root.classList.remove('dark'); };
  }, [pathname, resolvedTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
