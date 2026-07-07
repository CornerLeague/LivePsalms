import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  ReflectionsController,
  type ReflectionsDeps,
  type ReflectionsState,
} from '../lamplight/reflections-controller';
import type { LamplightAdapter } from '../storage/lamplight-adapter';

export interface UseReflectionsArgs {
  adapter: LamplightAdapter;
  userId: string;
  /** Detail mode when set ('YYYY-MM'). Omitted → Path mode (list); the hook is used only for backfill(). */
  periodKey?: string;
  /** Detail mode: retrieve-or-generate on mount. Ignored in Path mode. Default true. */
  autoGenerate?: boolean;
}

export interface UseReflectionsResult {
  state: ReflectionsState;
  start: () => void;
  retry: () => void;
  backfill: () => Promise<void>;
}

export function useReflections({
  adapter,
  userId,
  periodKey,
  autoGenerate = true,
}: UseReflectionsArgs): UseReflectionsResult {
  const controller = useMemo(() => {
    const deps: ReflectionsDeps = {
      getExisting: (uid, pk) => adapter.getReflection(uid, pk),
      generate: (uid, pk) => adapter.generateMonthlyReflection(uid, pk),
      listBackfillTargets: (uid) => adapter.listBackfillTargets(uid),
    };
    return new ReflectionsController(deps);
  }, [adapter]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    if (!periodKey) return; // Path mode: no detail to retrieve — controller stays idle.
    controller.setInputs({ userId, periodKey, autoGenerate });
  }, [controller, userId, periodKey, autoGenerate]);

  useEffect(() => () => controller.dispose(), [controller]);

  const start = useCallback(() => controller.start(), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const backfill = useCallback(() => controller.startBackfill(userId), [controller, userId]);

  return { state, start, retry, backfill };
}
