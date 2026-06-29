import { NotebookPen, Pencil, BookOpen, MoreHorizontal } from 'lucide-react';
import type { MobileTab } from './types';

interface TabDef {
  id: MobileTab;
  label: string;
  Icon: typeof NotebookPen;
}

const TABS: TabDef[] = [
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
  { id: 'editor', label: 'Editor', Icon: Pencil },
  { id: 'bible', label: 'Bible', Icon: BookOpen },
  { id: 'more', label: 'More', Icon: MoreHorizontal },
];

export interface MobileTabBarProps {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
}

export function MobileTabBar({ active, onSelect }: MobileTabBarProps) {
  return (
    <div
      role="tablist"
      className="shrink-0 flex"
      style={{
        borderTop: '1px solid var(--pale-stone)',
        background: 'var(--notepad-bar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(id)}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{
              minHeight: 56,
              color: selected ? 'var(--deep-umber)' : 'var(--silica)',
              borderTop: selected ? '2px solid var(--deep-umber)' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            <span>
              <Icon size={18} />
            </span>
            <span className="text-[10px] tracking-wide">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
