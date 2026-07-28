import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Folder } from '../types';

interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  folders: Folder[];
  onMove: (noteId: string, folderId: string) => void;
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  noteId,
  folders,
  onMove,
}: MoveToFolderDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>('root');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ fontFamily: 'Outfit, sans-serif' }}>
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}>
            Move to Folder
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
            <SelectTrigger style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--deep-umber)' }}>
              <SelectValue placeholder="Select folder" />
            </SelectTrigger>
            <SelectContent>
              {/* `root` is the stored folderId for an unfiled note; "Main" is
                  how we say that to the user. */}
              <SelectItem value="root">Main</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 rounded text-[12px]"
            style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onMove(noteId, selectedFolderId);
              onOpenChange(false);
            }}
            className="px-3 py-1.5 rounded text-[12px] font-medium"
            style={{ background: 'var(--deep-umber)', color: 'var(--plaster)', fontFamily: 'Outfit, sans-serif' }}
          >
            Move
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
