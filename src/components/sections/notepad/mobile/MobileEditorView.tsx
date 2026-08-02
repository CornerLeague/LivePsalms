// src/components/sections/notepad/mobile/MobileEditorView.tsx
import { User } from 'lucide-react';
import { NotepadEditor } from '../../../../notepad/components/Editor';
import type { Note } from '../../../../notepad/types';
import { MobileNewNoteFab } from './MobileNewNoteFab';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
import { TourReplayButton } from '@/notepad/onboarding/TourReplayButton';
import { HeaderLamplightFlame } from './HeaderLamplightFlame';
import { NotesMenu } from '@/components/notes-menu/NotesMenu';

export interface MobileEditorViewProps {
  /** Tapping the logo returns to the home page. */
  onExit: () => void;
  onAfterSave?: (note: Note) => void;
  /** Opens the account menu (signed in) or the sign in / sign up modal (signed out). */
  onOpenAccount?: () => void;
  /** The signed-in user's avatar URL, if they've uploaded one. */
  avatarUrl?: string | null;
  /** Fires the loading overlay on site-nav taps (parity with the old dock). */
  onNavTrigger?: () => void;
  /** Opens the Lamplight view (relocated from the bottom bar to the header). */
  onOpenLamplight?: () => void;
  /** Show the gold connection dot on the flame when Lamplight has neighbors. */
  lamplightHasConnections?: boolean;
  /** Show the gold arrival dot on the flame when a new reflection has arrived (Task 18). */
  lamplightHasArrived?: boolean;
  /** Whether a note is currently displayed in the editor. */
  hasActiveNote: boolean;
  /** Create a new note (used by the empty-state FAB). */
  onNewNote: () => void;
}

export function MobileEditorView({
  onExit,
  onAfterSave,
  onOpenAccount,
  avatarUrl,
  onNavTrigger,
  onOpenLamplight,
  lamplightHasConnections,
  lamplightHasArrived,
  hasActiveNote,
  onNewNote,
}: MobileEditorViewProps) {
  return (
    <div className="relative flex flex-col h-full min-h-0" style={{ background: 'var(--notepad-page-bg)' }}>
      <header
        className="shrink-0 flex items-center justify-between gap-1 px-3"
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
          <HeaderLamplightFlame
            onOpenLamplight={onOpenLamplight}
            lamplightHasConnections={lamplightHasConnections}
            lamplightHasArrived={lamplightHasArrived}
          />
          <TourReplayButton className="w-9 h-9" />
          <ThemeToggle className="w-9 h-9" />
          <NotesMenu className="w-9 h-9 rounded-full" iconSize={18} onNavTrigger={onNavTrigger} />
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

      <div className="flex-1 min-h-0">
        <NotepadEditor
          onAfterSave={onAfterSave}
          // Toolbar rides at the top, directly under this view's header — keeping
          // the mobile styling (compact, scrollable, portaled menus) but off the
          // bottom edge, where it collided with the workspace tab bar's raised
          // Reflections button.
          toolbarPlacement="top"
          mobile
        />
      </div>
      {!hasActiveNote && <MobileNewNoteFab onClick={onNewNote} />}
    </div>
  );
}
