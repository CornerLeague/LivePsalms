// src/hooks/nav-trigger-context.ts
import { createContext, useContext } from 'react';

/**
 * Exposes App's loading-overlay nav trigger (handleNavTrigger) to components
 * mounted deep in the router tree that cannot receive it as a prop — the
 * notes-page NotesMenu on both platforms. Mirrors loading-overlay-context.ts.
 * Defaults to a no-op so components rendered without the provider (tests,
 * isolated mounts) navigate normally without firing the overlay.
 */
const noop = (): void => {};

export const NavTriggerContext = createContext<() => void>(noop);

export function useNavTrigger(): () => void {
  return useContext(NavTriggerContext);
}
