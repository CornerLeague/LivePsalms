// src/notepad/sidebar/NewSubfolderDialog.tsx
// A focused, on-brand dialog for creating a subfolder inside a known parent.
// Replaces the bare window.prompt() that FolderItem previously used. Mirrors
// NewFolderDialog's visual language (preview + name + icon + color) but drops
// the Location selector since the parent is fixed by where it was opened from.
import { useState } from 'react';
import { BookOpen, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FOLDER_ICONS, FOLDER_COLORS } from '../components/NewFolderDialog';
import type { FolderIcon } from '../types';

export interface NewSubfolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name of the folder the new subfolder will live inside (for context copy). */
  parentName: string;
  onCreate: (name: string, icon: FolderIcon, color: string) => void;
}

export function NewSubfolderDialog({ open, onOpenChange, parentName, onCreate }: NewSubfolderDialogProps) {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<FolderIcon>('book');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0].value);

  const reset = () => {
    setName('');
    setSelectedIcon('book');
    setSelectedColor(FOLDER_COLORS[0].value);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), selectedIcon, selectedColor);
    reset();
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const SelectedIconComponent = FOLDER_ICONS.find((i) => i.key === selectedIcon)?.icon ?? BookOpen;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, fontSize: '1.25rem' }}>
            New Subfolder
          </DialogTitle>
          <DialogDescription style={{ fontFamily: 'Outfit, sans-serif', fontSize: 12, color: 'var(--silica)' }}>
            Inside <span style={{ color: 'var(--deep-umber)', fontWeight: 500 }}>{parentName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Preview */}
          <div className="flex items-center justify-center gap-3 py-4">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-lg"
              style={{ background: `${selectedColor}20`, border: `1.5px solid ${selectedColor}` }}
            >
              <SelectedIconComponent className="w-5 h-5" style={{ color: selectedColor }} />
            </div>
            <span
              className="text-[14px] font-medium"
              style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
            >
              {name || 'Subfolder name'}
            </span>
          </div>

          {/* Name */}
          <div>
            <label
              className="text-[11px] font-medium tracking-wider block mb-1.5"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              NAME
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              autoFocus
              placeholder="e.g. Word studies, Questions..."
              className="w-full px-3 py-2 rounded-md text-[13px] bg-transparent outline-none"
              style={{
                border: '1px solid var(--pale-stone)',
                color: 'var(--deep-umber)',
                fontFamily: 'Outfit, sans-serif',
              }}
            />
          </div>

          {/* Icon picker */}
          <div>
            <label
              className="text-[11px] font-medium tracking-wider block mb-2"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              ICON
            </label>
            <div className="grid grid-cols-6 gap-1.5">
              {FOLDER_ICONS.map(({ key, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedIcon(key)}
                  className="flex items-center justify-center w-9 h-9 rounded-md transition-all"
                  style={{
                    background: selectedIcon === key ? `${selectedColor}20` : 'transparent',
                    border: selectedIcon === key ? `1.5px solid ${selectedColor}` : '1px solid var(--pale-stone)',
                  }}
                  title={key}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: selectedIcon === key ? selectedColor : 'var(--silica)' }}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label
              className="text-[11px] font-medium tracking-wider block mb-2"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              COLOR
            </label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSelectedColor(value)}
                  className="relative w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: value,
                    boxShadow: selectedColor === value ? `0 0 0 2px var(--plaster), 0 0 0 3.5px ${value}` : 'none',
                  }}
                  title={label}
                >
                  {selectedColor === value && (
                    <Check className="w-3.5 h-3.5 absolute inset-0 m-auto text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="px-4 py-2 text-[12px] font-medium rounded-md hover:bg-black/5 transition-colors"
            style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-2 text-[12px] font-medium rounded-md transition-opacity disabled:opacity-40"
            style={{ background: 'var(--deep-umber)', color: 'var(--plaster)', fontFamily: 'Outfit, sans-serif' }}
          >
            Create Subfolder
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
