import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { VerseSuggestList } from './VerseSuggestList';
import type { VerseCandidate } from '../bible/verse-search-types';

// Minimal DOM renderer for both Suggestion configs. Positioning uses fixed
// coordinates from clientRect; styling lives in CSS (.verse-suggest).
export function renderVerseSuggestList() {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let current: SuggestionProps<VerseCandidate, VerseCandidate> | null = null;

  const paint = () => {
    if (!root || !current) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    root.render(
      <VerseSuggestList
        items={current.items}
        selectedIndex={selectedIndex}
        loading={false}
        offline={!online && current.items.length === 0}
        onSelect={(c) => current?.command(c)}
      />,
    );
  };

  const place = (props: SuggestionProps<VerseCandidate, VerseCandidate>) => {
    const rect = props.clientRect?.();
    if (el && rect) {
      el.style.position = 'fixed';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom}px`;
      el.style.zIndex = '50';
    }
  };

  return {
    onStart: (props: SuggestionProps<VerseCandidate, VerseCandidate>) => {
      current = props; selectedIndex = 0;
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      place(props); paint();
    },
    onUpdate: (props: SuggestionProps<VerseCandidate, VerseCandidate>) => {
      current = props;
      if (selectedIndex >= props.items.length) selectedIndex = 0;
      place(props); paint();
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!current) return false;
      const n = current.items.length;
      if (props.event.key === 'ArrowDown') { selectedIndex = n === 0 ? 0 : (selectedIndex + 1) % n; paint(); return true; }
      if (props.event.key === 'ArrowUp') { selectedIndex = n === 0 ? 0 : (selectedIndex - 1 + n) % n; paint(); return true; }
      if (props.event.key === 'Enter') { const c = current.items[selectedIndex]; if (c) current.command(c); return true; }
      if (props.event.key === 'Escape') { return true; }
      return false;
    },
    onExit: () => {
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}
