// src/notepad/study/insights/InsightsOverlay.tsx
// The Insights shell: a full-screen study of the open passage, over the whole
// Study workspace.
//
// Doors are DATA, not a switch. B1 passes one (Sources & Reference) and the
// overlay renders it directly; B2 and B3 add entries to the array and the
// chooser wakes up on its own, with no re-layout.
//
// Focus/escape/scroll handling is cloned from RegionMapFullscreen, including
// the onCloseRef indirection — an inline onClose from the parent is a fresh
// identity every render, and without the ref it re-runs the setup effect,
// teleporting focus and breaking tab navigation. That bug has been fixed once
// already; the test suite pins it here so it stays fixed.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, X } from 'lucide-react';
import { bookByAbbrev } from '@/notepad/bible/bible-books';

/** The passage an Insights door is being asked about. */
export interface InsightsScope {
  book: string;
  chapter: number;
  /** null = the whole chapter. */
  verse: number | null;
}

export interface InsightsDoor {
  id: string;
  label: string;
  blurb: string;
  render: (scope: InsightsScope) => React.ReactNode;
}

export interface InsightsOverlayProps {
  book: string;
  chapter: number;
  selectedVerse: number | null;
  doors: InsightsDoor[];
  onClose: () => void;
}

export function InsightsOverlay({ book, chapter, selectedVerse, doors, onClose }: InsightsOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Scope starts at the reader's selected verse and can be widened to the whole
  // chapter. `false` means "the reader widened it" — kept separate from
  // selectedVerse so narrowing back is possible without re-tapping the reader.
  const [wholeChapter, setWholeChapter] = useState(false);
  const [openDoorId, setOpenDoorId] = useState<string | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key === 'Tab') {
        const nodes = overlayRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus();
    };
    // Runs once: setup/teardown is mount-scoped; onClose is read via onCloseRef.
  }, []);

  const bookName = bookByAbbrev(book)?.name ?? book;
  const verse = wholeChapter ? null : selectedVerse;
  const scope: InsightsScope = { book, chapter, verse };
  const scopeLabel = verse === null ? `${bookName} ${chapter}` : `${bookName} ${chapter}:${verse}`;

  const single = doors.length === 1 ? doors[0] : null;
  const openDoor = single ?? doors.find((d) => d.id === openDoorId) ?? null;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Insights on ${scopeLabel}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'var(--cream, #F4F1EA)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      <header
        style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderBottom: '1px solid var(--pale-stone)',
        }}
      >
        {openDoor && !single && (
          <button
            type="button"
            onClick={() => setOpenDoorId(null)}
            aria-label="Back to all insights"
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--deep-umber)', fontSize: 12,
            }}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> All insights
          </button>
        )}

        <div data-testid="insights-scope" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--deep-umber)', fontWeight: 600 }}>{scopeLabel}</span>
          {selectedVerse !== null && (
            <button
              type="button"
              onClick={() => setWholeChapter((w) => !w)}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
                fontSize: 11, color: 'var(--lamplight-accent)',
              }}
            >
              {wholeChapter ? `Verse ${selectedVerse}` : 'Whole chapter'}
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close insights"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, border: 'none', background: 'transparent',
            cursor: 'pointer', color: 'var(--silica)', borderRadius: 6,
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 48px' }}>
          {openDoor
            ? openDoor.render(scope)
            : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {doors.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setOpenDoorId(d.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '14px 16px', borderRadius: 8,
                        border: '1px solid var(--pale-stone)', background: 'transparent',
                        cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                      }}
                    >
                      <span style={{ display: 'block', fontSize: 14, color: 'var(--deep-umber)', fontWeight: 600 }}>
                        {d.label}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--silica)', marginTop: 3 }}>
                        {d.blurb}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
