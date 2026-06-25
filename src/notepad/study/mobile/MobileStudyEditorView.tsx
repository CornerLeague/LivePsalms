import { ChevronLeft } from 'lucide-react';
import { NotepadEditor } from '@/notepad/components/Editor';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
import { useKeyboardInset } from '@/components/sections/notepad/mobile/useKeyboardInset';

export interface MobileStudyEditorViewProps {
  /** Return to the Study notes list (clears the active note). */
  onBack: () => void;
}

export function MobileStudyEditorView({ onBack }: MobileStudyEditorViewProps) {
  const keyboardInset = useKeyboardInset();
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--notepad-page-bg)' }}>
      <header
        className="shrink-0 flex items-center justify-between gap-1 px-3"
        style={{ height: 48, borderBottom: '1px solid var(--pale-stone)', fontFamily: 'Outfit, sans-serif' }}
      >
        <button
          aria-label="Back to Study notes"
          onClick={onBack}
          className="flex items-center gap-1"
          style={{ color: 'var(--deep-umber)', fontSize: 13, background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <ChevronLeft size={18} /> Study notes
        </button>
        <ThemeToggle className="w-9 h-9" />
      </header>
      <div className="flex-1 min-h-0">
        <NotepadEditor toolbarPlacement="bottom" toolbarBottomOffset={keyboardInset} />
      </div>
    </div>
  );
}
