import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { SlashMenuList } from './SlashMenuList';
import type { SlashCommand } from './slash-commands';

// Mobile presentation is a bottom sheet; desktop is a caret-anchored popover.
// Detected at render time (not editor build) so a rotate/resize is honored.
// 767px matches the app's 768px workspace breakpoint.
function isMobileViewport(): boolean {
  // Guard matchMedia — absent in jsdom (tests) and old runtimes. Missing ⇒
  // desktop popover, the safe default.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

// Minimal DOM renderer for the "/" launcher, mirroring verse-suggest-renderer:
// a body-portaled panel positioned at the caret, class-based styling, arrow/
// enter/escape keyboard nav. No async work — items arrive synchronously from
// the Suggestion `items` contract (filterSlashCommands).
export function renderSlashMenu() {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let current: SuggestionProps<SlashCommand, SlashCommand> | null = null;

  const items = (): SlashCommand[] => current?.items ?? [];

  const paint = () => {
    if (!root || !current) return;
    const list = items();
    root.render(
      <SlashMenuList
        items={list}
        selectedIndex={selectedIndex}
        grouped={current.query.trim() === ''}
        variant={isMobileViewport() ? 'sheet' : 'popover'}
        onSelect={(command) => current?.command(command)}
      />,
    );
  };

  const place = (props: SuggestionProps<SlashCommand, SlashCommand>) => {
    if (!el) return;
    el.style.zIndex = '9999';
    if (isMobileViewport()) {
      // Bottom sheet — the container spans the viewport bottom; the sheet CSS
      // owns its own fixed placement, so clear any caret coordinates.
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      return;
    }
    const rect = props.clientRect?.();
    if (rect) {
      // Caret-anchored popover — matches the verse dropdown / note-link popup so
      // the menu clears the text layer and sticky toolbars.
      el.style.position = 'fixed';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom}px`;
    }
  };

  return {
    onStart: (props: SuggestionProps<SlashCommand, SlashCommand>) => {
      current = props;
      selectedIndex = 0;
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      place(props);
      paint();
    },
    onUpdate: (props: SuggestionProps<SlashCommand, SlashCommand>) => {
      current = props;
      if (selectedIndex >= items().length) selectedIndex = 0;
      place(props);
      paint();
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!current) return false;
      const n = items().length;
      if (props.event.key === 'ArrowDown') { selectedIndex = n === 0 ? 0 : (selectedIndex + 1) % n; paint(); return true; }
      if (props.event.key === 'ArrowUp') { selectedIndex = n === 0 ? 0 : (selectedIndex - 1 + n) % n; paint(); return true; }
      if (props.event.key === 'Enter') { const c = items()[selectedIndex]; if (c) current.command(c); return true; }
      if (props.event.key === 'Escape') { return true; }
      return false;
    },
    onExit: () => {
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}
