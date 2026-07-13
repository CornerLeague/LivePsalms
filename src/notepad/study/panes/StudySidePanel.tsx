// src/notepad/study/panes/StudySidePanel.tsx
// Tabbed Study side panel with Notes and Chat tabs. The Notes tab is a folder
// browser rooted at the per-user Study folder; when a note is active it swaps to
// the editor (with a back affordance). The Chat tab hosts Lamplight Study. Tab
// visibility is toggled via CSS display so in-progress drafts survive tab switching.
import { useState } from 'react';
import { ChevronLeft, ChevronsLeft, ChevronsRight, PanelRightClose, Plus } from 'lucide-react';
import { NotepadEditor } from '@/notepad/components/Editor';
import { useNoteCollection } from '@/notepad/context/useNoteCollection';
import { useFolderHierarchy } from '@/notepad/context/useFolderHierarchy';
import { FolderItem } from '@/notepad/sidebar/FolderItem';
import { TreeViewStateProvider } from '@/notepad/sidebar/tree-view-state';
import { buildFolderTreeView } from '@/notepad/sidebar/folder-tree-view';
import { LamplightStudyPanel } from './LamplightStudyPanel';
import { MemorizePanel } from '../memorize/MemorizePanel';

type StudyTab = 'notes' | 'chat' | 'memorize';

export interface StudySidePanelProps {
  book: string;
  chapter: number;
  userId: string | null;
  /** True when the pane is widened over the reader (controlled by StudyWorkspace). */
  expanded?: boolean;
  /** Toggle the widened state. When omitted, the expand control is hidden. */
  onToggleExpand?: () => void;
  /** Collapse the pane to a thin strip. When omitted, the collapse control is hidden. */
  onCollapse?: () => void;
}

const iconBtnStyle: React.CSSProperties = {
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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', padding: 8 }}>
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
            onCreateSubfolder={(parentId, name, icon, color) => { void hierarchy.createFolder(name, parentId, icon, color); }}
          />
        </div>
        {/* Docked quick-add: the common case (note in the Study root). Per-folder
            note creation lives in subfolder context menus; the Study root uses this. */}
        <div style={{ flex: '0 0 auto', padding: 8, borderTop: '1px solid var(--pale-stone)' }}>
          <button
            type="button"
            aria-label="New note"
            onClick={() => { void collection.createNote(study.id, 'general'); }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '9px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--lamplight-accent)',
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'Outfit, sans-serif',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            <Plus className="w-3.5 h-3.5" /> New note
          </button>
        </div>
      </div>
    </TreeViewStateProvider>
  );
}

export function StudySidePanel({ book, chapter, userId, expanded = false, onToggleExpand, onCollapse }: StudySidePanelProps) {
  const [tab, setTab] = useState<StudyTab>('notes');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{ display: 'flex', alignItems: 'stretch', flex: '0 0 auto', borderBottom: '1px solid var(--pale-stone)' }}
      >
        <div role="tablist" aria-label="Study side panel" style={{ display: 'flex', flex: '1 1 0%' }}>
          <button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')} style={tabStyle(tab === 'notes')}>
            Notes
          </button>
          <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')} style={tabStyle(tab === 'chat')}>
            Chat
          </button>
          <button role="tab" aria-selected={tab === 'memorize'} onClick={() => setTab('memorize')} style={tabStyle(tab === 'memorize')}>
            Memorize
          </button>
        </div>
        {(onToggleExpand || onCollapse) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingInline: 6 }}>
            {onToggleExpand && (
              <button
                type="button"
                aria-label={expanded ? 'Shrink panel' : 'Expand panel'}
                title={expanded ? 'Shrink panel' : 'Expand panel'}
                onClick={onToggleExpand}
                style={iconBtnStyle}
              >
                {expanded ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
              </button>
            )}
            {onCollapse && (
              <button
                type="button"
                aria-label="Collapse panel"
                title="Collapse panel"
                onClick={onCollapse}
                style={iconBtnStyle}
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
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
      <div
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          overflow: 'auto',
          display: tab === 'memorize' ? 'block' : 'none',
        }}
      >
        <MemorizePanel book={book} chapter={chapter} userId={userId} active={tab === 'memorize'} />
      </div>
    </div>
  );
}
