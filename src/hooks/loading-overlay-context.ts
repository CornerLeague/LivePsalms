import { createContext, useContext } from 'react';

/**
 * True while the global loading overlay (HeroLoadingOverlay in App) is covering
 * the screen — from the moment it activates through to when its dissolve fully
 * completes. Consumers (e.g. the onboarding surfaces) read this to avoid
 * painting on top of the loading screen. Defaults to false so components
 * rendered without the provider (tests, isolated mounts) behave normally.
 */
export const LoadingOverlayContext = createContext<boolean>(false);

export function useLoadingOverlayVisible(): boolean {
  return useContext(LoadingOverlayContext);
}
