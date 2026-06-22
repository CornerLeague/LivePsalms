// src/notepad/study/StudyWorkspace.tsx
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { ApparatusRail } from './panes/ApparatusRail';
import { StudyReader } from './panes/StudyReader';
import { StudySidePanel } from './panes/StudySidePanel';
import { StudyModeToggle } from './StudyModeToggle';
import { NotepadAuthControls } from '@/notepad/components/NotepadAuthControls';
import { ThemeToggle } from '@/notepad/theme/ThemeToggle';
import { useEnsureStudyFolder } from './useEnsureStudyFolder';
import './study-theme.css';

type SidePanelMode = 'collapsed' | 'normal' | 'expanded';

const railBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--silica)',
  borderRadius: 6,
};

export function StudyWorkspace() {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  useEnsureStudyFolder();
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [sideMode, setSideMode] = useState<SidePanelMode>('normal');

  // BibleReader reports its passage from an effect keyed on this callback. A fresh
  // identity (or a fresh object on every update) would re-trigger that effect
  // endlessly, so keep the callback stable AND bail when nothing actually changed.
  const handlePassageChange = useCallback((ref: { book: string; chapter: number }) => {
    setPassage((prev) =>
      prev.book === ref.book && prev.chapter === ref.chapter ? prev : { book: ref.book, chapter: ref.chapter },
    );
  }, []);

  return (
    <div
      data-mode="study"
      className="study-workspace"
      style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', background: 'var(--cream, #F4F1EA)' }}
    >
      <header
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--pale-stone)',
          gap: 10,
        }}
      >
        {/* Logo — matches the journal toolbar's top-left mark */}
        <img
          src="/logo-icon.png"
          alt="LivePsalms"
          className="h-6 w-auto object-contain cursor-pointer"
          onClick={() => navigate('/')}
        />
        <StudyModeToggle />
        {/* Push auth controls to the far right, same spot as the journal toolbar */}
        <div style={{ flex: 1 }} />
        <ThemeToggle className="w-8 h-8" />
        <NotepadAuthControls />
      </header>
      <div style={{ flex: '1 1 0%', minHeight: 0, display: 'flex' }}>
        {/* Left: book context — collapses to a thin reopen strip */}
        {contextCollapsed ? (
          <aside
            style={{
              flex: '0 0 40px',
              borderRight: '1px solid var(--pale-stone)',
              display: 'flex',
              justifyContent: 'center',
              paddingTop: 8,
            }}
          >
            <button
              type="button"
              aria-label="Expand context"
              title="Expand context"
              onClick={() => setContextCollapsed(false)}
              style={railBtnStyle}
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </aside>
        ) : (
          <aside
            style={{
              flex: '0 0 280px',
              borderRight: '1px solid var(--pale-stone)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', padding: '6px 8px' }}>
              <button
                type="button"
                aria-label="Collapse context"
                title="Collapse context"
                onClick={() => setContextCollapsed(true)}
                style={railBtnStyle}
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
            <div style={{ flex: '1 1 0%', overflow: 'auto' }}>
              <ApparatusRail book={passage.book} chapter={passage.chapter} />
            </div>
          </aside>
        )}

        {/* Center: reader — hidden while the side panel is expanded over it */}
        <main
          style={{
            flex: sideMode === 'expanded' ? '0 0 0' : '1 1 0%',
            overflow: 'auto',
            display: sideMode === 'expanded' ? 'none' : 'block',
          }}
        >
          <StudyReader book={passage.book} chapter={passage.chapter} onPassageChange={handlePassageChange} />
        </main>

        {/* Right: notes / chat — collapses to a strip, or expands over the reader */}
        {sideMode === 'collapsed' ? (
          <aside
            style={{
              flex: '0 0 40px',
              borderLeft: '1px solid var(--pale-stone)',
              display: 'flex',
              justifyContent: 'center',
              paddingTop: 8,
            }}
          >
            <button
              type="button"
              aria-label="Expand notes panel"
              title="Expand notes panel"
              onClick={() => setSideMode('normal')}
              style={railBtnStyle}
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          </aside>
        ) : (
          <aside
            style={{
              flex: sideMode === 'expanded' ? '1 1 0%' : '0 0 360px',
              borderLeft: '1px solid var(--pale-stone)',
              overflow: 'hidden',
            }}
          >
            <StudySidePanel
              book={passage.book}
              chapter={passage.chapter}
              userId={userId}
              expanded={sideMode === 'expanded'}
              onToggleExpand={() => setSideMode((m) => (m === 'expanded' ? 'normal' : 'expanded'))}
              onCollapse={() => setSideMode('collapsed')}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
