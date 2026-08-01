import { NotebookPen, Pencil, BookOpen, MoreHorizontal, Waypoints } from 'lucide-react';
import type { MobileTab } from './types';

interface TabDef {
  id: MobileTab;
  label: string;
  Icon: typeof NotebookPen;
}

// Reflections sits in the middle as a raised launcher (not a normal tab): it
// navigates to the full path-of-stones page rather than swapping an in-shell
// view, so it's never part of the tablist's selected state. The four real tabs
// flank it two-per-side.
const LEFT_TABS: TabDef[] = [
  { id: 'notes', label: 'Notes', Icon: NotebookPen },
  { id: 'editor', label: 'Editor', Icon: Pencil },
];
const RIGHT_TABS: TabDef[] = [
  { id: 'bible', label: 'Bible', Icon: BookOpen },
  { id: 'more', label: 'More', Icon: MoreHorizontal },
];

export interface MobileTabBarProps {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
  onReflections: () => void;
}

export function MobileTabBar({ active, onSelect, onReflections }: MobileTabBarProps) {
  const renderTab = ({ id, label, Icon }: TabDef) => {
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
  };

  return (
    <div
      className="shrink-0 relative flex"
      style={{
        borderTop: '1px solid var(--pale-stone)',
        background: 'var(--notepad-bar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      {/* Only the four view-switching tabs form the tab widget. The middle slot
          is an aria-hidden spacer that reserves the launcher's room without
          adding a non-tab child to the tablist (a real button here would make a
          malformed ARIA tab widget). */}
      <div role="tablist" aria-label="Notebook sections" className="flex flex-1 items-end">
        {LEFT_TABS.map(renderTab)}
        <div aria-hidden className="flex-1" style={{ minHeight: 56 }} />
        {RIGHT_TABS.map(renderTab)}
      </div>

      {/* Reflections — the raised focal launcher. A sibling of the tablist (not a
          tab), centered over the reserved gap; rises above the bar so the eye
          lands on it first. The overlay ignores pointer events so it never steals
          taps from the flanking tabs; only the button itself is interactive. */}
      <div
        className="absolute inset-0 flex items-end justify-center"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', pointerEvents: 'none' }}
      >
        <button
          type="button"
          onClick={onReflections}
          aria-label="Reflections"
          data-tour="reflections-entry-mobile"
          className="flex flex-col items-center gap-0.5 cursor-pointer"
          style={{ background: 'transparent', pointerEvents: 'auto' }}
        >
          <span
            className="flex items-center justify-center"
            style={{
              width: 46,
              height: 46,
              marginTop: -20,
              borderRadius: '50%',
              background: 'var(--reflections-cta-bg)',
              color: 'var(--reflections-cta-fg)',
              border: '3px solid var(--notepad-bar-bg)',
            }}
          >
            <Waypoints size={21} />
          </span>
          <span
            className="text-[10px] tracking-wide font-medium"
            style={{ color: 'var(--reflections-cta-bg)' }}
          >
            Reflections
          </span>
        </button>
      </div>
    </div>
  );
}
