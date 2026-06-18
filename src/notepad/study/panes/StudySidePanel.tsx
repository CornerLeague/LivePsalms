// src/notepad/study/panes/StudySidePanel.tsx
// Tabbed Study side panel with Notes and Chat tabs. The Notes tab is a folder
// browser rooted at the per-user Study folder; when a note is active it swaps to
// the editor (with a back affordance). The Chat tab hosts Lamplight Study. Tab
// visibility is toggled via CSS display so in-progress drafts survive tab switching.
import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { NotepadEditor } from '@/notepad/components/Editor';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useFolderHierarchy } from '@/notepad/context/useFolderHierarchy';
import { FolderItem } from '@/notepad/sidebar/FolderItem';
import { TreeViewStateProvider } from '@/notepad/sidebar/tree-view-state';
import { buildFolderTreeView } from '@/notepad/sidebar/folder-tree-view';
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

// The Notes tab is a folder browser rooted at the per-user Study folder. With a
// note open it swaps to the editor (with a back affordance); otherwise it shows
// the Study folder's expand/collapse tree plus create actions.
export function StudyNotesTab() {
  const { notes, activeNote, collection } = useNoteCollection();
  const { folders, studyFolderId, hierarchy } = useFolderHierarchy();

  if (activeNote) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <button
          onClick={() => collection.openNote(null)}
          aria-label="Back to Study notes"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '8px 12px',
            border: 'none',
            borderBottom: '1px solid var(--pale-stone)',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--deep-umber)',
            fontFamily: 'Outfit, sans-serif',
            fontSize: 12,
          }}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Study notes
        </button>
        <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto' }}>
          <NotepadEditor />
        </div>
      </div>
    );
  }

  const study = studyFolderId ? folders.find((f) => f.id === studyFolderId) : null;
  if (!study) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          color: 'var(--silica)',
          fontFamily: 'Outfit, sans-serif',
          fontSize: 13,
        }}
      >
        Setting up your Study folder…
      </div>
    );
  }

  const view = buildFolderTreeView(notes, folders, '', null);

  return (
    <TreeViewStateProvider>
      <div style={{ padding: 8 }}>
        <FolderItem
          folder={study}
          isSystem
          notes={view.notesByFolder.get(study.id) ?? []}
          childFolders={view.childFoldersByParent.get(study.id) ?? []}
          notesByFolder={view.notesByFolder}
          childFoldersByParent={view.childFoldersByParent}
          allFolders={folders}
          activeNoteId={null}
          onOpen={(id) => collection.openNote(id)}
          onCreateNote={(folderId, type) => { void collection.createNote(folderId, type); }}
          onRenameNote={(id, title) => { void collection.renameNote(id, title); }}
          onDuplicateNote={(id) => { void collection.duplicateNote(id); }}
          onDeleteNote={(id) => { void collection.deleteNote(id); }}
          onMoveNote={(noteId, folderId) => { void collection.moveNote(noteId, folderId); }}
          onRenameFolder={(id, name) => { void hierarchy.renameFolder(id, name); }}
          onDeleteFolder={(id) => { void hierarchy.deleteFolder(id); }}
          onCreateSubfolder={(parentId, name) => { void hierarchy.createFolder(name, parentId); }}
        />
      </div>
    </TreeViewStateProvider>
  );
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
