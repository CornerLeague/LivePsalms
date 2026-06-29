// src/components/sections/notepad/mobile/MobileNotesView.tsx
import { Search, User, Flame } from 'lucide-react';
import { NotepadSidebar } from '../../../../notepad/components/Sidebar';
import { MobileFabMenu } from './MobileFabMenu';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';

export interface MobileNotesViewProps {
  onExit: () => void;
  onOpenSearch: () => void;
  onNewNote: () => void;
  /** Opens the handwriting scan flow via the FAB "Scan note" option. */
  onScanNote: () => void;
  /** Receives files chosen via the FAB "Upload note" option. */
  onUploadFiles: (files: File[]) => void | Promise<void>;
  onOpenNote: (id: string) => void;
  /** Opens the Lamplight view (relocated from the bottom bar to the header). */
  onOpenLamplight?: () => void;
  /** Show the gold connection dot on the flame when Lamplight has neighbors. */
  lamplightHasConnections?: boolean;
  /** Opens the account menu (signed in) or the sign in / sign up modal (signed out). */
  onOpenAccount?: () => void;
  /** The signed-in user's avatar URL, if they've uploaded one. */
  avatarUrl?: string | null;
}

export function MobileNotesView({
  onExit,
  onOpenSearch,
  onNewNote,
  onScanNote,
  onUploadFiles,
  onOpenNote,
  onOpenLamplight,
  lamplightHasConnections,
  onOpenAccount,
  avatarUrl,
}: MobileNotesViewProps) {
  return (
    <div className="relative flex flex-col h-full min-h-0" style={{ background: 'var(--notepad-page-bg)' }}>
      <header
        className="shrink-0 flex items-center justify-between px-3"
        style={{ height: 48, borderBottom: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}
      >
        <button
          aria-label="Home"
          onClick={onExit}
          className="flex items-center"
        >
          <img src="/logo-icon.png" alt="LivePsalms" className="notepad-nav-logo h-7 w-auto object-contain" />
        </button>
        <div className="flex items-center gap-1">
          <button
            aria-label="Lamplight"
            onClick={onOpenLamplight}
            className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: '#b8843a' }}
          >
            <Flame size={18} />
            {lamplightHasConnections && (
              <span
                data-testid="lamplight-dot"
                style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#b8843a' }}
              />
            )}
          </button>
          <button
            aria-label="Search notes"
            onClick={onOpenSearch}
            className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--deep-umber)' }}
          >
            <Search size={18} />
          </button>
          <ThemeToggle className="w-9 h-9" />
          <button
            aria-label="Account"
            onClick={onOpenAccount}
            className="flex items-center justify-center w-9 h-9 rounded-full overflow-hidden hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--deep-umber)' }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <User size={18} />
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        <NotepadSidebar hideCollectionHeader={false} onOpenNote={onOpenNote} />
      </div>

      <MobileFabMenu onNewNote={onNewNote} onScanNote={onScanNote} onUploadFiles={onUploadFiles} />
    </div>
  );
}
