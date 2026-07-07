import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';                       // SAME client import Notepad.tsx uses (seam)
import { SupabaseLamplightAdapter } from '../../storage/supabase-lamplight-adapter';
import { useLamplightEntitlement } from '../../hooks/useLamplightEntitlement'; // seam (item 9)
import { useAuthSession } from '@/auth/context/useAuthSession';   // the signed-in user id — mirrors Notepad.tsx's source (seam)
import { useNoteCollection } from '@/notepad/context/useNoteCollection'; // note-collection seam — SAME hook Notepad.tsx:322 uses
import { buildSaveToNotesHandler } from './save-to-notes';
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
  // Reconciled against the real seam (Notepad.tsx:322): useNoteCollection() returns
  // { collection, ...state }, not the note-collection API directly, and the
  // brief's `updateNoteContent` doesn't exist — the collection only has
  // `updateNote(id, Partial<Note>)`, and `content` is TipTap doc JSON stringified
  // (see buildGuidedNote), not markdown.
  const { collection } = useNoteCollection();
  if (!adapter || !userId) return null; // logged-out / no client → mirror Notepad's null-guard

  // Save-to-notes seam — handler extracted to save-to-notes.ts so it's testable without
  // this module's @/lib/supabase import. Recreated per render like the old inline version.
  const handleSaveToNotes = buildSaveToNotesHandler(collection);

  return (
    <WaymarksPeriodDetail
      adapter={adapter}
      userId={userId}
      canAccess={canAccess}
      onSaveToNotes={handleSaveToNotes}
    />
  );
}
