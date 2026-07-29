import { useCallback, useEffect, useState } from 'react';
import { loadEnum, saveEnum, KEY_THEME, KEY_LIGHT_THEME } from '../session/session-storage';
import {
  type Theme,
  type ResolvedTheme,
  type LightTheme,
  THEMES,
  DEFAULT_THEME,
  LIGHT_THEMES,
  DEFAULT_LIGHT_THEME,
  isTheme,
  isLightTheme,
} from './theme-types';
import { supabase } from '@/lib/supabase';

export interface UseThemePreferenceResult {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  lightTheme: LightTheme;
  setLightTheme: (t: LightTheme) => void;
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
  const [lightTheme, setLightState] = useState<LightTheme>(() =>
    loadEnum<LightTheme>(KEY_LIGHT_THEME, LIGHT_THEMES, DEFAULT_LIGHT_THEME),
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
  // The combined select fails wholesale if light_theme doesn't exist yet (deploy
  // ahead of the manually-applied migration), so fall back to theme-only rather
  // than losing mode hydration too.
  useEffect(() => {
    let cancelled = false;
    if (!userId || !supabase) return;
    (async () => {
      let { data } = await supabase
        .from('profiles').select('theme, light_theme').eq('id', userId).maybeSingle();
      if (!data) {
        ({ data } = await supabase
          .from('profiles').select('theme').eq('id', userId).maybeSingle());
      }
      if (cancelled) return;
      const remote = data?.theme;
      if (isTheme(remote)) {
        setState(remote);
        saveEnum(KEY_THEME, remote);
      }
      const remoteLight = (data as { light_theme?: unknown } | null)?.light_theme;
      if (isLightTheme(remoteLight)) {
        setLightState(remoteLight);
        saveEnum(KEY_LIGHT_THEME, remoteLight);
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

  const setLightTheme = useCallback((t: LightTheme) => {
    setLightState(t);
    saveEnum(KEY_LIGHT_THEME, t);
    if (userId && supabase) {
      void supabase.from('profiles').update({ light_theme: t }).eq('id', userId);
    }
  }, [userId]);

  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  return { theme, resolvedTheme, setTheme, lightTheme, setLightTheme };
}
