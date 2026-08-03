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

// Height (px) the on-screen keyboard (or other bottom inset) currently steals
// from the layout viewport, via visualViewport. 0 when there's no keyboard or
// the API is unavailable. This is what lets the bottom sheet sit ABOVE the
// keyboard instead of behind it — the reason the menu looked like it never
// opened on phones (you type "/", the keyboard is up, the sheet was pinned to
// bottom:0 under it).
function keyboardInset(): number {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

// Height of the area actually visible above the keyboard — caps the sheet so
// its top can't run off-screen when the keyboard is tall.
function visibleHeight(): number {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) return vv.height;
  return typeof window !== 'undefined' ? window.innerHeight : 0;
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

  // Push the sheet above the keyboard, and re-measure whenever the keyboard
  // shows/hides/resizes (visualViewport fires resize + scroll). The CSS reads
  // these two custom properties.
  const applySheetMetrics = () => {
    if (!el) return;
    el.style.setProperty('--slash-sheet-kb', `${keyboardInset()}px`);
    el.style.setProperty('--slash-sheet-maxh', `${Math.max(160, visibleHeight() - 24)}px`);
  };
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  let vvBound = false;
  const bindViewport = () => {
    if (vvBound || !vv) return;
    vv.addEventListener('resize', applySheetMetrics);
    vv.addEventListener('scroll', applySheetMetrics);
    vvBound = true;
  };
  const unbindViewport = () => {
    if (!vvBound || !vv) return;
    vv.removeEventListener('resize', applySheetMetrics);
    vv.removeEventListener('scroll', applySheetMetrics);
    vvBound = false;
  };

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
      // Bottom sheet — the sheet CSS owns its own fixed placement (above the
      // keyboard via the metrics below), so clear any caret coordinates.
      el.style.position = '';
      el.style.left = '';
      el.style.top = '';
      applySheetMetrics();
      bindViewport();
      return;
    }
    // Desktop popover — drop any sheet metrics/listener from a prior rotate.
    unbindViewport();
    el.style.removeProperty('--slash-sheet-kb');
    el.style.removeProperty('--slash-sheet-maxh');
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
      unbindViewport();
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}
