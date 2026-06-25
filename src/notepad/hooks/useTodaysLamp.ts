import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { LamplightAdapter } from '../storage/lamplight-adapter';
import {
  TodaysLampController,
  type TodaysLampDeps,
  type TodaysLampState,
} from '../lamplight/todays-lamp-controller';

export type { TodaysLampState };

export interface UseTodaysLampArgs {
  adapter: LamplightAdapter;
  userId: string;
  localDate: string;
  /** When false, a cache miss enters `idle` instead of generating until start() is called. Default true. */
  autoGenerate?: boolean;
}

export interface UseTodaysLampResult {
  state: TodaysLampState;
  start: () => void;
  retry: () => void;
}

export function useTodaysLamp(args: UseTodaysLampArgs): UseTodaysLampResult {
  const { adapter, userId, localDate, autoGenerate = true } = args;

  const controller = useMemo(() => {
    const deps: TodaysLampDeps = {
      getExisting: (uid, date) => adapter.getDailyDevotion(uid, date),
      generate:    (uid, date) => adapter.generateDailyDevotion(uid, date),
      stream:      adapter.streamDailyDevotion?.bind(adapter),
    };
    return new TodaysLampController(deps);
  }, [adapter]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    controller.setInputs({ userId, localDate, autoGenerate });
  }, [controller, userId, localDate, autoGenerate]);

  useEffect(() => () => controller.dispose(), [controller]);

  const start = useCallback(() => controller.start(), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);

  return { state, start, retry };
}
