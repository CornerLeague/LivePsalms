// src/components/sections/notepad/mobile/MobileEditorView.tsx
import { User } from 'lucide-react';
import { NotepadEditor } from '../../../../notepad/components/Editor';
import type { Note } from '../../../../notepad/types';
import { useKeyboardInset } from './useKeyboardInset';
import { MobileNewNoteFab } from './MobileNewNoteFab';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';

export interface MobileEditorViewProps {
  /** Tapping the logo returns to the home page. */
  onExit: () => void;
  onAfterSave?: (note: Note) => void;
  /** Opens the account menu (signed in) or the sign in / sign up modal (signed out). */
  onOpenAccount?: () => void;
  /** The signed-in user's avatar URL, if they've uploaded one. */
  avatarUrl?: string | null;
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
  hasActiveNote,
  onNewNote,
}: MobileEditorViewProps) {
  const keyboardInset = useKeyboardInset();
  return (
    <div className="relative flex flex-col h-full min-h-0" style={{ background: 'var(--plaster)' }}>
      <header
        className="shrink-0 flex items-center justify-between gap-1 px-3"
        style={{ height: 48, borderBottom: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}
      >
        <button
          aria-label="Home"
          onClick={onExit}
          className="flex items-center"
        >
          <img src="/logo-icon.png" alt="LivePsalms" className="h-7 w-auto object-contain" />
        </button>
        <div className="flex items-center gap-1">
        <ThemeToggle className="w-9 h-9" />
        <button
          aria-label="Account"
          onClick={onOpenAccount}
          className="flex items-center justify-center w-9 h-9 rounded-full overflow-hidden hover:bg-black/5"
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
          toolbarPlacement="bottom"
          toolbarBottomOffset={keyboardInset}
        />
      </div>
      {!hasActiveNote && <MobileNewNoteFab onClick={onNewNote} />}
    </div>
  );
}
