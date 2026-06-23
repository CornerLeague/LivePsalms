import { NotebookPen, Pencil, Flame, MoreHorizontal } from 'lucide-react';
import type { MobileTab } from './types';

interface TabDef {
  id: MobileTab;
  label: string;
  Icon: typeof NotebookPen;
}

const TABS: TabDef[] = [
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
  { id: 'editor', label: 'Editor', Icon: Pencil },
  { id: 'lamplight', label: 'Lamplight', Icon: Flame },
  { id: 'more', label: 'More', Icon: MoreHorizontal },
];

export interface MobileTabBarProps {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  lamplightHasConnections: boolean;
}

export function MobileTabBar({ active, onSelect, lamplightHasConnections }: MobileTabBarProps) {
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
        const accent = id === 'lamplight';
        return (
          <button
            key={id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(id)}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5"
            style={{
              minHeight: 56,
              color: selected
                ? accent
                  ? '#b8843a'
                  : 'var(--deep-umber)'
                : 'var(--silica)',
              borderTop: selected ? `2px solid ${accent ? '#b8843a' : 'var(--deep-umber)'}` : '2px solid transparent',
              background: 'transparent',
            }}
          >
            <span className="relative">
              <Icon size={18} />
              {accent && lamplightHasConnections && (
                <span
                  data-testid="lamplight-dot"
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -4,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#b8843a',
                  }}
                />
              )}
            </span>
            <span className="text-[10px] tracking-wide">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
