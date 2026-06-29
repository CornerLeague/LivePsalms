import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  MigrationWorkflow,
  type MigrationWorkflowDeps,
  type MigrationWorkflowState,
} from './migration-workflow';
import { migrateAdapter } from './migration';
import { localAdapter } from './local-storage';
import type { StorageAdapter } from './adapter';

interface UseMigrationWorkflowArgs {
  target: StorageAdapter;
  onMigrationComplete: () => void;
  onClose: () => void;
}

interface UseMigrationWorkflowResult {
  state: MigrationWorkflowState;
  start: () => void;
  decline: () => void;
  dismissError: () => void;
}

export function useMigrationWorkflow({
  target,
  onMigrationComplete,
  onClose,
}: UseMigrationWorkflowArgs): UseMigrationWorkflowResult {
  const onCompleteRef = useRef(onMigrationComplete);
  const onCloseRef = useRef(onClose);
  onCompleteRef.current = onMigrationComplete;
  onCloseRef.current = onClose;

  const workflow = useMemo(() => {
    const deps: MigrationWorkflowDeps = {
      source: localAdapter,
      target,
      migrate: migrateAdapter,
      clearSource: () => localAdapter.clearAll(),
      toastSuccess: (msg) => toast.success(msg),
      toastError: (msg) => toast.error(msg),
      setTimer: (cb, ms) => window.setTimeout(cb, ms),
      clearTimer: (handle) => window.clearTimeout(handle),
      onMigrationComplete: () => onCompleteRef.current(),
      onClose: () => onCloseRef.current(),
    };
    return new MigrationWorkflow(deps);
  }, [target]);

  const state = useSyncExternalStore(workflow.subscribe, workflow.getSnapshot);

  useEffect(() => {
    return () => workflow.dispose();
  }, [workflow]);

  return {
    state,
    start: () => {
      void workflow.start();
    },
    decline: () => workflow.decline(),
    dismissError: workflow.dismissError,
  };
}
