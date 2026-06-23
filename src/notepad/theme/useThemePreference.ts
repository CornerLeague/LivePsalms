import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, KEY_THEME } from '../session/session-storage';
import { type Theme, type ResolvedTheme, THEMES, DEFAULT_THEME, isTheme } from './theme-types';
import { supabase } from '@/lib/supabase';

export interface UseThemePreferenceResult {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useThemePreference(
  { userId = null }: { userId?: string | null } = {},
): UseThemePreferenceResult {
  const [theme, setState] = useState<Theme>(() =>
    loadEnum<Theme>(KEY_THEME, THEMES, DEFAULT_THEME),
  );
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Track the OS scheme so 'system' resolves live.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent | { matches: boolean }) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Hydrate from the profile when signed in (localStorage is the instant default).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    (async () => {
      const { data } = await supabase
        .from('profiles').select('theme').eq('id', userId).maybeSingle();
      const remote = data?.theme;
      if (!cancelled && isTheme(remote)) {
        setState(remote);
        saveEnum(KEY_THEME, remote);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setTheme = useCallback((t: Theme) => {
    setState(t);
    saveEnum(KEY_THEME, t);
    if (userId && supabase) {
      void supabase.from('profiles').update({ theme: t }).eq('id', userId);
    }
  }, [userId]);

  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  return { theme, resolvedTheme, setTheme };
}
