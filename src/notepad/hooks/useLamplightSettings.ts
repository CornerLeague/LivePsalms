import { useEffect, useState, useCallback, useRef } from 'react';
import type { LamplightAdapter, LamplightSettings } from '../storage/lamplight-adapter';

export interface UseLamplightSettingsArgs {
  adapter: LamplightAdapter | null;
  userId: string | null;
}

export interface UseLamplightSettingsResult {
  isLoading: boolean;
  settings: LamplightSettings | null;
  refetch: () => Promise<void>;
  upsert: (patch: Partial<Omit<LamplightSettings, 'userId' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  deleteAll: () => Promise<void>;
}

export function useLamplightSettings({
  adapter,
  userId,
}: UseLamplightSettingsArgs): UseLamplightSettingsResult {
  const [settings, setSettings] = useState<LamplightSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  // Re-arm on every mount so React Strict Mode's mount → unmount → re-mount
  // dance doesn't leave mountedRef stuck at false. Without the re-arm, the
  // async load's setIsLoading(false) is silently skipped and the panel hangs
  // on "Loading…" forever in dev.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!adapter || !userId) {
        // No adapter wired (logged-out / adapter-not-wired reads are a first-class
        // case) — fail closed without touching the adapter, same as the no-userId
        // branch below.
        if (!cancelled) {
          setSettings(null);
          setIsLoading(false);
        }
        return;
      }
      try {
        const row = await adapter.getSettings(userId);
        if (cancelled || !mountedRef.current) return;
        setSettings(row);
      } catch (err) {
        console.error('[lamplight] getSettings failed', err);
        if (cancelled || !mountedRef.current) return;
        // Leave settings at its current value (null on first load, or stale on refetch).
      } finally {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, userId]);

  const refetch = useCallback(async () => {
    if (!adapter || !userId) {
      setSettings(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const row = await adapter.getSettings(userId);
      if (mountedRef.current) setSettings(row);
    } catch (err) {
      console.error('[lamplight] getSettings failed', err);
      // Leave settings at its current value (null on first load, or stale on refetch).
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [adapter, userId]);

  const upsert = useCallback(
    async (patch: Partial<Omit<LamplightSettings, 'userId' | 'createdAt' | 'updatedAt'>>) => {
      if (!adapter || !userId) return;
      try {
        const next = await adapter.upsertSettings(userId, patch);
        if (mountedRef.current) setSettings(next);
      } catch (err) {
        console.error('[lamplight] upsertSettings failed', err);
        throw err;
      }
    },
    [adapter, userId]
  );

  const deleteAll = useCallback(async () => {
    if (!adapter || !userId) return;
    try {
      await adapter.deleteAllUserData(userId);
      if (mountedRef.current) setSettings(null);
    } catch (err) {
      console.error('[lamplight] deleteAllUserData failed', err);
      throw err;
    }
  }, [adapter, userId]);

  return { isLoading, settings, refetch, upsert, deleteAll };
}
