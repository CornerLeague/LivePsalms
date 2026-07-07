import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';                       // SAME client import Notepad.tsx uses (seam)
import { SupabaseLamplightAdapter } from '../../storage/supabase-lamplight-adapter';
import { useLamplightEntitlement } from '../../hooks/useLamplightEntitlement'; // seam (item 9)
import { useAuthSession } from '@/auth/context/useAuthSession';   // the signed-in user id — mirrors Notepad.tsx's source (seam)
import { WaymarksReflections } from './WaymarksReflections';
import { WaymarksPeriodDetail } from './WaymarksPeriodDetail';

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
  if (!adapter || !userId) return null; // logged-out / no client → mirror Notepad's null-guard
  return <WaymarksPeriodDetail adapter={adapter} userId={userId} canAccess={canAccess} />;
}
