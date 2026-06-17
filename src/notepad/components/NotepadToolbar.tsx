import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  Plus,
  Upload,
  PanelRightClose,
  PanelRightOpen,
  LogIn,
  User,
} from 'lucide-react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useAccountProfile } from '@/auth/context/useAccountProfile';
import { useUserTier } from '../hooks/useUserTier';
import { TierBadge } from './TierBadge';
import { LevelUpModal } from './LevelUpModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNoteCollection } from '../context/useNoteCollection';
import type { NoteType } from '../types';
import { UploadModal } from './UploadModal';
import { StudyModeToggle } from '@/notepad/study/StudyModeToggle';

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
  const { collection } = useNoteCollection();
  const createNote = collection.createNote;
  const [uploadOpen, setUploadOpen] = useState(false);
  const { user, loading: authLoading, session } = useAuthSession();
  const { profile } = useAccountProfile();
  const { currentTier, showLevelUp, levelUpTier, dismissLevelUp } = useUserTier(
    profile?.highestNoteCount ?? 0
  );

  const handleNewNote = (type: NoteType) => {
    createNote('root', type);
  };

  // Shared button class
  const btnClass =
    'flex items-center justify-center rounded hover:bg-black/5 transition-colors cursor-pointer';

  return (
    <>
      {/* Toolbar */}
      <div
        className="flex items-center shrink-0 z-40"
        style={{
          height: 48,
          background: 'rgba(240, 236, 232, 0.97)',
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
            className="h-6 w-auto object-contain cursor-pointer"
            onClick={() => navigate('/')}
          />

          {/* Mode toggle */}
          <StudyModeToggle />

          {/* Search bar button */}
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 flex-1 max-w-xs mx-2 px-3 py-1.5 rounded-md hover:bg-black/5 transition-colors"
            style={{
              background: 'rgba(188, 179, 163, 0.15)',
              border: '1px solid rgba(206, 204, 202, 0.5)',
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
                background: 'rgba(188, 179, 163, 0.3)',
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

          {/* NEW NOTE dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-tour="new-note-sidebar-button"
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
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              style={{ fontFamily: 'Outfit, sans-serif', minWidth: 140 }}
            >
              <DropdownMenuItem
                onClick={() => handleNewNote('general')}
                style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12 }}
              >
                General
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewNote('devotion')}
                style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12 }}
              >
                Devotion
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewNote('sermon')}
                style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12 }}
              >
                Sermon
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleNewNote('theme')}
                style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12 }}
              >
                Theme
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

          {/* Auth area */}
          {authLoading ? (
            <div className="w-8 h-8" />
          ) : user ? (
            <div className="flex items-center gap-1">
              <TierBadge tier={currentTier} noteCount={profile?.noteCount ?? 0} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={`${btnClass} w-8 h-8 rounded-full overflow-hidden`}>
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" style={{ fontFamily: 'Outfit, sans-serif', minWidth: 140 }}>
                  <DropdownMenuItem onClick={() => navigate('/profile')} style={{ fontSize: 12 }}>
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={async () => {
                      await session.signOut();
                      navigate('/notepad');
                    }}
                    style={{ fontSize: 12 }}
                  >
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className={`${btnClass} flex items-center gap-1.5 px-3 h-8`}
              style={{ fontFamily: 'Outfit, sans-serif' }}
            >
              <LogIn className="w-3.5 h-3.5" style={{ color: 'var(--deep-umber)' }} />
              <span
                className="text-[10px] font-medium tracking-wider"
                style={{ color: 'var(--deep-umber)' }}
              >
                SIGN IN
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Upload modal */}
      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} />

      {/* Level-up modal */}
      <LevelUpModal open={showLevelUp} tier={levelUpTier} onDismiss={dismissLevelUp} />
    </>
  );
}
