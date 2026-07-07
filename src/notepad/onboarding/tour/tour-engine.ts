import type { WorkspaceControls } from './workspace-controller';

export type TourViewport = 'desktop' | 'mobile';
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TourStepCopy {
  title: string;
  body: string | { desktop: string; mobile: string };
}

export interface TourRunContext {
  viewport: TourViewport;
  /** Cached per run so Back / replay / viewport switch reuses one sample note (spec §6). */
  sampleNoteId: string | null;
}

export interface TourStep {
  id: string;
  placement: TourPlacement | { desktop: TourPlacement; mobile: TourPlacement };
  copy: TourStepCopy;
  /** data-tour token for the viewport, or null for a centered card. */
  anchor: (viewport: TourViewport) => string | null;
  /** Drives the app exclusively through the registry — no DOM (spec §2.2). */
  prepare?: (controls: Readonly<WorkspaceControls>, ctx: TourRunContext) => void | Promise<void>;
}

export type TourPhase = 'preparing' | 'anchoring' | 'showing';

export interface TourEngineState {
  stepIndex: number;
  phase: TourPhase;
  anchorEl: Element | null;
  viewport: TourViewport;
}

export interface TourEngineDeps {
  steps: TourStep[];
  initialViewport: TourViewport;
  getControls: () => Readonly<WorkspaceControls>;
  /**
   * Resolve a data-tour token to a visible, settled element. Owns the ~2s
   * retry budget; resolves null on timeout/abort. Injected so the engine
   * never touches the DOM (spec §2.1) and tests stay synchronous.
   */
  resolveAnchor: (token: string, signal: AbortSignal) => Promise<Element | null>;
  onComplete: () => void;
  onSkip: () => void;
  /** Fired when a step is skipped forward after prepare/anchor failure (spec §6). */
  onStepSkipped?: (stepId: string) => void;
}

export interface TourEngine {
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  setViewport: (viewport: TourViewport) => void;
  getState: () => TourEngineState;
  subscribe: (listener: () => void) => () => void;
  /** Abort in-flight work (unmount cleanup). */
  dispose: () => void;
}

export function createTourEngine(deps: TourEngineDeps): TourEngine {
  const { steps } = deps;
  const ctx: TourRunContext = { viewport: deps.initialViewport, sampleNoteId: null };
  let state: TourEngineState = {
    stepIndex: 0,
    phase: 'preparing',
    anchorEl: null,
    viewport: deps.initialViewport,
  };
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let finished = false;

  function setState(patch: Partial<TourEngineState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function cancelInFlight(): void {
    abort?.abort();
    abort = null;
  }

  function finish(callback: () => void): void {
    if (finished) return;
    finished = true;
    cancelInFlight();
    callback();
  }

  function skipForward(index: number, stepId: string): void {
    deps.onStepSkipped?.(stepId);
    if (index >= steps.length - 1) {
      finish(deps.onComplete);
      return;
    }
    void runStep(index + 1);
  }

  async function runStep(index: number): Promise<void> {
    cancelInFlight();
    const controller = new AbortController();
    abort = controller;
    const step = steps[index];
    setState({ stepIndex: index, phase: 'preparing', anchorEl: null });

    try {
      await step.prepare?.(deps.getControls(), ctx);
    } catch {
      // Failed prepare is handled like a missing anchor: skip forward (spec §6).
      if (controller.signal.aborted) return;
      skipForward(index, step.id);
      return;
    }
    if (controller.signal.aborted) return;

    const token = step.anchor(ctx.viewport);
    if (token === null) {
      setState({ phase: 'showing', anchorEl: null });
      return;
    }

    setState({ phase: 'anchoring' });
    const el = await deps.resolveAnchor(token, controller.signal);
    if (controller.signal.aborted) return;
    if (el === null) {
      skipForward(index, step.id);
      return;
    }
    setState({ phase: 'showing', anchorEl: el });
  }

  return {
    start: () => {
      void runStep(0);
    },
    next: () => {
      if (finished) return;
      if (state.stepIndex >= steps.length - 1) {
        finish(deps.onComplete);
        return;
      }
      void runStep(state.stepIndex + 1);
    },
    back: () => {
      if (finished || state.stepIndex === 0) return;
      void runStep(state.stepIndex - 1);
    },
    // Skip and Escape always work instantly, regardless of engine state (spec §6).
    skip: () => finish(deps.onSkip),
    setViewport: (viewport) => {
      if (finished || viewport === ctx.viewport) return;
      ctx.viewport = viewport;
      setState({ viewport });
      // Re-run the current step for the new viewport (spec §2.5/§6). The
      // resolver's retry budget covers the workspace remount + re-registration.
      void runStep(state.stepIndex);
    },
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => cancelInFlight(),
  };
}
