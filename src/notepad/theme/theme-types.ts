export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'] as const;
export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** True when the path is a notepad workspace route that should be dark-eligible. */
export function isNotepadRoute(pathname: string): boolean {
  return pathname.startsWith('/notebook/notes') || pathname.startsWith('/notebook/u/');
}

/** Whether `.dark` should be on <html> for this route + resolved theme. */
export function shouldApplyDark(pathname: string, resolved: ResolvedTheme): boolean {
  return resolved === 'dark' && isNotepadRoute(pathname);
}
