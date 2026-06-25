import { useState } from 'react';
import { MoreVertical } from 'lucide-react';
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
import type { Note, Folder } from '../types';
import { NOTE_TYPE_CONFIG } from '../note-type-config';
import { InlineEdit } from './InlineEdit';
import { MoveToFolderDialog } from './MoveToFolderDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDeferredMenuAction } from './useDeferredMenuAction';

interface NoteItemProps {
  note: Note;
  isActive: boolean;
  folders: Folder[];
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (noteId: string, folderId: string) => void;
}

export function NoteItem({
  note,
  isActive,
  folders,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onMove,
}: NoteItemProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isMobile = useIsMobile();
  const menuAction = useDeferredMenuAction();

  const config = NOTE_TYPE_CONFIG[note.type];
  const Icon = config.icon;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="flex items-center gap-1.5 px-1 py-1.5 rounded cursor-pointer transition-colors group"
            style={{
              background: isActive ? 'color-mix(in srgb, var(--warm-sand) 30%, transparent)' : 'transparent',
              fontFamily: 'Outfit, sans-serif',
            }}
            onClick={() => { if (!menuAction.wasJustOpen()) onOpen(note.id); }}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
          >
            {/* Options icon — click to open dropdown */}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <span
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
                <DropdownMenuItem
                  onSelect={() => menuAction.run(() => setRenaming(true))}
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => menuAction.run(() => setMoveOpen(true))}
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                >
                  Move to Folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => menuAction.run(() => onDuplicate(note.id))}
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => menuAction.run(() => setDeleteOpen(true))}
                  className="text-red-600 focus:text-red-600"
                  style={{ fontFamily: 'Outfit, sans-serif' }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Icon className="w-3 h-3 shrink-0" style={{ color: config.color }} />

            <InlineEdit
              value={note.title}
              onSave={(title) => onRename(note.id, title)}
              editing={renaming}
              onEditingChange={setRenaming}
              className="text-[11px] truncate flex-1 min-w-0"
              style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          style={{ fontFamily: 'Outfit, sans-serif' }}
          onCloseAutoFocus={menuAction.onCloseAutoFocus}
        >
          <ContextMenuItem
            onSelect={() => menuAction.run(() => setRenaming(true))}
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => menuAction.run(() => setMoveOpen(true))}
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            Move to Folder
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => menuAction.run(() => onDuplicate(note.id))}
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            Duplicate
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => menuAction.run(() => setDeleteOpen(true))}
            className="text-red-600 focus:text-red-600"
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={{ fontFamily: 'Outfit, sans-serif' }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ fontFamily: 'Outfit, sans-serif' }}>Delete Note</AlertDialogTitle>
            <AlertDialogDescription style={{ fontFamily: 'Outfit, sans-serif' }}>
              Are you sure you want to delete "{note.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel style={{ fontFamily: 'Outfit, sans-serif' }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(note.id)}
              style={{ fontFamily: 'Outfit, sans-serif' }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move dialog */}
      <MoveToFolderDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        noteId={note.id}
        folders={folders}
        onMove={onMove}
      />
    </>
  );
}
