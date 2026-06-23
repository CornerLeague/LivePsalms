// src/notepad/study/mobile/MobileStudyWorkspace.tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useEnsureStudyFolder } from '../useEnsureStudyFolder';
import { StudyReader } from '../panes/StudyReader';
import { StudySidePanel } from '../panes/StudySidePanel';
import { ApparatusRail } from '../panes/ApparatusRail';
import { StudyModeToggle } from '../StudyModeToggle';
import { StudyTabBar } from './StudyTabBar';
import { MobileStudyEditorView } from './MobileStudyEditorView';
import type { MobileStudyTab } from './types';
import { loadEnum, saveEnum, KEY_MOBILE_STUDY_TAB } from '@/notepad/session/session-storage';
import '../study-theme.css';

export function MobileStudyWorkspace() {
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const { activeNote, collection } = useNoteCollection();
  useEnsureStudyFolder();

  const [tab, setTab] = useState<MobileStudyTab>(() =>
    loadEnum<MobileStudyTab>(KEY_MOBILE_STUDY_TAB, ['reader', 'study', 'context'], 'reader'),
  );
  const [passage, setPassage] = useState<{ book: string; chapter: number }>({ book: 'jhn', chapter: 1 });

  useEffect(() => {
    saveEnum(KEY_MOBILE_STUDY_TAB, tab);
  }, [tab]);

  // Stable + guarded so BibleReader's passage effect can't loop (see DesktopStudyWorkspace).
  const handlePassageChange = useCallback((ref: { book: string; chapter: number }) => {
    setPassage((prev) =>
      prev.book === ref.book && prev.chapter === ref.chapter ? prev : { book: ref.book, chapter: ref.chapter },
    );
  }, []);

  // A note being active means the user opened it from the Notes segment: take over
  // full-screen (chosen "full-focus editor" behavior), hiding the toggle + tab bar.
  const editing = !!activeNote;

  return (
    <div
      data-mode="study"
      className="study-workspace fixed inset-x-0 top-0 flex flex-col"
      style={{ height: '100dvh', overflow: 'hidden', background: 'var(--cream, #F4F1EA)' }}
    >
      {!editing && (
        <header
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderBottom: '1px solid var(--pale-stone)',
          }}
        >
          <img
            src="/logo-icon.png"
            alt="LivePsalms"
            className="notepad-nav-logo h-6 w-auto object-contain cursor-pointer"
            onClick={() => navigate('/')}
          />
          <StudyModeToggle />
        </header>
      )}

      <div className="flex-1 min-h-0 relative">
        {editing ? (
          <MobileStudyEditorView onBack={() => collection.openNote(null)} />
        ) : (
          <>
            {/* Panes stay mounted (display toggle) so reader scroll + chat draft survive tab switches. */}
            <div style={{ height: '100%', display: tab === 'reader' ? 'block' : 'none', overflow: 'auto' }}>
              <StudyReader book={passage.book} chapter={passage.chapter} onPassageChange={handlePassageChange} />
            </div>
            <div style={{ height: '100%', display: tab === 'study' ? 'block' : 'none' }}>
              <StudySidePanel book={passage.book} chapter={passage.chapter} userId={userId} />
            </div>
            <div style={{ height: '100%', display: tab === 'context' ? 'block' : 'none', overflow: 'auto' }}>
              <ApparatusRail book={passage.book} chapter={passage.chapter} />
            </div>
          </>
        )}
      </div>

      {!editing && <StudyTabBar active={tab} onSelect={setTab} />}
    </div>
  );
}
