// src/notepad/study/StudyWorkspace.tsx
import { useState } from 'react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { ApparatusRail } from './panes/ApparatusRail';
import { StudyReader } from './panes/StudyReader';
import { LamplightStudyPanel } from './panes/LamplightStudyPanel';
import './study-theme.css';

export function StudyWorkspace() {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });

  return (
    <div data-mode="study" className="study-workspace" style={{ display: 'flex', height: '100%', background: 'var(--cream, #F4F1EA)' }}>
      <aside style={{ flex: '0 0 280px', borderRight: '1px solid var(--pale-stone)', overflow: 'auto' }}>
        <ApparatusRail book={passage.book} chapter={passage.chapter} />
      </aside>
      <main style={{ flex: '1 1 0%', overflow: 'auto' }}>
        <StudyReader
          book={passage.book}
          chapter={passage.chapter}
          onPassageChange={(ref) => setPassage({ book: ref.book, chapter: ref.chapter })}
        />
      </main>
      <aside style={{ flex: '0 0 360px', borderLeft: '1px solid var(--pale-stone)', overflow: 'auto' }}>
        <LamplightStudyPanel book={passage.book} chapter={passage.chapter} userId={userId} />
      </aside>
    </div>
  );
}
