// Imperative controls the workspaces register on mount so the tour can drive
// the app (spec §2.2). Module-level singleton mirroring onboarding-events.ts:
// the workspaces are siblings of OnboardingSurfaces (Notepad.tsx), so context
// cannot reach their local useState.

export type MobileWorkspaceTab = 'notes' | 'editor' | 'lamplight' | 'bible';
export type StudyWindowTab = 'bible' | 'graph';
export type MoreSheetSegment = 'backlinks' | 'info' | 'graph';

export interface WorkspaceControls {
  /** Shared — registered by NotepadOnboardingOverlay (mounted on both viewports). */
  createSampleNote?: () => Promise<string>;
  openNote?: (id: string) => void;
  /** Viewport-specific auth entry: desktop navigates to /login, mobile opens MobileAuthModal. */
  openAuth?: () => void;
  /** Desktop workspace. */
  desktopSetGraphOpen?: (open: boolean) => void;
  desktopSetStudyTab?: (tab: StudyWindowTab) => void;
  /** Mobile workspace. */
  mobileSetTab?: (tab: MobileWorkspaceTab) => void;
  mobileOpenMoreSheet?: (segment: MoreSheetSegment) => void;
}

const registry: WorkspaceControls = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      // Never break callers; surface a dev-only warning so a throwing
      // listener isn't fully invisible during development.
      if (import.meta.env?.DEV) console.warn('[workspace-controller] listener threw:', err);
    }
  }
}

/**
 * Merge `controls` into the registry. Returns an unregister function that
 * removes exactly the keys registered here (identity-checked, so a stale
 * cleanup never clobbers a newer registration for the same key — matters
 * across the 768px workspace remount).
 */
export function registerWorkspaceControls(controls: WorkspaceControls): () => void {
  Object.assign(registry, controls);
  notify();
  return () => {
    for (const key of Object.keys(controls) as Array<keyof WorkspaceControls>) {
      if (registry[key] === controls[key]) delete registry[key];
    }
    notify();
  };
}

export function getWorkspaceControls(): Readonly<WorkspaceControls> {
  return registry;
}

export function subscribeWorkspaceControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
