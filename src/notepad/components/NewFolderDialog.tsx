import { useState } from 'react';
import {
  Heart,
  Star,
  Cross,
  Flame,
  Bird,
  Crown,
  BookOpen,
  Music,
  Sun,
  Shield,
  Lamp,
  Wheat,
  Check,
} from 'lucide-react';
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
import { useFolderHierarchy } from '../context/useFolderHierarchy';
import type { FolderIcon } from '../types';

const FOLDER_ICONS: { key: FolderIcon; icon: typeof Heart; label: string }[] = [
  { key: 'heart', icon: Heart, label: 'Heart' },
  { key: 'star', icon: Star, label: 'Star' },
  { key: 'cross', icon: Cross, label: 'Cross' },
  { key: 'flame', icon: Flame, label: 'Flame' },
  { key: 'dove', icon: Bird, label: 'Dove' },
  { key: 'crown', icon: Crown, label: 'Crown' },
  { key: 'book', icon: BookOpen, label: 'Book' },
  { key: 'music', icon: Music, label: 'Music' },
  { key: 'sun', icon: Sun, label: 'Sun' },
  { key: 'shield', icon: Shield, label: 'Shield' },
  { key: 'lamp', icon: Lamp, label: 'Lamp' },
  { key: 'wheat', icon: Wheat, label: 'Wheat' },
];

const FOLDER_COLORS = [
  { value: '#C49A78', label: 'Terracotta' },
  { value: '#6B8B7A', label: 'Sage' },
  { value: '#D4A0A0', label: 'Dusty Rose' },
  { value: '#8B7355', label: 'Umber' },
  { value: '#B8A590', label: 'Sand' },
  { value: '#7A9BAE', label: 'Steel Blue' },
];

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewFolderDialog({ open, onOpenChange }: NewFolderDialogProps) {
  const { folders, hierarchy } = useFolderHierarchy();
  const createFolder = hierarchy.createFolder;
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('root');
  const [selectedIcon, setSelectedIcon] = useState<FolderIcon>('book');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0].value);

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createFolder(name.trim(), parentId === 'root' ? null : parentId, selectedIcon, selectedColor);
    setName('');
    setParentId('root');
    setSelectedIcon('book');
    setSelectedColor(FOLDER_COLORS[0].value);
    onOpenChange(false);
  };

  const SelectedIconComponent = FOLDER_ICONS.find((i) => i.key === selectedIcon)?.icon ?? BookOpen;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, fontSize: '1.25rem' }}>
            New Folder
          </DialogTitle>
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
              {name || 'Folder name'}
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
              placeholder="e.g. Devotions, Sermon Notes..."
              className="w-full px-3 py-2 rounded-md text-[13px] bg-transparent outline-none"
              style={{
                border: '1px solid var(--pale-stone)',
                color: 'var(--deep-umber)',
                fontFamily: 'Outfit, sans-serif',
              }}
            />
          </div>

          {/* Parent folder */}
          <div>
            <label
              className="text-[11px] font-medium tracking-wider block mb-1.5"
              style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
            >
              LOCATION
            </label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* `root` is the stored parent id for a top-level folder;
                    "Main" is how we say that to the user. */}
                <SelectItem value="root" style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}>
                  Main
                </SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id} style={{ fontFamily: 'Outfit, sans-serif', fontSize: 13 }}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              {FOLDER_COLORS.map(({ value }) => (
                <button
                  key={value}
                  onClick={() => setSelectedColor(value)}
                  className="relative w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: value,
                    boxShadow: selectedColor === value ? `0 0 0 2px var(--plaster), 0 0 0 3.5px ${value}` : 'none',
                  }}
                  title={FOLDER_COLORS.find((c) => c.value === value)?.label}
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
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-[12px] font-medium rounded-md hover:bg-black/5 transition-colors"
            style={{ color: 'var(--deep-umber)', fontFamily: 'Outfit, sans-serif' }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className="px-4 py-2 text-[12px] font-medium rounded-md transition-opacity disabled:opacity-40"
            style={{ background: 'var(--deep-umber)', color: 'var(--plaster)', fontFamily: 'Outfit, sans-serif' }}
          >
            Create Folder
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Re-export for use in Sidebar
export { FOLDER_ICONS, FOLDER_COLORS };
