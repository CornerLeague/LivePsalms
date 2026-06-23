import { BookOpen, NotebookPen, ScrollText } from 'lucide-react';
import type { MobileStudyTab } from './types';

interface TabDef {
  id: MobileStudyTab;
  label: string;
  Icon: typeof BookOpen;
}

const TABS: TabDef[] = [
  { id: 'reader', label: 'Reader', Icon: BookOpen },
  { id: 'study', label: 'Study', Icon: NotebookPen },
  { id: 'context', label: 'Context', Icon: ScrollText },
];

export interface StudyTabBarProps {
  active: MobileStudyTab;
  onSelect: (tab: MobileStudyTab) => void;
}

export function StudyTabBar({ active, onSelect }: StudyTabBarProps) {
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
            <Icon size={18} />
            <span className="text-[10px] tracking-wide">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
