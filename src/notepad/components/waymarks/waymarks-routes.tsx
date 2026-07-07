import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';                       // SAME client import Notepad.tsx uses (seam)
import { SupabaseLamplightAdapter } from '../../storage/supabase-lamplight-adapter';
import { useLamplightEntitlement } from '../../hooks/useLamplightEntitlement'; // seam (item 9)
import { useAuthSession } from '@/auth/context/useAuthSession';   // the signed-in user id — mirrors Notepad.tsx's source (seam)
import { useNoteCollection } from '@/notepad/context/useNoteCollection'; // note-collection seam — SAME hook Notepad.tsx:322 uses
import type { ReflectionRecord } from '../../storage/lamplight-adapter';
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

  // Save-to-notes seam: reuse Notepad's existing note-create path, then write the letter into
  // the new note. The adapter flag-flip (setReflectionSavedToNotes) is owned + tested in Task 17;
  // this insert reuses existing collection code.
  const handleSaveToNotes = async (record: ReflectionRecord) => {
    const note = await collection.createNote('root', 'devotion');
    const content = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: record.title }] },
        ...record.artifact.letter
          .split('\n\n')
          .filter((p) => p.length > 0)
          .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
      ],
    });
    await collection.updateNote(note.id, { title: record.title, content });
  };

  return (
    <WaymarksPeriodDetail
      adapter={adapter}
      userId={userId}
      canAccess={canAccess}
      onSaveToNotes={handleSaveToNotes}
    />
  );
}
