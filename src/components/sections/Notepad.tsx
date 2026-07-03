import { useState, useCallback, useMemo, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, WifiOff } from 'lucide-react';
import { NotepadProvider } from '@/notepad/context/NotepadProvider';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useNotepadActions } from '@/notepad/context/useNotepadActions';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { NotepadToolbar } from '@/notepad/components/NotepadToolbar';
import { NotepadSidebar } from '@/notepad/components/Sidebar';
import { NotepadEditor } from '@/notepad/components/Editor';
import { BacklinksPanel } from '@/notepad/components/BacklinksPanel';
import { InfoPanel } from '@/notepad/components/InfoPanel';
import { SearchDialog } from '@/notepad/components/SearchDialog';
import { MigrationDialog } from '@/notepad/components/MigrationDialog';
import { StudyWindow } from './notepad/StudyWindow';
import { useOnlineStatus } from '@/notepad/hooks/useOnlineStatus';
import { useNotepadFirstLoad } from '@/notepad/first-load/useNotepadFirstLoad';
import { LamplightTabPanel } from '@/notepad/components/lamplight/LamplightTabPanel';
import { ConnectionCardsStrip } from '@/notepad/components/lamplight/ConnectionCardsStrip';
import { SupabaseLamplightAdapter } from '@/notepad/storage/supabase-lamplight-adapter';
import { useLamplightSettings } from '@/notepad/hooks/useLamplightSettings';
import { useLamplightEmbeddingTrigger } from '@/notepad/hooks/useLamplightEmbeddingTrigger';
import { supabase } from '@/lib/supabase';
import { makeStreamInvoke } from '@/notepad/bible/lamplight-stream-client';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileNotepadWorkspace } from './notepad/mobile/MobileNotepadWorkspace';
import { loadEnum, saveEnum, KEY_EDITOR_TAB } from '@/notepad/session/session-storage';
import { OnboardingProvider } from '@/notepad/onboarding/OnboardingProvider';
import { OnboardingSurfaces } from '@/notepad/onboarding/OnboardingSurfaces';
import { buildGuidedNote } from '@/notepad/onboarding/guided-note/guided-note-template';
import { RecordingsAudioProvider } from '@/notepad/recordings/audio-context';
import { RecordingsDock } from '@/notepad/recordings/RecordingsDock';

function DesktopNotepadWorkspace() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(true);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'backlinks' | 'info' | 'lamplight'>(() =>
    loadEnum(KEY_EDITOR_TAB, ['content', 'backlinks', 'info', 'lamplight'] as const, 'content'),
  );

  useEffect(() => {
    saveEnum(KEY_EDITOR_TAB, activeTab);
  }, [activeTab]);

  const { user, adapter } = useAuthSession();
  const lamplightAdapter = useMemo(
    () => (supabase ? new SupabaseLamplightAdapter(supabase) : null),
    []
  );
  // Live SSE transport for Lamplight chat. Bound only when Supabase is configured
  // (a null client would send `Bearer undefined`); memoized so it isn't rebuilt.
  const streamInvoke = useMemo(
    () => (supabase ? makeStreamInvoke(supabase) : undefined),
    []
  );

  // useLamplightSettings requires a non-null adapter. When Supabase is not
  // configured, lamplightAdapter is null — pass userId=null to skip the fetch.
  const { settings: lamplightSettings } = useLamplightSettings({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter: lamplightAdapter as any,
    userId: lamplightAdapter ? (user?.id ?? null) : null,
  });

  // useLamplightEmbeddingTrigger also requires a non-null adapter. Guard enabled
  // so that when Supabase/adapter is absent the returned callback is always a no-op.
  const onAfterSave = useLamplightEmbeddingTrigger({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adapter: lamplightAdapter as any,
    enabled: !!(lamplightAdapter && lamplightSettings?.enabled),
    userId: lamplightAdapter ? (user?.id ?? null) : null,
    invoke: (name, options) => supabase!.functions.invoke(name, options),
  });

  const actions = useNotepadActions();
  const { notes, activeNote, collection } = useNoteCollection();
  const refresh = useCallback(() => actions.init(), [actions]);
  const { showMigration, dismissMigration } = useNotepadFirstLoad();

  const isOnline = useOnlineStatus();
  const isLoggedIn = !!user;
  const isOfflineAndLoggedIn = !isOnline && isLoggedIn;

  const handleOpenSearch = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  }, []);

  const handleOpenNoteFromSidebar = useCallback(
    (id: string) => {
      collection.openNote(id);
      setActiveTab('content');
    },
    [collection],
  );

  return (
    <div className="fixed inset-0 flex flex-col" style={{ top: 0, background: 'var(--notepad-page-bg)' }}>
      <NotepadToolbar
        graphOpen={graphOpen}
        onToggleGraph={() => setGraphOpen(!graphOpen)}
        onOpenSearch={handleOpenSearch}
      />

      {isOfflineAndLoggedIn && (
        <div
          className="flex items-center justify-center gap-2 py-2 text-xs"
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

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — stays visible when graph expands */}
        <div
          className="shrink-0 flex flex-col border-r"
          style={{
            width: sidebarOpen ? 220 : 48,
            borderColor: 'var(--pale-stone)',
            background: 'var(--notepad-sidebar-bg)',
            transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Sidebar header with COLLECTION + toggle */}
          <div
            className="flex items-center shrink-0 px-4 pt-4 pb-2"
            style={{ minHeight: 40 }}
          >
            {sidebarOpen && (
              <h3
                className="text-[10px] font-medium tracking-[0.2em] flex-1"
                style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
              >
                COLLECTION
              </h3>
            )}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center justify-center w-7 h-7 rounded hover:bg-black/5 transition-colors cursor-pointer"
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              style={{ marginLeft: sidebarOpen ? 0 : 'auto', marginRight: sidebarOpen ? 0 : 'auto' }}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />
              ) : (
                <PanelLeftOpen className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />
              )}
            </button>
          </div>

          {/* Sidebar content — hidden when collapsed */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden"
            style={{
              opacity: sidebarOpen ? 1 : 0,
              transition: 'opacity 0.3s ease',
              pointerEvents: sidebarOpen ? 'auto' : 'none',
            }}
          >
            {sidebarOpen && (
              <NotepadSidebar
                hideCollectionHeader
                onOpenNote={handleOpenNoteFromSidebar}
              />
            )}
          </div>
        </div>

        {/* Editor Pane — hidden when graph is expanded */}
        <main
          className="overflow-y-auto flex flex-col min-w-0"
          style={{
            flex: graphExpanded ? '0 0 0px' : '1 1 0%',
            opacity: graphExpanded ? 0 : 1,
            transition: 'flex 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
            overflow: 'hidden',
          }}
        >
          {/* Tab Bar */}
          <div
            className="flex items-center gap-0 border-b shrink-0"
            style={{ borderColor: 'var(--pale-stone)' }}
          >
            {(['content', 'backlinks', 'info'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-5 py-3 text-[11px] font-medium tracking-wider transition-colors relative"
                style={{
                  color: activeTab === tab ? 'var(--deep-umber)' : 'var(--silica)',
                  fontFamily: 'Outfit, sans-serif',
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {activeTab === tab && (
                  <div
                    className="absolute bottom-0 left-5 right-5 h-px"
                    style={{ background: 'var(--deep-umber)' }}
                  />
                )}
              </button>
            ))}
            <span
              aria-hidden
              className="mx-2"
              style={{ color: 'var(--silica)', opacity: 0.3 }}
            >
              |
            </span>
            <button
              data-tour="lamplight-panel-entry"
              onClick={() => setActiveTab('lamplight')}
              className="px-5 py-3 text-[11px] font-medium tracking-wider transition-colors relative"
              style={{
                color: activeTab === 'lamplight' ? 'var(--deep-umber)' : '#b8843a',
                fontFamily: 'Outfit, sans-serif',
              }}
            >
              🕯 Lamplight
              {activeTab === 'lamplight' && (
                <div
                  className="absolute bottom-0 left-5 right-5 h-px"
                  style={{ background: 'var(--deep-umber)' }}
                />
              )}
            </button>
          </div>

          {/* Tab Content — the editor fills the remaining space and scrolls
              internally; min-h-0 lets it shrink so the Connection Cards strip
              below stays on-screen instead of being clipped by main's
              overflow:hidden. */}
          {activeTab === 'content' && (
            <div className="flex-1 min-h-0">
              <NotepadEditor onAfterSave={onAfterSave} />
            </div>
          )}
          {activeTab === 'backlinks' && <BacklinksPanel />}
          {activeTab === 'info' && <InfoPanel />}
          {activeTab === 'lamplight' && lamplightAdapter && (
            <LamplightTabPanel lamplightAdapter={lamplightAdapter} autoGenerate={false} />
          )}
          {activeTab === 'lamplight' && !lamplightAdapter && (
            <div
              className="flex items-center justify-center min-h-[420px]"
              style={{ background: 'var(--alabaster)' }}
            >
              <p className="text-xs" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                Lamplight unavailable — Supabase not configured.
              </p>
            </div>
          )}

          {/* Connection Cards strip — only on the Content tab, only when the
              active note qualifies and has neighbors. The strip self-hides
              for every other state (no empty-state placeholders here; the
              Lamplight tab handles those for users who go looking). */}
          {activeTab === 'content' && lamplightAdapter && user && (
            <div className="shrink-0 overflow-y-auto" style={{ maxHeight: '45vh' }}>
              <ConnectionCardsStrip
                adapter={lamplightAdapter}
                userId={user.id}
                activeNote={activeNote}
                totalNoteCount={notes.length}
                loadNeighborNotes={async (ids) =>
                  notes.filter((n) => ids.includes(n.id))
                }
                onOpenNote={(id) => collection.openNote(id)}
              />
            </div>
          )}

          <RecordingsDock
            variant="desktop"
            onOpenNote={(id) => {
              collection.openNote(id);
              setActiveTab('content');
            }}
          />
        </main>

        {/* Study Window — Bible reader + graph, tabbed */}
        <StudyWindow
          graphOpen={graphOpen}
          expanded={graphExpanded}
          onToggleExpand={() => setGraphExpanded(!graphExpanded)}
          lamplightAdapter={lamplightAdapter}
          invoke={(name, options) =>
            supabase!.functions.invoke(name, { body: options.body as Record<string, unknown> })
          }
          streamInvoke={streamInvoke}
        />
      </div>

      <SearchDialog />
      <MigrationDialog
        open={showMigration}
        onClose={dismissMigration}
        targetAdapter={adapter}
        onMigrationComplete={refresh}
      />
    </div>
  );
}

/**
 * Renders the onboarding overlay (tour / checklist / guided-note offer) above
 * the workspace. Lives inside NotepadProvider so it can create the guided note
 * through the existing NoteCollection API. Mounted as a fixed overlay so it
 * never disturbs the existing workspace layout.
 */
function NotepadOnboardingOverlay() {
  const { collection } = useNoteCollection();

  const createGuidedNote = useCallback(async () => {
    try {
      const note = await collection.createNote('root', 'devotion');
      const { title, content } = buildGuidedNote();
      await collection.updateNote(note.id, { title, content });
      collection.openNote(note.id);
    } catch (err) {
      console.warn('[Notepad] createGuidedNote failed:', err);
    }
  }, [collection]);

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-3 pointer-events-none [&>*]:pointer-events-auto">
      <OnboardingSurfaces onStartGuidedNote={createGuidedNote} />
    </div>
  );
}

export function NotepadWorkspace() {
  const isMobile = useIsMobile();
  return (
    <RecordingsAudioProvider>
      <OnboardingProvider>
        {isMobile ? <MobileNotepadWorkspace /> : <DesktopNotepadWorkspace />}
        <NotepadOnboardingOverlay />
      </OnboardingProvider>
    </RecordingsAudioProvider>
  );
}

export function Notepad() {
  const { adapter } = useAuthSession();
  return (
    <NotepadProvider adapter={adapter}>
      <NotepadWorkspace />
    </NotepadProvider>
  );
}
