import { useRef } from 'react';
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

// Movement (px) between press and release still counted as a tap, not a scroll.
const TAP_SLOP = 10;

export function SlashMenuList({ items, selectedIndex, onSelect, grouped, mobile = false }: SlashMenuListProps) {
  // The touch/pen press currently armed by a row's pointerdown; committed on a
  // clean release, discarded when the browser claims the gesture for scrolling.
  // A ref (not state): it must never trigger a re-render mid-gesture.
  const press = useRef<{ pointerId: number; commandId: string; x: number; y: number } | null>(null);

  // Keep the editor focused (and the mobile keyboard up) for ANY press inside
  // the menu — rows, group headers, padding. Canceling pointerdown here also
  // suppresses the compatibility mouse events a touch tap would otherwise
  // synthesize at this spot, which land in the editor after the menu closes
  // and yank the caret out of the "/query" — reading as "the menu vanished".
  const keepEditorFocus = (e: React.PointerEvent) => e.preventDefault();

  const cls = `slash-menu slash-menu--popover${mobile ? ' slash-menu--mobile' : ''}`;
  if (items.length === 0) {
    return (
      <div className={`${cls} slash-menu--empty`} onPointerDown={keepEditorFocus}>
        No matching commands
      </div>
    );
  }

  return (
    <div className={cls} role="listbox" aria-label="Formatting commands" onPointerDown={keepEditorFocus}>
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
              // Mouse selects on the press itself — the classic menu idiom, and
              // it beats the editor's blur/selection teardown racing the popup
              // unmount. Touch/pen must NOT: their pointerdown is finger
              // contact, and selecting there turns every attempt to scroll the
              // list into an accidental command. They arm here and commit on
              // the release below, like a native button tap. (The container's
              // onPointerDown already preventDefaults for every press.)
              onPointerDown={(e) => {
                if (e.button !== 0) return; // primary only — right/middle keep their default behavior
                if (e.pointerType === 'mouse') { onSelect(command); return; }
                press.current = { pointerId: e.pointerId, commandId: command.id, x: e.clientX, y: e.clientY };
              }}
              // Touch pointers have implicit capture, so this release fires on
              // the pressed row even if the finger drifted — the slop check
              // rejects drags, the commandId check rejects cross-row releases.
              onPointerUp={(e) => {
                const p = press.current;
                if (!p || p.pointerId !== e.pointerId || p.commandId !== command.id) return;
                press.current = null;
                const moved =
                  Math.abs(e.clientX - p.x) > TAP_SLOP || Math.abs(e.clientY - p.y) > TAP_SLOP;
                if (!moved) onSelect(command);
              }}
              // The browser claimed the pointer (list scroll started): not a tap.
              onPointerCancel={() => { press.current = null; }}
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
