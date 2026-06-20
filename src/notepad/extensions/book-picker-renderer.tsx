import { createRoot, type Root } from 'react-dom/client';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { BookSuggestList } from './BookSuggestList';
import { routeVersePicker, type BookOrVerseItem } from './book-matcher';
import { applyVerseSelection } from './verse-picker-commands';
import { completeReference } from '../bible/verse-search';
import type { VerseSearchDeps } from '../bible/verse-search-types';

const HINT = 'Add chapter:verse, e.g. 8:28';

// DOM renderer for the /verse book picker (C). It does NOT use props.items;
// it computes its own view from props.query via routeVersePicker:
//   - books  → BookItem rows (autocomplete on select),
//   - hint   → "Add chapter:verse" (no rows),
//   - resolve→ fetch verse text via completeReference, show one VerseItem row.
export function renderBookPicker(search: VerseSearchDeps | null) {
  let el: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let items: BookOrVerseItem[] = [];
  let hint: string | null = null;
  let loading = false;
  let current: SuggestionProps<BookOrVerseItem, BookOrVerseItem> | null = null;
  let resolveAbort: AbortController | null = null;
  // Guards against a slow resolve painting stale results after the query moved on.
  let queryToken = 0;

  const stripVerse = (q: string) => q.replace(/^verse\s*/i, '');

  const paint = () => {
    if (!root) return;
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    root.render(
      <BookSuggestList
        items={items}
        selectedIndex={selectedIndex}
        loading={loading}
        hint={hint}
        offline={!online && items.length === 0 && !hint && !loading}
        onSelect={(item) => current?.command(item)}
      />,
    );
  };

  const place = (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
    const rect = props.clientRect?.();
    if (el && rect) {
      el.style.position = 'fixed';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom}px`;
      el.style.zIndex = '9999';
    }
  };

  const update = (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
    current = props;
    const q = stripVerse(props.query);
    const view = routeVersePicker(q);
    const token = ++queryToken;
    resolveAbort?.abort();

    if (view.kind === 'books') {
      items = view.books.map((book) => ({ kind: 'book', book }));
      hint = null; loading = false; selectedIndex = 0;
      paint();
    } else if (view.kind === 'hint') {
      items = []; hint = HINT; loading = false; selectedIndex = 0;
      paint();
    } else {
      // resolve — fetch verse text async, then show one verse row.
      items = []; hint = null; loading = true; selectedIndex = 0;
      paint();
      if (!search) { loading = false; paint(); return; }
      resolveAbort = new AbortController();
      completeReference(view.query, search, { signal: resolveAbort.signal }).then((candidate) => {
        if (token !== queryToken) return; // a newer keystroke superseded us
        items = candidate ? [{ kind: 'verse', candidate }] : [];
        hint = candidate ? null : 'No verse found';
        loading = false;
        paint();
      });
    }
  };

  return {
    onStart: (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
      el = document.createElement('div');
      document.body.appendChild(el);
      root = createRoot(el);
      place(props); update(props);
    },
    onUpdate: (props: SuggestionProps<BookOrVerseItem, BookOrVerseItem>) => {
      place(props); update(props);
    },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (!current) return false;
      const n = items.length;
      if (props.event.key === 'ArrowDown') { selectedIndex = n === 0 ? 0 : (selectedIndex + 1) % n; paint(); return true; }
      if (props.event.key === 'ArrowUp') { selectedIndex = n === 0 ? 0 : (selectedIndex - 1 + n) % n; paint(); return true; }
      if (props.event.key === 'Enter') { const item = items[selectedIndex]; if (item) current.command(item); return true; }
      if (props.event.key === 'Escape') { return true; }
      return false;
    },
    onExit: () => {
      resolveAbort?.abort();
      root?.unmount(); root = null;
      el?.remove(); el = null; current = null;
    },
  };
}

// applyVerseSelection is wired as the Suggestion `command` in scripture-ref.ts;
// re-exported here so the picker renderer and the node stay in one mental model.
export { applyVerseSelection };
