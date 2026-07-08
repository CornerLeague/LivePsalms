// src/components/sections/notepad/mobile/MobileFabMenu.tsx
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Plus, Pencil, Upload, Camera } from 'lucide-react';

export interface MobileFabMenuProps {
  /** Create a new note (existing devotion-create-and-edit flow). */
  onNewNote: () => void;
  /** Open the handwriting scan flow (camera / photo → transcription review). */
  onScanNote: () => void;
  /** Receives the picked files; may be async (resolves when import finishes). */
  onUploadFiles: (files: File[]) => void | Promise<void>;
}

/**
 * Mobile-only floating action button that expands into a small menu offering
 * "New note", "Scan note" (handwriting → camera/photo), and "Upload note".
 * Rotates + → × on open, dismisses on option select / re-tap / backdrop tap /
 * Escape, and shows a spinner while an upload import is in flight. Respects
 * prefers-reduced-motion.
 */
export function MobileFabMenu({ onNewNote, onScanNote, onUploadFiles }: MobileFabMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleNewNote = () => {
    setOpen(false);
    onNewNote();
  };

  const handleScanNote = () => {
    setOpen(false);
    onScanNote();
  };

  const handleUploadClick = () => {
    setOpen(false);
    inputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Reset so picking the same file again still fires change.
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    try {
      await onUploadFiles(files);
    } finally {
      setBusy(false);
    }
  };

  const options = [
    { key: 'new', label: 'New note', Icon: Pencil, onClick: handleNewNote },
    { key: 'scan', label: 'Scan note', Icon: Camera, onClick: handleScanNote },
    { key: 'upload', label: 'Upload note', Icon: Upload, onClick: handleUploadClick },
  ] as const;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="fab-backdrop"
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          />
        )}
      </AnimatePresence>

      <div
        className="absolute z-50 flex flex-col items-end"
        style={{ right: 16, bottom: 'calc(72px + env(safe-area-inset-bottom))' }}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              className="mb-3 flex flex-col items-end gap-2"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: 10, y: 10, filter: 'blur(10px)' }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: 10, y: 10, filter: 'blur(10px)' }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 300, damping: 20, delay: 0.05 }
              }
            >
              {options.map((opt, i) => (
                <motion.button
                  key={opt.key}
                  type="button"
                  aria-label={opt.label}
                  onClick={opt.onClick}
                  className="flex items-center gap-2 rounded-full px-4 py-2 shadow-md"
                  style={{
                    background: 'var(--plaster)',
                    color: 'var(--deep-umber)',
                    border: '1px solid var(--pale-stone)',
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: 13,
                  }}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: 20 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.2, delay: i * 0.05 }}
                >
                  <opt.Icon size={16} />
                  <span>{opt.label}</span>
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          data-tour="mobile-new-note-fab"
          aria-label={open ? 'Close menu' : 'New note menu'}
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-center rounded-full shadow-lg disabled:opacity-80"
          style={{ width: 52, height: 52, background: '#b8843a', color: '#fff' }}
        >
          {busy ? (
            <span
              data-testid="fab-spinner"
              className="block rounded-full animate-spin"
              style={{
                width: 22,
                height: 22,
                border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff',
              }}
            />
          ) : (
            <motion.span
              className="flex"
              animate={{ rotate: open ? 45 : 0 }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 20 }}
            >
              <Plus size={24} />
            </motion.span>
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".md,.txt,.pdf,.docx"
          multiple
          onChange={handleFileChange}
          className="hidden"
          data-testid="fab-file-input"
        />
      </div>
    </>
  );
}
