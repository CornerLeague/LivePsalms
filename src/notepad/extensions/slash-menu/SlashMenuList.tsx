import {
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus,
  Bold, Italic, Underline,
  Highlighter, Palette,
  BookOpen, Search,
  type LucideIcon,
} from 'lucide-react';
import type { SlashCommand, SlashGroup } from './slash-commands';
import './slash-menu.css';

const ICONS: Record<string, LucideIcon> = {
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus,
  Bold, Italic, Underline,
  Highlighter, Palette,
  BookOpen, Search,
};

const GROUP_LABEL: Record<SlashGroup, string> = {
  basic: 'Basic',
  style: 'Style',
  scripture: 'Scripture',
};

export interface SlashMenuListProps {
  items: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
  /** Show group headers (only when browsing the full, unfiltered list). */
  grouped: boolean;
  /** Larger tap targets for touch. Always a caret-anchored popover either way. */
  mobile?: boolean;
}

export function SlashMenuList({ items, selectedIndex, onSelect, grouped, mobile = false }: SlashMenuListProps) {
  const cls = `slash-menu slash-menu--popover${mobile ? ' slash-menu--mobile' : ''}`;
  if (items.length === 0) {
    return <div className={`${cls} slash-menu--empty`}>No matching commands</div>;
  }

  return (
    <div className={cls} role="listbox" aria-label="Formatting commands">
      {items.map((command, i) => {
        const Icon = ICONS[command.icon] ?? Minus;
        // Header when this row starts a new group (compare to the previous
        // item — no mutable cursor, so it stays render-pure).
        const prevGroup: SlashGroup | null = i > 0 ? items[i - 1].group : null;
        const header = grouped && command.group !== prevGroup ? GROUP_LABEL[command.group] : null;
        return (
          <div key={command.id}>
            {header ? <div className="slash-menu__group" aria-hidden="true">{header}</div> : null}
            <div
              role="option"
              aria-selected={i === selectedIndex}
              className={`slash-menu__row${i === selectedIndex ? ' is-selected' : ''}`}
              // pointerdown (not click/mousedown) so selecting fires on touch AND
              // mouse, before the editor's blur/selection teardown races the
              // popup unmount. preventDefault keeps the editor focused.
              onPointerDown={(e) => { e.preventDefault(); onSelect(command); }}
              tabIndex={-1}
            >
              <span className="slash-menu__icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="slash-menu__labels">
                <span className="slash-menu__title">{command.title}</span>
                <span className="slash-menu__hint">{command.hint}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
