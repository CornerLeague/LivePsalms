import { Observable } from '../collection/observable';
import type { DailyDevotionGenerateResult } from '../storage/lamplight-adapter';
import type { DailyDevotion } from '../storage/lamplight-artifacts';

export type TodaysLampState =
  | { phase: 'idle' }
  | { phase: 'loading'; loadingStep: 0 | 1 | 2 }
  | { phase: 'ready'; artifact: DailyDevotion }
  | { phase: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };

/** Opaque interval handle owned by the clock seam. */
export type TimerHandle = ReturnType<typeof setInterval>;

export interface TodaysLampDeps {
  getExisting: (userId: string, localDate: string) => Promise<DailyDevotion | null>;
  generate: (userId: string, localDate: string) => Promise<DailyDevotionGenerateResult>;
  /** Clock seam; production uses the default (global setInterval). */
  setInterval?: (callback: () => void, ms: number) => TimerHandle;
  /** Clock seam; production uses the default (global clearInterval). */
  clearInterval?: (handle: TimerHandle) => void;
}

export interface TodaysLampInputs {
  userId: string;
  localDate: string;
  autoGenerate: boolean;
  loadingStepIntervalMs: number;
}

const INITIAL: TodaysLampState = { phase: 'loading', loadingStep: 0 };

/**
 * Today's Lamp generation lifecycle as a node-testable controller. Owns the
 * stale-response generation fence and the loading-step interval that the React
 * hook used to carry inline; `useTodaysLamp` is now a thin binding over this.
 */
export class TodaysLampController extends Observable<TodaysLampState> {
  private readonly getExisting: TodaysLampDeps['getExisting'];
  private readonly generate: TodaysLampDeps['generate'];
  private readonly setIntervalFn: (callback: () => void, ms: number) => TimerHandle;
  private readonly clearIntervalFn: (handle: TimerHandle) => void;

  private generation = 0;
  private intervalHandle: TimerHandle | null = null;
  /** Set by start()/retry(); read-and-cleared once per run (consume-once). */
  private pendingStart = false;

  private userId: string | null = null;
  private localDate: string | null = null;
  private autoGenerate = true;
  private loadingStepIntervalMs = 0;

  constructor(deps: TodaysLampDeps) {
    super(INITIAL);
    this.getExisting = deps.getExisting;
    this.generate = deps.generate;
    this.setIntervalFn = deps.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this.clearIntervalFn = deps.clearInterval ?? ((handle) => clearInterval(handle));
  }

  setInputs(inputs: TodaysLampInputs): void {
    this.userId = inputs.userId;
    this.localDate = inputs.localDate;
    this.autoGenerate = inputs.autoGenerate;
    this.loadingStepIntervalMs = inputs.loadingStepIntervalMs;
    const gen = ++this.generation;
    void this.run(gen);
  }

  /** Explicit start: applies only to the run it triggers (consume-once). */
  start(): void {
    this.pendingStart = true;
    const gen = ++this.generation;
    void this.run(gen);
  }

  /** Identical to start() today: re-runs the fetch-or-generate flow. */
  retry(): void {
    this.pendingStart = true;
    const gen = ++this.generation;
    void this.run(gen);
  }

  /** Bumps the generation so any in-flight run's late resolves are dropped. */
  dispose(): void {
    this.generation++;
    this.stopInterval();
  }

  private isStale(gen: number): boolean {
    return gen !== this.generation;
  }

  private emit(gen: number, next: TodaysLampState): void {
    if (this.isStale(gen)) return;
    this.setState(() => next);
  }

  private stopInterval(): void {
    if (this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private startInterval(gen: number): void {
    this.stopInterval();
    let step: 0 | 1 | 2 = 0;
    this.intervalHandle = this.setIntervalFn(() => {
      if (this.isStale(gen)) return;
      step = Math.min(step + 1, 2) as 0 | 1 | 2;
      this.setState((prev) =>
        prev.phase === 'loading' ? { phase: 'loading', loadingStep: step } : prev,
      );
    }, this.loadingStepIntervalMs);
  }

  private async run(gen: number): Promise<void> {
    const userId = this.userId;
    const localDate = this.localDate;
    if (userId === null || localDate === null) return;

    // Consume the explicit-start request: a start()/retry() applies to exactly
    // the run it triggered and must not leak into later prop-driven runs (e.g.
    // the local date rolling over while mounted).
    const startRequested = this.pendingStart;
    this.pendingStart = false;

    // Each run begins in loading{0} with the step interval ticking.
    this.startInterval(gen);
    this.setState((prev) =>
      prev.phase === 'loading' && prev.loadingStep === 0
        ? prev
        : { phase: 'loading', loadingStep: 0 },
    );

    let existing: DailyDevotion | null;
    try {
      existing = await this.getExisting(userId, localDate);
    } catch {
      if (this.isStale(gen)) return;
      this.stopInterval();
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;

    if (existing) {
      this.stopInterval();
      this.emit(gen, { phase: 'ready', artifact: existing });
      return;
    }

    // Cache miss: only generate when auto-generation is on or the user has
    // explicitly asked to start. Otherwise wait in idle for a start() tap.
    const shouldGenerate = this.autoGenerate || startRequested;
    if (!shouldGenerate) {
      this.stopInterval();
      this.emit(gen, { phase: 'idle' });
      return;
    }

    let result: DailyDevotionGenerateResult;
    try {
      result = await this.generate(userId, localDate);
    } catch {
      if (this.isStale(gen)) return;
      this.stopInterval();
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    this.stopInterval();
    if (result.ok) {
      this.emit(gen, { phase: 'ready', artifact: result.artifact });
    } else {
      this.emit(gen, { phase: 'error', reason: result.reason });
    }
  }
}
