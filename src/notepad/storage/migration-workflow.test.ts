import { describe, it, expect } from 'vitest';
import { MigrationWorkflow } from './migration-workflow';
import type { MigrationWorkflowDeps } from './migration-workflow';
import type { MigrationEvent, MigrationResult } from './migration';
import type { StorageAdapter } from './adapter';

interface DepsRecord {
  migrateCalls: Array<{ source: StorageAdapter; target: StorageAdapter }>;
  clearSourceCalls: number;
  toastSuccess: string[];
  toastError: string[];
  timersScheduled: Array<{ ms: number; cb: () => void }>;
  timersCleared: number[];
  onMigrationComplete: number;
  onClose: number;
}

interface FakeMigrate {
  fn: MigrationWorkflowDeps['migrate'];
  emit: (event: MigrationEvent) => void;
  resolve: (result: MigrationResult) => void;
  reject: (err: Error) => void;
  reset: () => void;
}

function makeFakeMigrate(): FakeMigrate {
  let onEvent: ((e: MigrationEvent) => void) | null = null;
  let pendingResolve: ((r: MigrationResult) => void) | null = null;
  let pendingReject: ((e: Error) => void) | null = null;
  const fn: MigrationWorkflowDeps['migrate'] = async (_source, _target, opts) => {
    onEvent = opts?.onEvent ?? null;
    return new Promise<MigrationResult>((res, rej) => {
      pendingResolve = res;
      pendingReject = rej;
    });
  };
  return {
    fn,
    emit: (event) => onEvent?.(event),
    resolve: (result) => pendingResolve?.(result),
    reject: (err) => pendingReject?.(err),
    reset: () => {
      onEvent = null;
      pendingResolve = null;
      pendingReject = null;
    },
  };
}

const fakeAdapter = (): StorageAdapter => ({} as StorageAdapter);

function makeDeps(): {
  deps: MigrationWorkflowDeps;
  rec: DepsRecord;
  migrate: FakeMigrate;
  runTimer: (handle: number) => void;
} {
  let nextHandle = 1;
  const handleToCb = new Map<number, () => void>();
  const rec: DepsRecord = {
    migrateCalls: [],
    clearSourceCalls: 0,
    toastSuccess: [],
    toastError: [],
    timersScheduled: [],
    timersCleared: [],
    onMigrationComplete: 0,
    onClose: 0,
  };
  const migrate = makeFakeMigrate();
  const deps: MigrationWorkflowDeps = {
    source: fakeAdapter(),
    target: fakeAdapter(),
    migrate: async (source, target, opts) => {
      rec.migrateCalls.push({ source, target });
      return migrate.fn(source, target, opts);
    },
    clearSource: () => {
      rec.clearSourceCalls++;
    },
    toastSuccess: (msg) => {
      rec.toastSuccess.push(msg);
    },
    toastError: (msg) => {
      rec.toastError.push(msg);
    },
    setTimer: (cb, ms) => {
      const handle = nextHandle++;
      handleToCb.set(handle, cb);
      rec.timersScheduled.push({ ms, cb });
      return handle;
    },
    clearTimer: (handle) => {
      rec.timersCleared.push(handle);
      // Intentionally NOT deleting from handleToCb — see purpose-detail-reveal.test.ts
      // for the rationale: tests must be able to simulate a stale timer firing
      // post-clearTimeout to exercise the class's `=== null` guard.
    },
    onMigrationComplete: () => {
      rec.onMigrationComplete++;
    },
    onClose: () => {
      rec.onClose++;
    },
  };
  const runTimer = (handle: number) => {
    const cb = handleToCb.get(handle);
    if (cb) cb();
  };
  return { deps, rec, migrate, runTimer };
}

describe('MigrationWorkflow — initial state', () => {
  it('starts idle', () => {
    const { deps } = makeDeps();
    const w = new MigrationWorkflow(deps);
    expect(w.getSnapshot()).toEqual({ status: 'idle' });
  });
});

describe('MigrationWorkflow — start() happy path', () => {
  it('moves idle → loading immediately', async () => {
    const { deps } = makeDeps();
    const w = new MigrationWorkflow(deps);
    void w.start();
    expect(w.getSnapshot()).toEqual({ status: 'loading' });
  });

  it('translates folders and notes events into typed status updates', async () => {
    const { deps, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();

    migrate.emit({ kind: 'folders', current: 1, total: 3 });
    expect(w.getSnapshot()).toEqual({ status: 'folders', current: 1, total: 3 });

    migrate.emit({ kind: 'folders', current: 3, total: 3 });
    migrate.emit({ kind: 'notes', current: 2, total: 5 });
    expect(w.getSnapshot()).toEqual({ status: 'notes', current: 2, total: 5 });

    migrate.resolve({ folders: 3, notes: 5 });
    await startPromise;
  });

  it('moves through cleanup → done after migrate resolves', async () => {
    const { deps, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 2, notes: 7 });
    await startPromise;
    expect(w.getSnapshot()).toEqual({ status: 'done', folders: 2, notes: 7 });
  });

  it('calls clearSource AFTER migrate resolves and BEFORE onMigrationComplete', async () => {
    const { deps, rec, migrate } = makeDeps();
    const order: string[] = [];
    deps.clearSource = () => {
      rec.clearSourceCalls++;
      order.push('clearSource');
    };
    deps.onMigrationComplete = () => {
      rec.onMigrationComplete++;
      order.push('onMigrationComplete');
    };
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 1 });
    await startPromise;
    expect(order).toEqual(['clearSource', 'onMigrationComplete']);
  });

  it('fires toastSuccess with singular message when notes === 1', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 1 });
    await startPromise;
    expect(rec.toastSuccess).toEqual(['1 note imported to your account.']);
  });

  it('fires toastSuccess with plural message when notes !== 1', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 1, notes: 12 });
    await startPromise;
    expect(rec.toastSuccess).toEqual(['12 notes imported to your account.']);
  });

  it('passes source and target from deps into migrate', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 0 });
    await startPromise;
    expect(rec.migrateCalls).toHaveLength(1);
    expect(rec.migrateCalls[0].source).toBe(deps.source);
    expect(rec.migrateCalls[0].target).toBe(deps.target);
  });

  it('is a no-op when called from a non-restart status (loading)', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const first = w.start();
    void w.start();
    expect(rec.migrateCalls).toHaveLength(1);
    migrate.resolve({ folders: 0, notes: 0 });
    await first;
  });
});

describe('MigrationWorkflow — celebratory pause + auto-close', () => {
  it('schedules the celebratory timer at MIGRATION_TIMELINE.celebratoryPauseMs after done', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 1 });
    await startPromise;
    expect(rec.timersScheduled).toHaveLength(1);
    expect(rec.timersScheduled[0].ms).toBe(1400);
  });

  it('returns to idle and fires onClose when the celebratory timer fires', async () => {
    const { deps, rec, migrate, runTimer } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 1 });
    await startPromise;
    runTimer(1);
    expect(w.getSnapshot()).toEqual({ status: 'idle' });
    expect(rec.onClose).toBe(1);
  });
});

describe('MigrationWorkflow — error path', () => {
  it('catches a thrown Error and moves to error with the error message', async () => {
    const { deps, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.reject(new Error('Network down'));
    await startPromise;
    expect(w.getSnapshot()).toEqual({ status: 'error', message: 'Network down' });
  });

  it('uses the fallback message when the thrown value is not an Error', async () => {
    const { deps } = makeDeps();
    deps.migrate = async () => {
      throw 'not-an-error';
    };
    const w = new MigrationWorkflow(deps);
    await w.start();
    const state = w.getSnapshot();
    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.message).toBe(
        'Something went wrong importing your notes. Your local copy was left untouched.',
      );
    }
  });

  it('fires toastError with the same message used for the status', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.reject(new Error('Boom'));
    await startPromise;
    expect(rec.toastError).toEqual(['Boom']);
  });

  it('does NOT call clearSource or onMigrationComplete or schedule the celebratory timer on error', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.reject(new Error('Boom'));
    await startPromise;
    expect(rec.clearSourceCalls).toBe(0);
    expect(rec.onMigrationComplete).toBe(0);
    expect(rec.timersScheduled).toHaveLength(0);
  });

  it('start() from error status retries the full sequence', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const firstStart = w.start();
    migrate.reject(new Error('Boom'));
    await firstStart;
    expect(w.getSnapshot().status).toBe('error');

    migrate.reset();
    const retry = w.start();
    expect(w.getSnapshot()).toEqual({ status: 'loading' });
    migrate.resolve({ folders: 0, notes: 2 });
    await retry;
    expect(w.getSnapshot()).toEqual({ status: 'done', folders: 0, notes: 2 });
    expect(rec.migrateCalls).toHaveLength(2);
  });
});

describe('MigrationWorkflow — dismissError()', () => {
  it('returns to idle and fires onClose when called from error', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.reject(new Error('Boom'));
    await startPromise;
    w.dismissError();
    expect(w.getSnapshot()).toEqual({ status: 'idle' });
    expect(rec.onClose).toBe(1);
  });

  it('is a no-op from any non-error status', () => {
    const { deps, rec } = makeDeps();
    const w = new MigrationWorkflow(deps);
    w.dismissError();
    expect(rec.onClose).toBe(0);
    expect(w.getSnapshot()).toEqual({ status: 'idle' });
  });
});

describe('MigrationWorkflow — dispose()', () => {
  it('cancels a pending celebratory timer', async () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 1 });
    await startPromise;
    w.dispose();
    expect(rec.timersCleared).toContain(1);
  });

  it('does not fire onClose if a stale celebratory timer fires after dispose', async () => {
    const { deps, rec, migrate, runTimer } = makeDeps();
    const w = new MigrationWorkflow(deps);
    const startPromise = w.start();
    migrate.resolve({ folders: 0, notes: 1 });
    await startPromise;
    w.dispose();
    runTimer(1);
    expect(rec.onClose).toBe(0);
  });

  it('is safe to call from idle (no timers scheduled)', () => {
    const { deps, rec } = makeDeps();
    const w = new MigrationWorkflow(deps);
    w.dispose();
    expect(rec.timersCleared).toHaveLength(0);
  });
});

describe('MigrationWorkflow — decline()', () => {
  it('purges the source, toasts, and closes when called from idle', () => {
    const { deps, rec } = makeDeps();
    const w = new MigrationWorkflow(deps);
    w.decline();
    expect(rec.clearSourceCalls).toBe(1);
    expect(rec.toastSuccess).toEqual(['Local notes removed.']);
    expect(rec.onClose).toBe(1);
    expect(w.getSnapshot()).toEqual({ status: 'idle' });
  });

  it('is a no-op while a migration is in progress', () => {
    const { deps, rec, migrate } = makeDeps();
    const w = new MigrationWorkflow(deps);
    void w.start(); // status === 'loading'
    w.decline();
    expect(rec.clearSourceCalls).toBe(0);
    expect(rec.onClose).toBe(0);
    migrate.resolve({ folders: 0, notes: 0 }); // let start() settle
  });
});
