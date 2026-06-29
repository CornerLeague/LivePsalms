// src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useAccountProfile } from '@/auth/context/useAccountProfile';
import { useNotepadActions } from '../../../../notepad/context/useNotepadActions';
import { filesToNotes } from '../../../../notepad/import/document-importer';
import { useNotepadFirstLoad } from '../../../../notepad/first-load/useNotepadFirstLoad';
import { SearchDialog } from '../../../../notepad/components/SearchDialog';
import { MigrationDialog } from '../../../../notepad/components/MigrationDialog';
import { MobileTabBar } from './MobileTabBar';
import { MobileNotesView } from './MobileNotesView';
import { MobileEditorView } from './MobileEditorView';
import { LamplightMobileView } from './LamplightMobileView';
import { BibleStudyPane } from '@/notepad/bible/BibleStudyPane';
import { MobileMoreSheet } from './MobileMoreSheet';
import { MobileAuthModal } from './MobileAuthModal';
import { MobileAccountSheet } from './MobileAccountSheet';
import { MobileNewNoteTypeSheet } from './MobileNewNoteTypeSheet';
import { useMobileWorkspaceModel } from './useMobileWorkspaceModel';
import type { NoteType } from '../../../../notepad/types';
import { useHasConnections } from './useHasConnections';
import { StudyModeToggle } from '@/notepad/study/StudyModeToggle';
import { ScanCapturePanel } from '../../../../notepad/components/ScanCapturePanel';
import { TranscriptionReview } from '../../../../notepad/components/TranscriptionReview';
import type { TranscriptionResult } from '../../../../notepad/scan/types';
import type { MobileTab } from './types';
import { loadEnum, saveEnum, KEY_MOBILE_TAB } from '../../../../notepad/session/session-storage';

type ScanStage = null | 'capture' | { review: TranscriptionResult };

export function MobileNotepadWorkspace() {
  const navigate = useNavigate();
  const model = useMobileWorkspaceModel();
  const actions = useNotepadActions();
  const { adapter, session } = useAuthSession();
  const { profile } = useAccountProfile();
  const { showMigration, dismissMigration } = useNotepadFirstLoad();

  const [tab, setTab] = useState<MobileTab>(() =>
    loadEnum<MobileTab>(KEY_MOBILE_TAB, ['notes', 'editor', 'lamplight', 'bible'], 'notes'),
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  const [scan, setScan] = useState<ScanStage>(null);

  // While 'editor' is the stored tab but no note is active yet (notes still
  // loading, or the note no longer exists), render the notes list instead of an
  // empty editor. Deriving this avoids a setState-in-effect and the mount-time
  // race where the restored note loads after the tab guard would have run.
  const effectiveTab: MobileTab = tab === 'editor' && !model.activeNote ? 'notes' : tab;

  // Persist the active tab so a refresh lands the user back on it.
  useEffect(() => {
    saveEnum(KEY_MOBILE_TAB, effectiveTab);
  }, [effectiveTab]);

  const openAccount = useCallback(() => {
    if (model.user) {
      setAccountOpen(true);
    } else {
      setAuthOpen(true);
    }
  }, [model.user]);

  const handleSignOut = useCallback(async () => {
    setAccountOpen(false);
    await session.signOut();
    navigate('/notepad');
  }, [session, navigate]);

  const { openNote, createNote } = model;

  const hasConnections = useHasConnections({
    adapter: model.lamplightAdapter,
    userId: model.user?.id ?? null,
    activeNote: model.activeNote,
    totalNoteCount: model.totalNoteCount,
    loadNeighborNotes: model.loadNeighborNotes,
  });

  const openSearch = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  }, []);

  const handleSelectTab = useCallback((next: MobileTab) => {
    if (next === 'more') {
      setMoreOpen(true);
      return;
    }
    setMoreOpen(false);
    setTab(next);
  }, []);

  const handleOpenNote = useCallback(
    (id: string) => {
      openNote(id);
      setTab('editor');
    },
    [openNote],
  );

  // Mobile previously created a Devotion note directly; now we ask which kind
  // of note first (matching the desktop type picker).
  const handleNewNote = useCallback(() => {
    setNewTypeOpen(true);
  }, []);

  const handleSelectNoteType = useCallback(
    (type: NoteType) => {
      setNewTypeOpen(false);
      createNote('root', type);
      setTab('editor');
    },
    [createNote],
  );

  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      const notes = await filesToNotes(files, {
        folderId: 'root',
        autoDetectVerses: true,
      });
      await actions.importNotes(notes);
    },
    [actions],
  );

  // Scanning writes to a per-user storage bucket and calls an authed edge
  // function, so it requires a signed-in user; prompt sign-in otherwise.
  const handleScanNote = useCallback(() => {
    if (!model.user) {
      setAuthOpen(true);
      return;
    }
    setScan('capture');
  }, [model.user]);

  return (
    <div
      className="fixed inset-x-0 top-0 flex flex-col"
      style={{ height: '100dvh', background: 'var(--notepad-page-bg)' }}
    >
      {!model.isOnline && model.user && (
        <div
          className="flex items-center justify-center gap-2 py-2 text-xs shrink-0"
          style={{
            background: 'rgba(232, 169, 58, 0.15)',
            borderBottom: '1px solid rgba(232, 169, 58, 0.3)',
            color: 'var(--deep-umber)',
            fontFamily: 'Outfit, sans-serif',
          }}
        >
          <WifiOff className="w-3.5 h-3.5" />
          You're offline — viewing cached notes
        </div>
      )}

      {effectiveTab !== 'editor' && (
        <div
          className="shrink-0 flex items-center justify-center"
          style={{ padding: '6px 12px', borderBottom: '1px solid var(--pale-stone)' }}
        >
          <StudyModeToggle />
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {effectiveTab === 'notes' && (
          <MobileNotesView
            onExit={() => navigate('/')}
            onOpenSearch={openSearch}
            onNewNote={handleNewNote}
            onScanNote={handleScanNote}
            onUploadFiles={handleUploadFiles}
            onOpenNote={handleOpenNote}
            onOpenLamplight={() => setTab('lamplight')}
            lamplightHasConnections={hasConnections}
            onOpenAccount={openAccount}
            avatarUrl={profile?.avatarUrl ?? null}
          />
        )}
        {effectiveTab === 'editor' && (
          <MobileEditorView
            onExit={() => navigate('/')}
            onAfterSave={model.onAfterSave}
            onOpenAccount={openAccount}
            avatarUrl={profile?.avatarUrl ?? null}
            onOpenLamplight={() => setTab('lamplight')}
            lamplightHasConnections={hasConnections}
            hasActiveNote={!!model.activeNote}
            onNewNote={handleNewNote}
          />
        )}
        {effectiveTab === 'lamplight' && model.lamplightAdapter && (
          <LamplightMobileView
            lamplightAdapter={model.lamplightAdapter}
            userId={model.user?.id ?? null}
            activeNote={model.activeNote}
            totalNoteCount={model.totalNoteCount}
            loadNeighborNotes={model.loadNeighborNotes}
            onOpenNote={handleOpenNote}
          />
        )}
        {effectiveTab === 'lamplight' && !model.lamplightAdapter && (
          <div
            className="flex items-center justify-center h-full text-xs"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            Lamplight unavailable — Supabase not configured.
          </div>
        )}
        {effectiveTab === 'bible' && (
          <BibleStudyPane
            lamplightAdapter={model.lamplightAdapter}
            invoke={model.invoke}
            streamInvoke={model.streamInvoke}
          />
        )}
      </div>

      <MobileTabBar active={effectiveTab} onSelect={handleSelectTab} />

      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onOpenNote={handleOpenNote}
        lamplightAdapter={model.lamplightAdapter}
        invoke={model.invoke}
        streamInvoke={model.streamInvoke}
      />

      <MobileAuthModal open={authOpen} onClose={() => setAuthOpen(false)} />

      <MobileAccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onProfile={() => {
          setAccountOpen(false);
          navigate('/profile');
        }}
        onSignOut={handleSignOut}
      />

      <MobileNewNoteTypeSheet
        open={newTypeOpen}
        onClose={() => setNewTypeOpen(false)}
        onSelect={handleSelectNoteType}
      />

      {scan !== null && model.user && (
        <div
          className="fixed inset-0 z-[60] flex flex-col overflow-y-auto"
          style={{ background: 'var(--notepad-page-bg)' }}
        >
          {scan === 'capture' ? (
            <ScanCapturePanel
              userId={model.user.id}
              onResult={(result) => setScan({ review: result })}
              onCancel={() => setScan(null)}
            />
          ) : (
            <TranscriptionReview
              result={scan.review}
              folderId="root"
              persistNotes={(notes) => actions.importNotes(notes)}
              onSaved={() => setScan(null)}
              onDiscarded={() => setScan(null)}
            />
          )}
        </div>
      )}

      <SearchDialog />
      <MigrationDialog
        open={showMigration}
        onClose={dismissMigration}
        targetAdapter={adapter}
        onMigrationComplete={() => actions.init()}
      />
    </div>
  );
}
