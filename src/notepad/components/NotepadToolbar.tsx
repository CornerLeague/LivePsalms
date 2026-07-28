import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  Plus,
  Upload,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { useNoteCollection } from '../context/useNoteCollection';
import { useFolderHierarchy } from '../context/useFolderHierarchy';
import {
  resolveNewNoteFolderId,
  DEFAULT_NEW_NOTE_TYPE,
} from '../collection/new-note-target';
import { UploadModal } from './UploadModal';
import { StudyModeToggle } from '@/notepad/study/StudyModeToggle';
import { NotepadAuthControls } from './NotepadAuthControls';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
import { NotesMenu } from '@/components/notes-menu/NotesMenu';
import { useNavTrigger } from '@/hooks/nav-trigger-context';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NotepadToolbarProps {
  graphOpen: boolean;
  onToggleGraph: () => void;
  onOpenSearch: () => void;
}

// ---------------------------------------------------------------------------
// NotepadToolbar
// ---------------------------------------------------------------------------

export function NotepadToolbar({
  graphOpen,
  onToggleGraph,
  onOpenSearch,
}: NotepadToolbarProps) {
  const navigate = useNavigate();
  const { notes, activeNoteId, collection } = useNoteCollection();
  const { folders, loaded: foldersLoaded } = useFolderHierarchy();
  const createNote = collection.createNote;
  const [uploadOpen, setUploadOpen] = useState(false);
  const navTrigger = useNavTrigger();

  // One-click note creation: drop the note into the folder the user is currently
  // on (the active note's folder), or the top folder when they aren't on one.
  // `foldersLoaded` keeps a click fired mid-load from filing the note at root.
  const handleNewNote = () => {
    const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;
    const folderId = resolveNewNoteFolderId(activeNote, folders, foldersLoaded);
    createNote(folderId, DEFAULT_NEW_NOTE_TYPE);
  };

  // Shared button class
  const btnClass =
    'flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer';

  return (
    <>
      {/* Toolbar */}
      <div
        className="flex items-center shrink-0 z-40"
        style={{
          height: 48,
          background: 'var(--notepad-bar-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--pale-stone)',
          fontFamily: 'Outfit, sans-serif',
        }}
      >
        <div
          className="flex items-center w-full gap-1 px-3"
          style={{ height: 48 }}
        >
          {/* Back button */}
          <button
            onClick={() => navigate('/')}
            className={`${btnClass} w-8 h-8`}
            title="Back to home"
          >
            <ArrowLeft className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
          </button>

          {/* Logo */}
          <img
            src="/logo-icon.png"
            alt="LivePsalms"
            className="notepad-nav-logo h-6 w-auto object-contain cursor-pointer"
            onClick={() => navigate('/')}
          />

          {/* Mode toggle */}
          <StudyModeToggle />

          {/* Search bar button */}
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 flex-1 max-w-xs mx-2 px-3 py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus:outline-none focus-visible:outline-none"
            style={{
              background: 'color-mix(in srgb, var(--warm-sand) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--pale-stone) 50%, transparent)',
            }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--silica)' }} />
            <span
              className="text-[11px] flex-1 text-left"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              Search notes…
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
              style={{
                background: 'color-mix(in srgb, var(--warm-sand) 30%, transparent)',
                color: 'var(--silica)',
                fontFamily: 'Outfit, sans-serif',
                letterSpacing: '0.05em',
              }}
            >
              ⌘K
            </span>
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Theme toggle */}
          <ThemeToggle className="w-8 h-8" />

          {/* NEW NOTE — one click, drops into the current folder */}
          <button
            data-tour="new-note-sidebar-button"
            onClick={handleNewNote}
            title="New note in the current folder"
            className={`${btnClass} flex items-center gap-1.5 px-3 h-8`}
            style={{
              background: 'var(--deep-umber)',
              borderRadius: 6,
            }}
          >
            <Plus className="w-3.5 h-3.5" style={{ color: 'var(--plaster)' }} />
            <span
              className="text-[10px] font-medium tracking-widest"
              style={{ color: 'var(--plaster)', fontFamily: 'Outfit, sans-serif' }}
            >
              NEW NOTE
            </span>
          </button>

          {/* Upload button */}
          <button
            onClick={() => setUploadOpen(true)}
            className={`${btnClass} w-8 h-8 ml-1`}
            title="Upload"
          >
            <Upload className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
          </button>

          {/* Divider */}
          <div
            className="mx-2 self-stretch"
            style={{
              width: 1,
              background: 'var(--pale-stone)',
              marginTop: 10,
              marginBottom: 10,
            }}
          />

          {/* Graph toggle */}
          <button
            data-tour="graph-toggle-button"
            onClick={onToggleGraph}
            className={`${btnClass} w-8 h-8`}
            title={graphOpen ? 'Close graph' : 'Open graph'}
          >
            {graphOpen ? (
              <PanelRightClose className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
            ) : (
              <PanelRightOpen className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
            )}
          </button>

          {/* Divider */}
          <div
            className="mx-2 self-stretch"
            style={{
              width: 1,
              background: 'var(--pale-stone)',
              marginTop: 10,
              marginBottom: 10,
            }}
          />

          {/* Site nav */}
          <NotesMenu className="w-8 h-8 rounded" iconSize={18} onNavTrigger={navTrigger} />

          {/* Divider */}
          <div
            className="mx-2 self-stretch"
            style={{
              width: 1,
              background: 'var(--pale-stone)',
              marginTop: 10,
              marginBottom: 10,
            }}
          />

          {/* Auth area */}
          <NotepadAuthControls />
        </div>
      </div>

      {/* Upload modal */}
      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} />
    </>
  );
}
