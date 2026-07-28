import { useState } from 'react';
import { ChevronDown, ChevronRight, MoreVertical, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FOLDER_ICONS } from '../components/NewFolderDialog';
import { DEFAULT_NEW_NOTE_TYPE } from '../collection/new-note-target';
import type { Note, Folder, NoteType, FolderIcon } from '../types';
import { NoteItem } from './NoteItem';
import { NewSubfolderDialog } from './NewSubfolderDialog';
import { InlineEdit } from './InlineEdit';
import { useTreeViewState } from './tree-view-state';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDeferredMenuAction } from './useDeferredMenuAction';

export interface FolderItemProps {
  folder: Folder;
  /**
   * When true (the system Study root), hide Rename + Delete and the inline
   * "New Note Inside" action — a docked accent button in the Study pane
   * replaces note creation at the root. Subfolders keep the full menu.
   */
  isSystem?: boolean;
  /** Notes whose `folderId` matches this folder, already filtered. */
  notes: Note[];
  /** Direct child folders, already sorted by `order`. */
  childFolders: Folder[];
  /** Lookups passed through for recursive descent. */
  notesByFolder: Map<string, Note[]>;
  childFoldersByParent: Map<string, Folder[]>;
  /** All folders flat — used by `NoteItem`'s MoveToFolderDialog options. */
  allFolders: Folder[];
  activeNoteId: string | null;
  onOpen: (id: string) => void;
  onCreateNote: (folderId: string, type: NoteType) => void;
  onRenameNote: (id: string, title: string) => void;
  onDuplicateNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onCreateSubfolder: (parentId: string, name: string, icon?: FolderIcon, color?: string) => void;
}

export function FolderItem(props: FolderItemProps) {
  const {
    folder,
    isSystem = false,
    notes,
    childFolders,
    notesByFolder,
    childFoldersByParent,
    allFolders,
    activeNoteId,
    onOpen,
    onCreateNote,
    onRenameNote,
    onDuplicateNote,
    onDeleteNote,
    onMoveNote,
    onRenameFolder,
    onDeleteFolder,
    onCreateSubfolder,
  } = props;

  const treeView = useTreeViewState();
  const open = treeView.isExpanded(`folder:${folder.id}`, true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newSubfolderOpen, setNewSubfolderOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isMobile = useIsMobile();
  const menuAction = useDeferredMenuAction();

  // Create a note directly in this folder — no category prompt. Expands the
  // folder first so the freshly created note is visible.
  const handleCreateNoteInFolder = () => {
    if (!open) treeView.toggle(`folder:${folder.id}`, true);
    onCreateNote(folder.id, DEFAULT_NEW_NOTE_TYPE);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            {/* Folder header */}
            <div
              className="flex items-center gap-1.5 w-full px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
            >
              {/* Expand/collapse chevron */}
              <button
                onClick={() => treeView.toggle(`folder:${folder.id}`, true)}
                className="shrink-0 flex items-center"
                aria-label={open ? 'Collapse folder' : 'Expand folder'}
              >
                {open ? (
                  <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--silica)' }} />
                ) : (
                  <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--silica)' }} />
                )}
              </button>

              {/* Options icon — click to open dropdown (between arrow and icon) */}
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <span
                    role="button"
                    aria-label="Folder options"
                    className="shrink-0 cursor-pointer rounded hover:bg-black/10 dark:hover:bg-white/15 transition-all"
                    style={{
                      opacity: hovering || menuOpen || isMobile ? 1 : 0,
                      transition: 'opacity 0.15s',
                      color: 'var(--silica)',
                      padding: '1px',
                    }}
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
                  >
                    <MoreVertical className="w-3 h-3" />
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                  onCloseAutoFocus={menuAction.onCloseAutoFocus}
                >
                  {!isSystem && (
                    <DropdownMenuItem
                      onSelect={() => menuAction.run(() => setRenaming(true))}
                      style={{ fontFamily: 'Outfit, sans-serif' }}
                    >
                      Rename
                    </DropdownMenuItem>
                  )}
                  {!isSystem && (
                    <DropdownMenuItem
                      onSelect={() => menuAction.run(() => handleCreateNoteInFolder())}
                      style={{ fontFamily: 'Outfit, sans-serif' }}
                    >
                      New Note Inside
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => menuAction.run(() => setNewSubfolderOpen(true))}
                    style={{ fontFamily: 'Outfit, sans-serif' }}
                  >
                    New Subfolder
                  </DropdownMenuItem>
                  {!isSystem && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => menuAction.run(() => setDeleteOpen(true))}
                        className="text-red-600 focus:text-red-600"
                        style={{ fontFamily: 'Outfit, sans-serif' }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Folder icon + name (toggles too; name is inline-editable) */}
              <div
                onClick={() => { if (!renaming && !menuAction.wasJustOpen()) treeView.toggle(`folder:${folder.id}`, true); }}
                className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                style={{ fontFamily: 'Outfit, sans-serif' }}
              >
                {(() => {
                  const iconEntry = FOLDER_ICONS.find((i) => i.key === folder.icon);
                  if (iconEntry) {
                    const FIcon = iconEntry.icon;
                    return <FIcon className="w-3.5 h-3.5 shrink-0" style={{ color: folder.color || 'var(--silica)' }} />;
                  }
                  return null;
                })()}
                <InlineEdit
                  value={folder.name}
                  onSave={(name) => onRenameFolder(folder.id, name)}
                  editing={renaming}
                  onEditingChange={setRenaming}
                  className="text-[12px] font-medium truncate text-left flex-1 min-w-0"
                  style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
                />
              </div>

              {/* Quick add — new note straight into this folder, no category
                  prompt. Hidden on the system Study root, which hides inline note
                  creation in favor of a docked button in the Study pane. */}
              {!isSystem && (
                <button
                  type="button"
                  aria-label={`New note in ${folder.name}`}
                  title="New note in this folder"
                  className="shrink-0 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/15 transition-all"
                  style={{
                    opacity: hovering || isMobile ? 1 : 0,
                    transition: 'opacity 0.15s',
                    color: 'var(--silica)',
                    padding: '1px',
                  }}
                  onClick={(e) => { e.stopPropagation(); handleCreateNoteInFolder(); }}
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Children */}
            {open && (
              <div className="ml-3 mt-0.5 space-y-0.5">
                {notes.map((note) => (
                  <NoteItem
                    key={note.id}
                    note={note}
                    isActive={note.id === activeNoteId}
                    folders={allFolders}
                    onOpen={onOpen}
                    onRename={onRenameNote}
                    onDuplicate={onDuplicateNote}
                    onDelete={onDeleteNote}
                    onMove={onMoveNote}
                  />
                ))}

                {/* Child folders (recursion) */}
                {childFolders.map((child) => (
                  <FolderItem
                    key={child.id}
                    folder={child}
                    notes={notesByFolder.get(child.id) ?? []}
                    childFolders={childFoldersByParent.get(child.id) ?? []}
                    notesByFolder={notesByFolder}
                    childFoldersByParent={childFoldersByParent}
                    allFolders={allFolders}
                    activeNoteId={activeNoteId}
                    onOpen={onOpen}
                    onCreateNote={onCreateNote}
                    onRenameNote={onRenameNote}
                    onDuplicateNote={onDuplicateNote}
                    onDeleteNote={onDeleteNote}
                    onMoveNote={onMoveNote}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onCreateSubfolder={onCreateSubfolder}
                  />
                ))}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          style={{ fontFamily: 'Outfit, sans-serif' }}
          onCloseAutoFocus={menuAction.onCloseAutoFocus}
        >
          {!isSystem && (
            <ContextMenuItem
              onSelect={() => menuAction.run(() => setRenaming(true))}
              style={{ fontFamily: 'Outfit, sans-serif' }}
            >
              Rename
            </ContextMenuItem>
          )}
          {!isSystem && (
            <ContextMenuItem
              onSelect={() => menuAction.run(() => handleCreateNoteInFolder())}
              style={{ fontFamily: 'Outfit, sans-serif' }}
            >
              New Note Inside
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() => menuAction.run(() => setNewSubfolderOpen(true))}
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            New Subfolder
          </ContextMenuItem>
          {!isSystem && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => menuAction.run(() => setDeleteOpen(true))}
                className="text-red-600 focus:text-red-600"
                style={{ fontFamily: 'Outfit, sans-serif' }}
              >
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete folder confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={{ fontFamily: 'Outfit, sans-serif' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription style={{ fontFamily: 'Outfit, sans-serif' }}>
              Are you sure you want to delete "{folder.name}"? Notes inside will be moved to root.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={{ fontFamily: 'Outfit, sans-serif' }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDeleteFolder(folder.id)}
              style={{ fontFamily: 'Outfit, sans-serif' }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Subfolder dialog */}
      <NewSubfolderDialog
        open={newSubfolderOpen}
        onOpenChange={setNewSubfolderOpen}
        parentName={folder.name}
        onCreate={(name, icon, color) => onCreateSubfolder(folder.id, name, icon, color)}
      />
    </>
  );
}
