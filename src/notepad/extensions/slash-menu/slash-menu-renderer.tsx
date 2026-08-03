import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { SlashMenuList } from './SlashMenuList';
import type { SlashCommand } from './slash-commands';

// The launcher is a caret-anchored popover on EVERY viewport. It used to switch
// to a fixed bottom sheet on mobile, but `position: fixed` + the on-screen
// keyboard behave inconsistently across mobile browsers (behind the keyboard on
// some; a visualViewport offset over-corrects off-screen on others) — which
// read as "the menu never opened" on phones. Anchoring to the caret sidesteps
// all of that: the caret is always in the visible area while you type. We use
// visualViewport only to know the visible bounds (so we can flip above the
// caret and cap the height when the keyboard eats the lower screen).

function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

// Visible bounds in client (fixed-position) coordinates, accounting for the
// on-screen keyboard via visualViewport.
function visibleBounds(): { top: number; bottom: number } {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { top: 0, bottom: h };
}

export function renderSlashMenu() {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let current: SuggestionProps<SlashCommand, SlashCommand> | null = null;

  const items = (): SlashCommand[] => current?.items ?? [];

  const paint = () => {
    if (!root || !current) return;
    root.render(
      <SlashMenuList
        items={items()}
        selectedIndex={selectedIndex}
        grouped={current.query.trim() === ''}
        mobile={isMobileViewport()}
        onSelect={(command) => current?.command(command)}
      />,
    );
  };

  // Position the (already-painted) menu at the caret, flipping above it and
  // capping its height so it always lands inside the visible area.
  const place = () => {
    if (!el || !current) return;
    const rect = current.clientRect?.();
    if (!rect) return;
    el.style.position = 'fixed';
    el.style.zIndex = '9999';

    const panel = el.firstElementChild as HTMLElement | null;
    const menuH = panel?.offsetHeight || 300;
    const menuW = panel?.offsetWidth || 300;
    const { top: visTop, bottom: visBottom } = visibleBounds();
    const spaceBelow = visBottom - rect.bottom;
    const spaceAbove = rect.top - visTop;

    // Prefer below the caret; flip above when it won't fit below but fits better
    // above (e.g. the caret sits just over the keyboard).
    const below = spaceBelow >= menuH || spaceBelow >= spaceAbove;
    const top = below ? rect.bottom : Math.max(visTop + 4, rect.top - menuH);
    const avail = (below ? spaceBelow : spaceAbove) - 12;

    const maxLeft = (typeof window !== 'undefined' ? window.innerWidth : menuW) - menuW - 8;
    el.style.left = `${Math.max(8, Math.min(rect.left, Math.max(8, maxLeft)))}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.setProperty('--slash-menu-maxh', `${Math.max(160, Math.round(avail))}px`);
  };

  // Reposition while open if the keyboard shows/hides/resizes the viewport.
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const onViewport = () => place();
  const bindViewport = () => {
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', onViewport);
  };
  const unbindViewport = () => {
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewport);
  };

  return {
    onStart: (props: SuggestionProps<SlashCommand, SlashCommand>) => {
      current = props;
      selectedIndex = 0;
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      paint();   // render first so the panel has a measurable size…
      place();   // …then anchor it at the caret.
      bindViewport();
    },
    onUpdate: (props: SuggestionProps<SlashCommand, SlashCommand>) => {
      current = props;
      if (selectedIndex >= items().length) selectedIndex = 0;
      paint();
      place();
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
