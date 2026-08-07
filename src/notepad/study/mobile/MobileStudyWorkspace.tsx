// src/notepad/study/mobile/MobileStudyWorkspace.tsx
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useEnsureStudyFolder } from '../useEnsureStudyFolder';
import { StudyReader } from '../panes/StudyReader';
import { StudySidePanel } from '../panes/StudySidePanel';
import { ApparatusRail } from '../panes/ApparatusRail';
import { StudyModeToggle } from '../StudyModeToggle';
import { NotesMenu } from '@/components/notes-menu/NotesMenu';
import { StudyTabBar } from './StudyTabBar';
import { MobileStudyEditorView } from './MobileStudyEditorView';
import { RecordingsDock } from '@/notepad/recordings/RecordingsDock';
import type { MobileStudyTab } from './types';
import { saveBiblePassage } from '@/notepad/session/session-storage';
import { loadInitialPassage } from '@/notepad/bible/initial-passage';
import { SupabaseLamplightAdapter } from '@/notepad/storage/supabase-lamplight-adapter';
import { supabase } from '@/lib/supabase';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { InsightsOverlay } from '../insights/InsightsOverlay';
import { referenceDoor, passageDoor, deeperDoor, canGenerateInsights } from '../insights/doors';
import { useStudyHandoff } from '../insights/study-handoff';
import { useLamplightEntitlement } from '@/notepad/hooks/useLamplightEntitlement';
import '../study-theme.css';

export function MobileStudyWorkspace() {
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const lamplightAdapter = useMemo(
    () => (supabase ? new SupabaseLamplightAdapter(supabase) : null),
    [],
  );
  const { activeNote, collection } = useNoteCollection();
  const { translation } = useBiblePrefs();
  useEnsureStudyFolder();

  // Always open on Reader (Study top-tab entry); the last-used sub-tab is deliberately
  // not restored. Panes stay mounted below, so a carried journal note is preserved.
  const [tab, setTab] = useState<MobileStudyTab>('reader');
  const [passage, setPassage] = useState(loadInitialPassage);
  // Lifted so a verse tapped in the Reader tab feeds the Original Language panel
  // in the Context tab (desktop lifts this in StudyWorkspace; mobile omitted it,
  // so Original Language never populated here).
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  // Full-screen over the tab bar. The panes below stay mounted, so closing
  // Insights returns the reader to its scroll position and selected verse.
  const [insightsOpen, setInsightsOpen] = useState(false);
  // Gates the GENERATE action on the Passage door only. A cached door is public
  // and free, so this never hides content that already exists.
  const { hasAccess } = useLamplightEntitlement({ adapter: lamplightAdapter, userId: lamplightAdapter ? userId : null });
  // Both halves: a global promo makes hasAccess true for everyone, signed in or
  // not. See canGenerateInsights.
  const canGenerate = canGenerateInsights({ userId, hasInlineAccess: hasAccess('inline') });
  // The Insights → Chat seam. One press does three things, and only this
  // component can do all three: close the overlay, switch to the Study tab, and
  // hand the draft to the chat pane. The panes are display-toggled and never
  // unmount, so the draft that lands survives the tab switch — that is what
  // parent §8 means by "shared draft state, not a remount".
  const { handoff, sendToChat } = useStudyHandoff();
  const handleHandoff = useCallback((prompt: string) => {
    sendToChat(prompt);
    setInsightsOpen(false);
    setTab('study');
  }, [sendToChat]);
  const doors = useMemo(
    // Door order is reading order: The Passage first, Sources & Reference last.
    () => [
      passageDoor({ translation, userId, adapter: lamplightAdapter, canGenerate, onHandoff: handleHandoff }),
      deeperDoor({ translation, userId, adapter: lamplightAdapter, canGenerate, onHandoff: handleHandoff }),
      referenceDoor({ translation, userId, adapter: lamplightAdapter }),
    ],
    [translation, userId, lamplightAdapter, canGenerate, handleHandoff],
  );

  // Stable + guarded so BibleReader's passage effect can't loop (see DesktopStudyWorkspace).
  const handlePassageChange = useCallback((ref: { book: string; chapter: number }) => {
    setPassage((prev) => {
      if (prev.book === ref.book && prev.chapter === ref.chapter) return prev;
      saveBiblePassage(ref);
      return { book: ref.book, chapter: ref.chapter };
    });
  }, []);

  // A note being active means the user opened it from the Notes segment: take over
  // full-screen (chosen "full-focus editor" behavior), hiding the toggle + tab bar.
  const editing = !!activeNote;

  return (
    <div
      data-mode="study"
      className="study-workspace fixed inset-x-0 top-0 flex flex-col"
      style={{ height: '100dvh', overflow: 'hidden', background: 'var(--cream, #F4F1EA)' }}
    >
      {!editing && (
        <header
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderBottom: '1px solid var(--pale-stone)',
          }}
        >
          <img
            src="/logo-icon.png"
            alt="LivePsalms"
            className="notepad-nav-logo h-6 w-auto object-contain cursor-pointer"
            onClick={() => navigate('/')}
          />
          <StudyModeToggle />
          {/* Right-aligned site menu — parity with the Journal mobile views, and
              the only mobile-Study path to the Appearance palette picker. */}
          <div style={{ marginLeft: 'auto' }}>
            <NotesMenu className="w-9 h-9 rounded-full" iconSize={18} />
          </div>
        </header>
      )}

      <div className="flex-1 min-h-0 relative">
        {editing ? (
          <MobileStudyEditorView onBack={() => collection.openNote(null)} />
        ) : (
          <>
            {/* Panes stay mounted (display toggle) so reader scroll + chat draft survive tab switches. */}
            <div style={{ height: '100%', display: tab === 'reader' ? 'block' : 'none', overflow: 'auto' }}>
              <StudyReader book={passage.book} chapter={passage.chapter} onPassageChange={handlePassageChange} onSelectVerse={(ref) => setSelectedVerse(ref.verse)} />
            </div>
            <div style={{ height: '100%', display: tab === 'study' ? 'block' : 'none' }}>
              <StudySidePanel
                book={passage.book}
                chapter={passage.chapter}
                userId={userId}
                onOpenInsights={() => setInsightsOpen(true)}
                handoff={handoff}
              />
            </div>
            <div style={{ height: '100%', display: tab === 'context' ? 'block' : 'none', overflow: 'auto' }}>
              <ApparatusRail book={passage.book} chapter={passage.chapter} translation={translation} selectedVerse={selectedVerse} userId={userId} adapter={lamplightAdapter} />
            </div>
          </>
        )}
      </div>

      {insightsOpen && (
        <InsightsOverlay
          book={passage.book}
          chapter={passage.chapter}
          selectedVerse={selectedVerse}
          doors={doors}
          onClose={() => setInsightsOpen(false)}
        />
      )}

      <RecordingsDock variant="mobile" onOpenNote={(id) => collection.openNote(id)} />

      {!editing && <StudyTabBar active={tab} onSelect={setTab} />}
    </div>
  );
}
