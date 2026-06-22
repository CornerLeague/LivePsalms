import { useMemo, useState } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  FolderPlus,
} from 'lucide-react';
import { useNoteCollection } from '../context/useNoteCollection';
import { useFolderHierarchy } from '../context/useFolderHierarchy';
import { useNotepadActions } from '../context/useNotepadActions';
import { NewFolderDialog } from './NewFolderDialog';
import {
  buildFolderTreeView,
  NOTE_TYPE_ORDER,
} from '../sidebar/folder-tree-view';
import { NOTE_TYPE_CONFIG } from '../note-type-config';
import { NoteItem } from '../sidebar/NoteItem';
import { FolderItem } from '../sidebar/FolderItem';
import {
  TreeViewStateProvider,
  useTreeViewState,
} from '../sidebar/tree-view-state';
import { formatTag } from '../utils/tags';

type NotepadSidebarProps = {
  hideCollectionHeader?: boolean;
  onOpenNote?: (id: string) => void;
};

export function NotepadSidebar(props: NotepadSidebarProps = {}) {
  return (
    <TreeViewStateProvider>
      <NotepadSidebarInner {...props} />
    </TreeViewStateProvider>
  );
}

function NotepadSidebarInner({ hideCollectionHeader = false, onOpenNote }: NotepadSidebarProps) {
  const { notes, activeNoteId, collection } = useNoteCollection();
  const { folders, hierarchy } = useFolderHierarchy();
  const actions = useNotepadActions();
  const treeView = useTreeViewState();

  const { createNote, moveNote, renameNote, duplicateNote } = collection;
  const openNote = onOpenNote ?? collection.openNote;
  const { createFolder, renameFolder } = hierarchy;
  const { deleteNote, deleteFolder } = actions;

  const [filterText, setFilterText] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);

  const tagsExpanded = treeView.isExpanded('tags', false);

  const view = useMemo(
    () => buildFolderTreeView(notes, folders, filterText, tagFilter),
    [notes, folders, filterText, tagFilter],
  );

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ fontFamily: 'Outfit, sans-serif' }}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-0">
        {/* Collection Header */}
        {!hideCollectionHeader && (
          <h3
            className="text-[10px] font-medium tracking-[0.2em] mb-3"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            COLLECTION
          </h3>
        )}

        {/* Active tag filter indicator */}
        {tagFilter && (
          <div
            className="flex items-center justify-between px-2 py-1 rounded mb-2"
            style={{ background: 'color-mix(in srgb, var(--warm-sand) 20%, transparent)', border: '1px solid var(--pale-stone)' }}
          >
            <span className="text-[11px]" style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
              {formatTag(tagFilter)}
            </span>
            <button
              onClick={() => setTagFilter(null)}
              className="text-[10px] hover:opacity-70 transition-opacity"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              clear
            </button>
          </div>
        )}

        {/* Filter input */}
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-4"
          style={{
            background: 'color-mix(in srgb, var(--warm-sand) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--pale-stone) 50%, transparent)',
          }}
        >
          <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--silica)' }} />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter notes..."
            className="text-[11px] bg-transparent outline-none w-full"
            style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
          />
        </div>

        {/* Note and folder tree */}
        <div className="space-y-1">
          {/* Root notes grouped by type */}
          {NOTE_TYPE_ORDER.map((type) => {
            const group = view.rootNotesByType.get(type);
            if (!group || group.length === 0) return null;
            const config = NOTE_TYPE_CONFIG[type];
            const TypeIcon = config.icon;
            const isExpanded = treeView.isExpanded(`type:${type}`, true);
            return (
              <div key={type} className="mb-1">
                <button
                  className="flex items-center gap-1.5 w-full px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  onClick={() => treeView.toggle(`type:${type}`, true)}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--silica)' }} />
                  ) : (
                    <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--silica)' }} />
                  )}
                  <TypeIcon className="w-3 h-3 shrink-0" style={{ color: config.color }} />
                  <span
                    className="text-[10px] font-medium tracking-[0.15em]"
                    style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
                  >
                    {config.label.toUpperCase()}
                  </span>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                    {group.length}
                  </span>
                </button>
                {isExpanded && (
                  <div className="ml-2">
                    {group.map((note) => (
                      <NoteItem
                        key={note.id}
                        note={note}
                        isActive={note.id === activeNoteId}
                        folders={folders}
                        onOpen={openNote}
                        onRename={(id, title) => renameNote(id, title)}
                        onDuplicate={(id) => duplicateNote(id)}
                        onDelete={(id) => deleteNote(id)}
                        onMove={(noteId, fId) => moveNote(noteId, fId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Root folders */}
          {view.rootFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              notes={view.notesByFolder.get(folder.id) ?? []}
              childFolders={view.childFoldersByParent.get(folder.id) ?? []}
              notesByFolder={view.notesByFolder}
              childFoldersByParent={view.childFoldersByParent}
              allFolders={folders}
              activeNoteId={activeNoteId}
              onOpen={openNote}
              onCreateNote={(fId, type) => createNote(fId, type)}
              onRenameNote={(id, title) => renameNote(id, title)}
              onDuplicateNote={(id) => duplicateNote(id)}
              onDeleteNote={(id) => deleteNote(id)}
              onMoveNote={(noteId, fId) => moveNote(noteId, fId)}
              onRenameFolder={(id, name) => renameFolder(id, name)}
              onDeleteFolder={(id) => deleteFolder(id)}
              onCreateSubfolder={(parentId, name, icon, color) => createFolder(name, parentId, icon, color)}
            />
          ))}
        </div>

        {/* + New Folder button */}
        <button
          onClick={() => setShowNewFolder(true)}
          className="flex items-center gap-1.5 mt-4 px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors w-full"
          style={{ fontFamily: 'Outfit, sans-serif' }}
        >
          <FolderPlus className="w-3.5 h-3.5" style={{ color: 'var(--silica)' }} />
          <span className="text-[11px]" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            + New Folder
          </span>
        </button>

        <NewFolderDialog open={showNewFolder} onOpenChange={setShowNewFolder} />

        {/* Tags section */}
        {view.allTags.length > 0 && (
          <div className="mt-6 pt-4" style={{ borderTop: '1px solid color-mix(in srgb, var(--pale-stone) 50%, transparent)' }}>
            <button
              className="flex items-center gap-1 w-full cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 rounded px-1 py-0.5 transition-colors"
              onClick={() => treeView.toggle('tags', false)}
            >
              {tagsExpanded ? (
                <ChevronDown className="w-3 h-3" style={{ color: 'var(--silica)' }} />
              ) : (
                <ChevronRight className="w-3 h-3" style={{ color: 'var(--silica)' }} />
              )}
              <h3
                className="text-[10px] font-medium tracking-[0.2em]"
                style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
              >
                TAGS
              </h3>
              <span className="text-[10px] ml-1" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                ({view.allTags.length})
              </span>
            </button>
            {tagsExpanded && (
              <div className="space-y-1.5 mt-2">
                {view.allTags.map(([tag, count]) => {
                  const isActive = tagFilter === tag;
                  return (
                    <div
                      key={tag}
                      className="flex items-center justify-between px-2 py-1 rounded cursor-pointer hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                      style={{
                        background: isActive ? 'color-mix(in srgb, var(--warm-sand) 30%, transparent)' : 'transparent',
                        fontFamily: 'Outfit, sans-serif',
                      }}
                      onClick={() => setTagFilter(isActive ? null : tag)}
                    >
                      <span
                        className="text-[11px]"
                        style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                      >
                        {formatTag(tag)}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--silica)' }}>
                        ({count})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
