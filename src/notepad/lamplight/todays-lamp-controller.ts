import { Observable } from '../collection/observable';
import type { DailyDevotionGenerateResult, DailyDevotionStreamEvent } from '../storage/lamplight-adapter';
import type { DailyDevotion } from '../storage/lamplight-artifacts';

export type TodaysLampState =
  | { phase: 'idle' }
  | { phase: 'retrieving'; stage: 'notes' | 'scripture' | 'composing' }
  | { phase: 'generating'; pieces: Partial<DailyDevotion> }
  | { phase: 'refining'; pieces: Partial<DailyDevotion> }
  | { phase: 'ready'; artifact: DailyDevotion }
  | { phase: 'error'; reason: 'no_notes' | 'validators_failed' | 'network' };

export interface TodaysLampDeps {
  getExisting: (userId: string, localDate: string) => Promise<DailyDevotion | null>;
  /** Buffered path — kept for the absent-stream path and as a fallback when
   *  streaming fails (network error, no terminal event, or stream throws). */
  generate: (userId: string, localDate: string) => Promise<DailyDevotionGenerateResult>;
  /** Optional streaming path (mirrors adapter.streamDailyDevotion?).
   *  When absent the controller falls back to the buffered generate dep. */
  stream?: (
    userId: string,
    localDate: string,
    onEvent: (ev: DailyDevotionStreamEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}

export interface TodaysLampInputs {
  userId: string;
  localDate: string;
  autoGenerate: boolean;
}

const INITIAL: TodaysLampState = { phase: 'retrieving', stage: 'notes' };

/**
 * Today's Lamp generation lifecycle as a node-testable controller. Owns the
 * stale-response generation fence and maps streaming events from the `stream`
 * dep (or falls back to the buffered `generate` dep) to discrete UI phases.
 * `useTodaysLamp` is a thin binding over this.
 */
export class TodaysLampController extends Observable<TodaysLampState> {
  private readonly getExisting: TodaysLampDeps['getExisting'];
  private readonly generate: TodaysLampDeps['generate'];
  private readonly stream: TodaysLampDeps['stream'];

  private generation = 0;
  /** AbortController for the most-recently-started run. */
  private runAbort: AbortController | null = null;
  /** Set by start()/retry(); read-and-cleared once per run (consume-once). */
  private pendingStart = false;

  private userId: string | null = null;
  private localDate: string | null = null;
  private autoGenerate = true;

  constructor(deps: TodaysLampDeps) {
    super(INITIAL);
    this.getExisting = deps.getExisting;
    this.generate = deps.generate;
    this.stream = deps.stream;
  }

  setInputs(inputs: TodaysLampInputs): void {
    this.userId = inputs.userId;
    this.localDate = inputs.localDate;
    this.autoGenerate = inputs.autoGenerate;
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

  /** Bumps the generation so any in-flight run's late resolves are dropped,
   *  and aborts the current run's AbortSignal. */
  dispose(): void {
    this.generation++;
    this.runAbort?.abort();
    this.runAbort = null;
  }

  private isStale(gen: number): boolean {
    return gen !== this.generation;
  }

  private emit(gen: number, next: TodaysLampState): void {
    if (this.isStale(gen)) return;
    this.setState(() => next);
  }

  private async run(gen: number): Promise<void> {
    const userId = this.userId;
    const localDate = this.localDate;
    if (userId === null || localDate === null) return;

    // Consume the explicit-start request: a start()/retry() applies to exactly
    // the run it triggered and must not leak into later prop-driven runs.
    const startRequested = this.pendingStart;
    this.pendingStart = false;

    // Abort any previous run and create a fresh AbortController for this run.
    this.runAbort?.abort();
    const abortCtrl = new AbortController();
    this.runAbort = abortCtrl;
    const signal = abortCtrl.signal;

    // Each run opens in retrieving{notes}.
    this.emit(gen, { phase: 'retrieving', stage: 'notes' });

    let existing: DailyDevotion | null;
    try {
      existing = await this.getExisting(userId, localDate);
    } catch {
      if (this.isStale(gen)) return;
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;

    if (existing) {
      this.emit(gen, { phase: 'ready', artifact: existing });
      return;
    }

    // Cache miss: only generate when auto-generation is on or the user has
    // explicitly asked to start. Otherwise wait in idle for a start() tap.
    const shouldGenerate = this.autoGenerate || startRequested;
    if (!shouldGenerate) {
      this.emit(gen, { phase: 'idle' });
      return;
    }

    if (this.stream) {
      await this.runStreamingPath(gen, userId, localDate, signal);
    } else {
      await this.runBufferedPath(gen, userId, localDate);
    }
  }

  private async runStreamingPath(
    gen: number,
    userId: string,
    localDate: string,
    signal: AbortSignal,
  ): Promise<void> {
    let pieces: Partial<DailyDevotion> = {};
    let terminal = false;

    const onEvent = (ev: DailyDevotionStreamEvent): void => {
      if (this.isStale(gen)) return;

      if (ev.kind === 'stage') {
        this.emit(gen, { phase: 'retrieving', stage: ev.stage });
      } else if (ev.kind === 'piece') {
        // Accumulate; cast at the boundary (field is keyof DailyDevotion).
        pieces = {
          ...pieces,
          [ev.field]: ev.value as DailyDevotion[typeof ev.field],
        };
        this.emit(gen, { phase: 'generating', pieces });
      } else if (ev.kind === 'refining') {
        this.emit(gen, { phase: 'refining', pieces });
      } else if (ev.kind === 'done') {
        terminal = true;
        this.emit(gen, { phase: 'ready', artifact: ev.artifact });
      } else if (ev.kind === 'error') {
        if (ev.reason === 'network') {
          // Transport failure → leave terminal false so we fall back to buffered.
        } else {
          // Content error (no_notes / validators_failed) → terminal; no fallback.
          terminal = true;
          this.emit(gen, { phase: 'error', reason: ev.reason });
        }
      }
    };

    try {
      await this.stream!(userId, localDate, onEvent, signal);
    } catch {
      // Leave terminal false → buffered fallback below.
    }

    if (this.isStale(gen)) return;

    if (!terminal) {
      await this.runBufferedPath(gen, userId, localDate);
    }
  }

  private async runBufferedPath(
    gen: number,
    userId: string,
    localDate: string,
  ): Promise<void> {
    let result: DailyDevotionGenerateResult;
    try {
      result = await this.generate(userId, localDate);
    } catch {
      if (this.isStale(gen)) return;
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    if (result.ok) {
      this.emit(gen, { phase: 'ready', artifact: result.artifact });
    } else {
      this.emit(gen, { phase: 'error', reason: result.reason });
    }
  }
}
