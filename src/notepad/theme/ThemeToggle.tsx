import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-context';

interface ThemeToggleProps {
  className?: string;
  size?: number;
}

/**
 * Compact sun/moon control. Reflects the *resolved* theme; the first interaction
 * from 'system' writes an explicit 'light'/'dark' (the opposite of what shows).
 */
export function ThemeToggle({ className, size = 18 }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={
        'flex items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ' +
        (className ?? '')
      }
      style={{ color: 'var(--deep-umber)' }}
    >
      {isDark ? <Sun size={size} /> : <Moon size={size} />}
    </button>
  );
}
