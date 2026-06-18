// src/notepad/study/panes/StudySidePanel.tsx
// Tabbed Study side panel: Notes (the journaling editor on the active note) and
// Chat (Lamplight Study). Both tabs stay mounted (visibility toggled) so an
// in-progress note edit or chat draft survives switching between them.
import { useState } from 'react';
import { NotepadEditor } from '@/notepad/components/Editor';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { LamplightStudyPanel } from './LamplightStudyPanel';

type StudyTab = 'notes' | 'chat';

export interface StudySidePanelProps {
  book: string;
  chapter: number;
  userId: string | null;
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '10px 0',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontFamily: 'Outfit, sans-serif',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: active ? 'var(--deep-umber)' : 'var(--silica)',
    boxShadow: active ? 'inset 0 -2px 0 var(--lamplight-accent)' : 'none',
  };
}

// The Notes tab reuses the journaling editor (it reads the active note from the
// hoisted NotepadProvider). With no note open there is nothing to edit yet, so
// offer a way to start one.
function StudyNotesTab() {
  const { activeNote, collection } = useNoteCollection();
  if (!activeNote) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          textAlign: 'center',
          fontFamily: 'Outfit, sans-serif',
        }}
      >
        <div style={{ color: 'var(--silica)', fontSize: 13 }}>No note open — start one to jot as you study.</div>
        <button
          onClick={() => {
            void collection.createNote('root', 'general');
          }}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--lamplight-accent)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          New note
        </button>
      </div>
    );
  }
  return <NotepadEditor />;
}

export function StudySidePanel({ book, chapter, userId }: StudySidePanelProps) {
  const [tab, setTab] = useState<StudyTab>('notes');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        role="tablist"
        aria-label="Study side panel"
        style={{ display: 'flex', flex: '0 0 auto', borderBottom: '1px solid var(--pale-stone)' }}
      >
        <button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')} style={tabStyle(tab === 'notes')}>
          Notes
        </button>
        <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')} style={tabStyle(tab === 'chat')}>
          Chat
        </button>
      </div>
      <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', display: tab === 'notes' ? 'block' : 'none' }}>
        <StudyNotesTab />
      </div>
      <div
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          display: tab === 'chat' ? 'flex' : 'none',
          flexDirection: 'column',
        }}
      >
        <LamplightStudyPanel book={book} chapter={chapter} userId={userId} />
      </div>
    </div>
  );
}
