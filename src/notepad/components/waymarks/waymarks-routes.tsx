import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';                       // SAME client import Notepad.tsx uses (seam)
import { SupabaseLamplightAdapter } from '../../storage/supabase-lamplight-adapter';
import { useLamplightEntitlement } from '../../hooks/useLamplightEntitlement'; // seam (item 9)
import { useAuthSession } from '@/auth/context/useAuthSession';   // the signed-in user id — mirrors Notepad.tsx's source (seam)
import { WaymarksReflections } from './WaymarksReflections';
// WaymarksPeriodDetail ships in Task 16. A real (physically resolvable) import here would break
// `vite build` today — unlike `tsc`, Rollup can't be satisfied by a `@ts-expect-error` comment, it
// still tries to resolve the module. So the /:periodKey route is wired now (App.tsx only touches
// the routing spine once, per the brief's Step 9 intent) with a placeholder body; Task 16 swaps in
// the real `<WaymarksPeriodDetail adapter={adapter} userId={userId} canAccess={canAccess} />` render.

function useWaymarksConnection() {
  const adapter = useMemo(() => (supabase ? new SupabaseLamplightAdapter(supabase) : null), []);
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  // useLamplightEntitlement requires a non-null adapter; pass userId=null to skip the fetch
  // when Supabase isn't configured, mirroring Notepad.tsx's DesktopNotepadWorkspace guard.
  const { hasAccess } = useLamplightEntitlement({
    adapter: adapter as NonNullable<typeof adapter>,
    userId: adapter ? userId : null,
  });
  return { adapter, userId, canAccess: hasAccess('reflections') };
}

export function WaymarksReflectionsRoute() {
  const { adapter, userId, canAccess } = useWaymarksConnection();
  if (!adapter || !userId) return null; // logged-out / no client → mirror Notepad's null-guard
  return <WaymarksReflections adapter={adapter} userId={userId} canAccess={canAccess} />;
}

export function WaymarksPeriodDetailRoute() {
  const { adapter, userId, canAccess } = useWaymarksConnection();
  if (!adapter || !userId) return null;
  // TODO(Task 16): render <WaymarksPeriodDetail adapter={adapter} userId={userId} canAccess={canAccess} />
  // once that component ships. Referencing the resolved values keeps this a faithful stand-in for the
  // seam (same null-guard, same connection) without importing a module that doesn't exist yet.
  void adapter; void userId; void canAccess;
  return null;
}
