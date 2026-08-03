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
// on-screen keyboard AND pinch-zoom panning via visualViewport. offsetLeft /
// offsetTop matter: when the user pinch-zooms, the visible strip is a window
// into the layout viewport, and clamping against window.innerWidth alone would
// place the menu outside it.
function visibleBounds(): { top: number; bottom: number; left: number; right: number } {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) {
    return {
      top: vv.offsetTop,
      bottom: vv.offsetTop + vv.height,
      left: vv.offsetLeft,
      right: vv.offsetLeft + vv.width,
    };
  }
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { top: 0, bottom: h, left: 0, right: w };
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
    const vis = visibleBounds();
    const visH = vis.bottom - vis.top;
    const spaceBelow = vis.bottom - rect.bottom;
    const spaceAbove = rect.top - vis.top;

    // The list's uncapped content height: once a previous cap is in effect,
    // offsetHeight is the capped height and scrollHeight the full content.
    const naturalH = panel ? Math.max(panel.offsetHeight, panel.scrollHeight) : 300;

    // Prefer below the caret; flip above when it won't fit below but fits better
    // above (e.g. the caret sits just over the keyboard).
    const below = spaceBelow >= naturalH + 12 || spaceBelow >= spaceAbove;
    const avail = (below ? spaceBelow : spaceAbove) - 12;

    // Height cap: the chosen side's space, floored at 160px so the list stays
    // usable — but never taller than the visible area itself (the keyboard can
    // leave less than 160px on BOTH sides of the caret). Apply the cap BEFORE
    // measuring, so the clamp below positions the menu at its final height,
    // not the height of the previous paint.
    const maxh = Math.max(64, Math.min(Math.max(160, Math.round(avail)), visH - 16));
    el.style.setProperty('--slash-menu-maxh', `${maxh}px`);

    const menuH = panel?.offsetHeight || 300;
    const menuW = panel?.offsetWidth || 300;

    // Anchor at the caret, then clamp fully inside the visible bounds. When the
    // 160px floor exceeds the chosen side's space, the clamp slides the menu
    // over the caret line — fully on screen beats caret-adjacent.
    let top = below ? rect.bottom : rect.top - menuH;
    top = Math.min(top, vis.bottom - menuH - 4);
    top = Math.max(top, vis.top + 4);

    // Horizontal clamp in visual-viewport coordinates (see visibleBounds).
    const left = Math.max(vis.left + 8, Math.min(rect.left, vis.right - menuW - 8));

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  // Reposition while open if the keyboard shows/hides/resizes the viewport.
  // Layout scrolls (the note pane scrolling under the open menu) fire no
  // visualViewport events, so those are caught with a capture-phase window
  // scroll listener — skipping scrolls of the menu's own list, which don't
  // move the caret. window resize covers engines whose visualViewport events
  // are unreliable.
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const onViewport = () => place();
  const onScroll = (e: Event) => {
    if (el && e.target instanceof Node && el.contains(e.target)) return;
    place();
  };
  const bindViewport = () => {
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', onViewport);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onScroll, true);
  };
  const unbindViewport = () => {
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewport);
    window.removeEventListener('resize', onViewport);
    window.removeEventListener('scroll', onScroll, true);
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
