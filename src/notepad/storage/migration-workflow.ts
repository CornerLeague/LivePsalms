import { Observable } from '@/notepad/collection/observable';
import type { migrateAdapter, MigrationEvent } from './migration';
import type { StorageAdapter } from './adapter';

export type MigrationStatus =
  | 'idle'
  | 'loading'
  | 'folders'
  | 'notes'
  | 'cleanup'
  | 'done'
  | 'error';

export type MigrationWorkflowState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'folders'; current: number; total: number }
  | { status: 'notes'; current: number; total: number }
  | { status: 'cleanup' }
  | { status: 'done'; folders: number; notes: number }
  | { status: 'error'; message: string };

export interface MigrationWorkflowDeps {
  source: StorageAdapter;
  target: StorageAdapter;
  migrate: typeof migrateAdapter;
  clearSource: () => void;
  toastSuccess: (message: string) => void;
  toastError: (message: string) => void;
  setTimer: (cb: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
  onMigrationComplete: () => void;
  onClose: () => void;
}

export const MIGRATION_TIMELINE = {
  celebratoryPauseMs: 1400,
} as const;

export const MIGRATION_FALLBACK_ERROR =
  'Something went wrong importing your notes. Your local copy was left untouched.';

export const MIGRATION_DECLINE_MESSAGE = 'Local notes removed.';

export class MigrationWorkflow extends Observable<MigrationWorkflowState> {
  private readonly deps: MigrationWorkflowDeps;
  private celebratoryHandle: number | null = null;

  constructor(deps: MigrationWorkflowDeps) {
    super({ status: 'idle' });
    this.deps = deps;
  }

  start = async (): Promise<void> => {
    const { status } = this.getSnapshot();
    if (status !== 'idle' && status !== 'error') return;

    this.update(() => ({ status: 'loading' }));
    try {
      const result = await this.deps.migrate(this.deps.source, this.deps.target, {
        onEvent: (event) => this.applyEvent(event),
      });
      this.update(() => ({ status: 'cleanup' }));
      this.deps.clearSource();
      this.deps.onMigrationComplete();
      this.update(() => ({ status: 'done', folders: result.folders, notes: result.notes }));
      this.deps.toastSuccess(this.successMessage(result.notes));
      this.scheduleCelebratoryClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : MIGRATION_FALLBACK_ERROR;
      this.update(() => ({ status: 'error', message }));
      this.deps.toastError(message);
    }
  };

  dismissError = (): void => {
    if (this.getSnapshot().status !== 'error') return;
    this.update(() => ({ status: 'idle' }));
    this.deps.onClose();
  };

  decline = (): void => {
    const { status } = this.getSnapshot();
    if (status !== 'idle' && status !== 'error') return; // never delete mid-import
    this.deps.clearSource();
    this.update(() => ({ status: 'idle' }));
    this.deps.toastSuccess(MIGRATION_DECLINE_MESSAGE);
    this.deps.onClose();
  };

  dispose = (): void => {
    if (this.celebratoryHandle !== null) {
      this.deps.clearTimer(this.celebratoryHandle);
      this.celebratoryHandle = null;
    }
  };

  private applyEvent(event: MigrationEvent): void {
    switch (event.kind) {
      case 'loading':
        return;
      case 'folders':
        this.update(() => ({ status: 'folders', current: event.current, total: event.total }));
        return;
      case 'notes':
        this.update(() => ({ status: 'notes', current: event.current, total: event.total }));
        return;
    }
  }

  private scheduleCelebratoryClose(): void {
    this.celebratoryHandle = this.deps.setTimer(() => {
      if (this.celebratoryHandle === null) return;
      this.celebratoryHandle = null;
      this.update(() => ({ status: 'idle' }));
      this.deps.onClose();
    }, MIGRATION_TIMELINE.celebratoryPauseMs);
  }

  private successMessage(notes: number): string {
    return notes === 1
      ? '1 note imported to your account.'
      : `${notes} notes imported to your account.`;
  }

  private update(updater: (prev: MigrationWorkflowState) => MigrationWorkflowState): void {
    (this as unknown as { setState: (u: typeof updater) => void }).setState(updater);
  }
}
