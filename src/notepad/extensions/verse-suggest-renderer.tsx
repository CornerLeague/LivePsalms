import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { VerseSuggestList } from './VerseSuggestList';
import { createVerseSearch, MIN_SEMANTIC_CHARS } from '../bible/verse-search';
import type { VerseCandidate, VerseSearchDeps } from '../bible/verse-search-types';

// Minimal DOM renderer for both Suggestion configs. Positioning uses fixed
// coordinates from clientRect; styling lives in CSS (.verse-suggest).
//
// When `search` is provided (the /verse picker, C), the renderer owns a
// createVerseSearch instance and uses ITS results as the live list: FTS-instant
// first, then FTS+semantic merged after the debounce, with a Searching… state
// in between. When `search` is null/absent (the predictive path, B), the
// renderer behaves exactly as before — it paints `props.items` with no semantic
// upgrade and never spins.
export function renderVerseSuggestList(search: VerseSearchDeps | null = null) {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let current: SuggestionProps<VerseCandidate, VerseCandidate> | null = null;
  // `current.items` is the INSTANT fallback (synchronous FTS slice + reference pin
  // from the Suggestion `items` contract) shown until createVerseSearch's first
  // emit. `liveItems` is the live FTS+semantic upgrade owned by createVerseSearch;
  // null means "fall back to current.items".
  let liveItems: VerseCandidate[] | null = null;
  let loading = false;
  const verseSearch = search ? createVerseSearch(search) : null;

  const displayItems = (): VerseCandidate[] => liveItems ?? current?.items ?? [];

  const paint = () => {
    if (!root || !current) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    const items = displayItems();
    root.render(
      <VerseSuggestList
        items={items}
        selectedIndex={selectedIndex}
        loading={loading}
        offline={!online && items.length === 0}
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
      // Match the editor's other floating popups (verse tooltip, note-link
      // popup) so the dropdown clears the text layer (TEXT_Z = 100000) and
      // sticky toolbars instead of rendering behind them.
      el.style.zIndex = '9999';
    }
  };

  // Live FTS-instant + semantic-debounced search, only for the search-enabled
  // (C) path. Strips the keyword prefix the same way C's `items` builder does.
  const runSearch = (props: SuggestionProps<VerseCandidate, VerseCandidate>) => {
    if (!verseSearch) return;
    const q = props.query.replace(/^verse\s*/i, '');
    const semanticWillRun = q.trim().length >= MIN_SEMANTIC_CHARS;
    loading = semanticWillRun;
    verseSearch.query(q, (results, phase) => {
      const prevOsis = displayItems()[selectedIndex]?.osis;
      liveItems = results;
      loading = semanticWillRun && phase !== 'complete';
      const reIdx = prevOsis ? results.findIndex((c) => c.osis === prevOsis) : -1;
      selectedIndex = reIdx >= 0 ? reIdx : 0;
      paint();
    });
  };

  return {
    onStart: (props: SuggestionProps<VerseCandidate, VerseCandidate>) => {
      current = props; selectedIndex = 0; liveItems = null; loading = false;
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      place(props); runSearch(props); paint();
    },
    onUpdate: (props: SuggestionProps<VerseCandidate, VerseCandidate>) => {
      current = props;
      if (selectedIndex >= displayItems().length) selectedIndex = 0;
      place(props); runSearch(props); paint();
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!current) return false;
      const items = displayItems();
      const n = items.length;
      if (props.event.key === 'ArrowDown') { selectedIndex = n === 0 ? 0 : (selectedIndex + 1) % n; paint(); return true; }
      if (props.event.key === 'ArrowUp') { selectedIndex = n === 0 ? 0 : (selectedIndex - 1 + n) % n; paint(); return true; }
      if (props.event.key === 'Enter') { const c = items[selectedIndex]; if (c) current.command(c); return true; }
      if (props.event.key === 'Escape') { return true; }
      return false;
    },
    onExit: () => {
      verseSearch?.cancel();
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}
