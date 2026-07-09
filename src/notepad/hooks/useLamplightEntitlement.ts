import { useEffect, useState, useCallback, useRef } from 'react';
import type { LamplightAdapter, LamplightTier } from '../storage/lamplight-adapter';

export type LamplightFeature = 'today' | 'weekly' | 'reflections' | 'inline' | 'chat';

export interface UseLamplightEntitlementArgs {
  adapter: LamplightAdapter | null;
  userId: string | null;
}

export interface UseLamplightEntitlementResult {
  isLoading: boolean;
  tier: LamplightTier;
  promoActive: boolean;
  hasAccess: (feature: LamplightFeature) => boolean;
}

export function useLamplightEntitlement({
  adapter,
  userId,
}: UseLamplightEntitlementArgs): UseLamplightEntitlementResult {
  const [tier, setTier] = useState<LamplightTier>('none');
  const [promoActive, setPromoActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  // Re-arm on every mount so React Strict Mode's mount → unmount → re-mount
  // dance doesn't leave mountedRef stuck at false (which would cause the
  // setState calls below to be silently skipped, hanging the panel on
  // isLoading=true forever in dev).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      if (!adapter) {
        // No adapter wired (logged-out / adapter-not-wired reads are a first-class
        // case) — fail closed without touching the adapter. Mirrors the catch
        // branch's end state below, minus the throw and the console.error.
        if (cancelled || !mountedRef.current) return;
        setPromoActive(false);
        setTier('none');
        setIsLoading(false);
        return;
      }
      try {
        const [promo, ent] = await Promise.all([
          adapter.getPromoConfig(),
          userId ? adapter.getEntitlement(userId) : Promise.resolve(null),
        ]);
        if (cancelled || !mountedRef.current) return;
        setPromoActive(promo.promoActive);
        setTier(ent?.tier ?? 'none');
      } catch (err) {
        console.error('[lamplight] entitlement load failed', err);
        if (cancelled || !mountedRef.current) return;
        // Leave previous state; fail closed (no access).
        setPromoActive(false);
        setTier('none');
      } finally {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, userId]);

  const hasAccess = useCallback(
    (feature: LamplightFeature) => {
      if (promoActive) return true;
      if (feature === 'chat') return tier === 'plus';
      if (tier === 'plus') return true;
      if (tier === 'lite') return feature === 'today' || feature === 'weekly';
      return false;
    },
    [promoActive, tier]
  );

  return { isLoading, tier, promoActive, hasAccess };
}
