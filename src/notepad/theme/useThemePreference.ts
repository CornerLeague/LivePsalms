import { useCallback, useEffect, useRef, useState } from 'react';
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

  // A slow profile hydration must not clobber a mode/palette the user picks
  // while the fetch is still in flight. These flip true on an explicit set and
  // gate the stale remote application below; they reset per hydration cycle
  // (keyed on userId) so a fresh sign-in still hydrates the new profile.
  const themeUserSet = useRef(false);
  const lightThemeUserSet = useRef(false);

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
    themeUserSet.current = false;
    lightThemeUserSet.current = false;
    (async () => {
      let { data } = await supabase
        .from('profiles').select('theme, light_theme').eq('id', userId).maybeSingle();
      if (!data) {
        ({ data } = await supabase
          .from('profiles').select('theme').eq('id', userId).maybeSingle());
      }
      if (cancelled) return;
      // Skip any field the user explicitly set while this fetch was in flight —
      // their choice (and its localStorage write) must win over the stale read.
      const remote = data?.theme;
      if (isTheme(remote) && !themeUserSet.current) {
        setState(remote);
        saveEnum(KEY_THEME, remote);
      }
      const remoteLight = (data as { light_theme?: unknown } | null)?.light_theme;
      if (isLightTheme(remoteLight) && !lightThemeUserSet.current) {
        setLightState(remoteLight);
        saveEnum(KEY_LIGHT_THEME, remoteLight);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Best-effort cross-device sync. localStorage is the device source of truth,
  // so a failed write is non-fatal (the next successful change re-syncs), but we
  // surface it rather than swallowing it so drift is diagnosable. Writes are
  // chained through this tail promise so two rapid selections can't land out of
  // order server-side — each update only fires once the previous one settles, so
  // the last pick is always the last committed.
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const syncPreference = useCallback(
    (patch: { theme: Theme } | { light_theme: LightTheme }) => {
      if (!userId || !supabase) return;
      const client = supabase;
      writeChain.current = writeChain.current.then(() =>
        client.from('profiles').update(patch).eq('id', userId).then(
          ({ error }) => {
            if (error) console.warn('[theme] profile preference sync failed:', error.message);
          },
          (err) => console.warn('[theme] profile preference sync failed:', err),
        ),
      );
    },
    [userId],
  );

  const setTheme = useCallback((t: Theme) => {
    themeUserSet.current = true;
    setState(t);
    saveEnum(KEY_THEME, t);
    syncPreference({ theme: t });
  }, [syncPreference]);

  const setLightTheme = useCallback((t: LightTheme) => {
    lightThemeUserSet.current = true;
    setLightState(t);
    saveEnum(KEY_LIGHT_THEME, t);
    syncPreference({ light_theme: t });
  }, [syncPreference]);

  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  return { theme, resolvedTheme, setTheme, lightTheme, setLightTheme };
}
