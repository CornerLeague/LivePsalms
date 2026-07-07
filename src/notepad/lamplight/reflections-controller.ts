import { Observable } from '../collection/observable';
import type { MonthlyReflectionGenerateResult, ReflectionRecord } from '../storage/lamplight-adapter';
import type { ReflectionArtifact } from '../storage/lamplight-artifacts';

export const BACKFILL_STATUS = 'Gathering the months behind you…'; // §13.6 verbatim (non-numeric progress)

// A reflection is only renderable if it actually has letter prose. The adapter
// casts data.body → ReflectionArtifact, so a stored row with an empty/partial
// body (`{}`) yields an artifact whose `letter` is undefined. Such a row is not
// a "ready" reflection — the detail view would crash on artifact.letter.split().
// Treat it like no_notes: nothing was written here.
function hasReflectionContent(artifact: ReflectionArtifact | null | undefined): boolean {
  return typeof artifact?.letter === 'string' && artifact.letter.trim().length > 0;
}

export type ReflectionsState =
  | { phase: 'idle' }
  | { phase: 'retrieving' }
  | { phase: 'generating' }
  | { phase: 'refining' } // reserved for the streaming fast-follow; buffered MVP does not emit it
  | { phase: 'ready'; record: ReflectionRecord }
  | { phase: 'empty' } // no_notes on-demand → "Nothing was written here."
  | { phase: 'unavailable' } // validators_failed on-demand → "This one isn't ready yet. Try again."
  | { phase: 'backfilling'; message: string }
  | { phase: 'error'; reason: string };

export interface ReflectionsDeps {
  getExisting: (userId: string, periodKey: string) => Promise<ReflectionRecord | null>;
  generate: (userId: string, periodKey: string) => Promise<MonthlyReflectionGenerateResult>;
  listBackfillTargets: (userId: string) => Promise<string[]>;
}

export interface ReflectionsInputs {
  userId: string;
  periodKey: string;
  autoGenerate: boolean;
}

export class ReflectionsController extends Observable<ReflectionsState> {
  private readonly deps: ReflectionsDeps;
  private inputs: ReflectionsInputs = { userId: '', periodKey: '', autoGenerate: true };
  private generation = 0;
  private runAbort: AbortController | null = null;
  private pendingStart = false;

  constructor(deps: ReflectionsDeps) {
    super({ phase: 'idle' });
    this.deps = deps;
  }

  setInputs(inputs: ReflectionsInputs): void {
    this.inputs = inputs;
    const gen = ++this.generation;
    void this.run(gen);
  }

  start(): void {
    this.pendingStart = true;
    const gen = ++this.generation;
    void this.run(gen);
  }

  retry(): void {
    this.start();
  }

  dispose(): void {
    this.generation++;
    this.runAbort?.abort();
    this.runAbort = null;
  }

  private isStale(gen: number): boolean {
    return gen !== this.generation;
  }

  private emit(gen: number, next: ReflectionsState): void {
    if (!this.isStale(gen)) this.setState(() => next);
  }

  private async run(gen: number): Promise<void> {
    const startRequested = this.pendingStart;
    this.pendingStart = false;
    this.runAbort?.abort();
    this.runAbort = new AbortController();
    const { userId, periodKey, autoGenerate } = this.inputs;

    if (!userId || !periodKey) {
      this.emit(gen, { phase: 'idle' });
      return;
    }

    this.emit(gen, { phase: 'retrieving' });
    let existing: ReflectionRecord | null;
    try {
      existing = await this.deps.getExisting(userId, periodKey);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    if (existing) {
      // An existing row with no letter (empty/partial body) is not renderable —
      // degrade to the same "Nothing was written here." copy as no_notes rather
      // than emitting 'ready' and handing the detail view a letter-less artifact.
      this.emit(gen, hasReflectionContent(existing.artifact) ? { phase: 'ready', record: existing } : { phase: 'empty' });
      return;
    }
    if (!(autoGenerate || startRequested)) {
      this.emit(gen, { phase: 'idle' });
      return;
    }

    this.emit(gen, { phase: 'generating' });
    let result: MonthlyReflectionGenerateResult;
    try {
      result = await this.deps.generate(userId, periodKey);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    if (result.ok) {
      const record = await this.deps.getExisting(userId, periodKey); // hydrate createdAt/savedToNotes
      if (this.isStale(gen)) return;
      this.emit(
        gen,
        record
          ? { phase: 'ready', record }
          : {
              phase: 'ready',
              record: {
                periodKey,
                title: result.artifact.title,
                artifact: result.artifact,
                createdAt: `${periodKey}-01T00:00:00.000Z`,
                savedToNotes: false,
              },
            },
      );
      return;
    }
    switch (result.reason) {
      case 'no_notes':
        this.emit(gen, { phase: 'empty' });
        return;
      case 'validators_failed':
        this.emit(gen, { phase: 'unavailable' });
        return;
      default:
        this.emit(gen, { phase: 'error', reason: 'network' });
        return;
    }
  }

  // Path mode: first-open backfill. Sequential (one edge invocation at a time) so we never burst
  // the function. Callers re-read listReflections() once this resolves to paint the new stones.
  async startBackfill(userId: string): Promise<void> {
    const gen = ++this.generation;
    this.runAbort?.abort();
    this.emit(gen, { phase: 'backfilling', message: BACKFILL_STATUS });
    let targets: string[];
    try {
      targets = await this.deps.listBackfillTargets(userId);
    } catch {
      this.emit(gen, { phase: 'error', reason: 'network' });
      return;
    }
    if (this.isStale(gen)) return;
    for (const periodKey of targets) {
      if (this.isStale(gen)) return;
      try {
        await this.deps.generate(userId, periodKey);
      } catch {
        // A single failed/empty month is skipped; the backfill continues (§8).
      }
    }
    if (this.isStale(gen)) return;
    this.emit(gen, { phase: 'idle' });
  }
}
