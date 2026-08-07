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
      // ⚠️ This short-circuit answers "does this feature exist for this
      // session", and it deliberately does NOT consider who is asking — a
      // global promo turns the feature on for everyone, signed in or not.
      //
      // That is correct for what `hasAccess` means, and it is a trap for
      // callers gating an ACTION on it. See `entitledAndSignedIn` below, and do
      // not move the userId check in here: `waymarks-routes.tsx` relies on the
      // consumer guarding, so tightening the hook would relocate the blast
      // radius rather than shrink it. Who is asking is the caller's question.
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

/**
 * May THIS READER press a generate action?
 *
 * Both halves, and the `userId` half is the one that keeps going missing.
 * `hasAccess` short-circuits on a global promo before it considers who is
 * asking (see above), so while a promo runs it answers `true` for a signed-out
 * visitor — who then presses the button and gets a request that 401s with no
 * bearer token. No amount of trying again fixes it.
 *
 * This has now been a live, reader-visible defect twice:
 *   · #120, on the Insights doors — "That didn't finish. Try again."
 *   · `EtymologyPanel`, on "Ask Lamplight about this verse" — worse, because
 *     nothing at all appeared on screen.
 *
 * Both components already rendered the correct blocked affordance
 * (`SignInGate` when logged out, `PaywallCard` otherwise); in both, that branch
 * was simply unreachable. **The defect was never in the component — it was in
 * the condition handed to it.** So the condition lives here, once.
 *
 * Entitlement alone is deliberately NOT enough, and a signed-in reader without
 * it is deliberately NOT excluded: they should meet the paywall by asking.
 */
export function entitledAndSignedIn(args: {
  userId: string | null;
  hasFeatureAccess: boolean;
}): boolean {
  return args.userId !== null && args.hasFeatureAccess;
}
