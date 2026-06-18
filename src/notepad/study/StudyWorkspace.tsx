// src/notepad/study/StudyWorkspace.tsx
import { useCallback, useState } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { ApparatusRail } from './panes/ApparatusRail';
import { StudyReader } from './panes/StudyReader';
import { StudySidePanel } from './panes/StudySidePanel';
import { StudyModeToggle } from './StudyModeToggle';
import './study-theme.css';

export function StudyWorkspace() {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });

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
        }}
      >
        <StudyModeToggle />
      </header>
      <div style={{ flex: '1 1 0%', minHeight: 0, display: 'flex' }}>
        <aside style={{ flex: '0 0 280px', borderRight: '1px solid var(--pale-stone)', overflow: 'auto' }}>
          <ApparatusRail book={passage.book} chapter={passage.chapter} />
        </aside>
        <main style={{ flex: '1 1 0%', overflow: 'auto' }}>
          <StudyReader book={passage.book} chapter={passage.chapter} onPassageChange={handlePassageChange} />
        </main>
        <aside style={{ flex: '0 0 360px', borderLeft: '1px solid var(--pale-stone)', overflow: 'hidden' }}>
          <StudySidePanel book={passage.book} chapter={passage.chapter} userId={userId} />
        </aside>
      </div>
    </div>
  );
}
