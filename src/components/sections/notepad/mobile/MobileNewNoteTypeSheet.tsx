// src/components/sections/notepad/mobile/MobileNewNoteTypeSheet.tsx
import type { NoteType } from '@/notepad/types';
import { NOTE_TYPE_CONFIG } from '@/notepad/note-type-config';
import { NOTE_TYPE_ORDER } from '@/notepad/sidebar/folder-tree-view';

export interface MobileNewNoteTypeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen note type; the caller creates the note. */
  onSelect: (type: NoteType) => void;
}

/**
 * Mobile bottom sheet that lets the user pick the kind of note to create
 * (General / Devotion / Sermon / Theme) before the note is made. Mirrors the
 * desktop "New Note" type picker, which mobile previously skipped by
 * hardcoding 'devotion'. Types + order + icons come from the shared config so
 * this stays in sync if note types change.
 */
export function MobileNewNoteTypeSheet({ open, onClose, onSelect }: MobileNewNoteTypeSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ fontFamily: 'Outfit, sans-serif' }}>
      <button
        aria-label="Close note type menu"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      />
      <div
        className="relative rounded-t-2xl flex flex-col"
        style={{
          background: 'var(--notepad-page-bg)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -8px 28px rgba(0,0,0,0.18)',
        }}
      >
        <div className="flex justify-center pt-2">
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--pale-stone)' }} />
        </div>

        <p
          className="px-5 pt-3 pb-1 text-[11px] uppercase"
          style={{ color: 'var(--silica)', letterSpacing: '0.12em' }}
        >
          New note
        </p>

        <div className="flex flex-col py-1">
          {NOTE_TYPE_ORDER.map((type) => {
            const { icon: Icon, color, label } = NOTE_TYPE_CONFIG[type];
            return (
              <button
                key={type}
                onClick={() => onSelect(type)}
                className="flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-left"
                style={{ color: 'var(--deep-umber)' }}
              >
                <Icon size={18} style={{ color }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
