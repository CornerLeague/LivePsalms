import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, WifiOff } from 'lucide-react';
import { NotepadProvider } from '@/notepad/context/NotepadProvider';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useNotepadActions } from '@/notepad/context/useNotepadActions';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { NotepadToolbar } from '@/notepad/components/NotepadToolbar';
import { ReflectionsButton } from '@/notepad/components/ReflectionsButton';
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
import { useArrivalDot, ArrivalDot } from '@/notepad/lamplight/arrival-badge';
import { supabase } from '@/lib/supabase';
import { makeStreamInvoke } from '@/notepad/bible/lamplight-stream-client';
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileNotepadWorkspace } from './notepad/mobile/MobileNotepadWorkspace';
import { loadEnum, saveEnum, KEY_EDITOR_TAB } from '@/notepad/session/session-storage';
import { OnboardingProvider } from '@/notepad/onboarding/OnboardingProvider';
import { OnboardingSurfaces } from '@/notepad/onboarding/OnboardingSurfaces';
import { buildGuidedNote, TOUR_SAMPLE_NOTE_TITLE, buildTourSampleNote } from '@/notepad/onboarding/guided-note/guided-note-template';
import { registerWorkspaceControls } from '@/notepad/onboarding/tour/workspace-controller';
import { RecordingsDock } from '@/notepad/recordings/RecordingsDock';

function DesktopNotepadWorkspace() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [graphOpen, setGraphOpen] = useState(true);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'backlinks' | 'info' | 'lamplight'>(() =>
    loadEnum(KEY_EDITOR_TAB, ['content', 'backlinks', 'info', 'lamplight'] as const, 'content'),
  );

  const navigate = useNavigate();
  useEffect(() => {
    return registerWorkspaceControls({
      desktopSetGraphOpen: (open) => setGraphOpen(open),
      // Desktop auth entry is the /login route (LoginPage → AuthCard, which
      // includes a signup mode) — resolved open item 1; MobileAuthModal is
      // mobile-only.
      openAuth: () => navigate('/login'),
      desktopSetActiveTab: (tab) => setActiveTab(tab),
    });
  }, [navigate]);

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

  // useLamplightSettings accepts a null adapter directly and fails closed. When
  // Supabase is not configured, lamplightAdapter is null — pass userId=null too.
  const { settings: lamplightSettings } = useLamplightSettings({
    adapter: lamplightAdapter,
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

  // useArrivalDot requires a non-null adapter + userId (Rules of Hooks — always called);
  // when either is absent the hook harmlessly no-ops (listReflections('') resolves empty)
  // and showArrival stays false, so the dot never renders.
  const showArrival = useArrivalDot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (lamplightAdapter ?? ({ listReflections: async () => [] } as any)),
    lamplightAdapter ? (user?.id ?? '') : '',
  );

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
            {/* Reflections — its own top-level destination, sitting right before
                the Lamplight tab so the two "path" doors read as a pair. It
                navigates away (a door) rather than switching tabs, so it keeps
                its distinct pill look instead of the flat tab styling. */}
            <ReflectionsButton className="mr-2" />
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
              {showArrival && <ArrivalDot />}
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
  const { collection, notes } = useNoteCollection();
  const notesRef = useRef(notes);
  // eslint-disable-next-line react-hooks/refs
  notesRef.current = notes;

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

  useEffect(() => {
    return registerWorkspaceControls({
      // Idempotent (spec §6): an existing sample note is detected by its exact
      // locked title and reused — Back/replay/viewport-switch never duplicates.
      createSampleNote: async () => {
        const existing = notesRef.current.find((note) => note.title === TOUR_SAMPLE_NOTE_TITLE);
        if (existing) {
          collection.openNote(existing.id);
          return existing.id;
        }
        const note = await collection.createNote('root', 'devotion');
        const sample = buildTourSampleNote();
        await collection.updateNote(note.id, { title: sample.title, content: sample.content });
        // createNote (above) already made this empty note the active note, so
        // the desktop editor — already mounted on the content tab — hydrated
        // ProseMirror from it while it was still blank. The editor's active-note
        // effect watches the note id ONLY (by design: a user's own in-flight
        // edits must not be clobbered by their own debounced save echoing back
        // — see use-note-editor.ts), so writing the real content into that SAME
        // id above does not re-trigger it, and neither would simply reopening
        // the same id below. Force a genuine id transition — away and back —
        // so the effect re-fires and re-hydrates from the now-correct content.
        // The two calls must land in separate React commits (an id round trip
        // batched into one commit would look like no change at all), so yield
        // a real task between them instead of calling them back to back.
        collection.openNote(null);
        await new Promise((resolve) => setTimeout(resolve, 0));
        collection.openNote(note.id);
        return note.id;
      },
      openNote: (id) => collection.openNote(id),
    });
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
    <OnboardingProvider>
      {isMobile ? <MobileNotepadWorkspace /> : <DesktopNotepadWorkspace />}
      <NotepadOnboardingOverlay />
    </OnboardingProvider>
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
