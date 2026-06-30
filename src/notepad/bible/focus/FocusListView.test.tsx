// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// useIsMobile (via FocusListSwitcher) reads matchMedia — stub it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});

// Control the assembled verse text so the view test stays about the view.
const { verseTextRef } = vi.hoisted(() => ({
  verseTextRef: { current: { itemTexts: [] as unknown[], loading: false } },
}));
vi.mock('./useFocusListVerseText', () => ({
  useFocusListVerseText: () => verseTextRef.current,
}));

import { FocusListView } from './FocusListView';
import type { UseScriptureFocusListsResult } from './useScriptureFocusLists';
import type { FocusListItem } from './focus-list-types';
import type { VerseSearchDeps } from '../verse-search-types';

const item = (id: string, label: string): FocusListItem => ({
  id, book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label, position: 0,
});

function makeFocus(items: FocusListItem[]): UseScriptureFocusListsResult {
  return {
    focusModeOn: true,
    toggleFocusMode: vi.fn(),
    savedLists: [],
    quickList: { id: '__quick__', title: 'Quick list', position: -1, items },
    activeListId: '__quick__',
    activeList: { id: '__quick__', title: 'Quick list', position: -1, items },
    canSave: false,
    selectList: vi.fn(),
    newList: vi.fn(),
    saveQuickList: vi.fn(),
    deleteList: vi.fn(),
    addRefs: vi.fn(),
    removeItem: vi.fn(),
    reorderItem: vi.fn(),
  };
}

// Drive the mocked hook from the focus's items.
function wireVerseText(items: FocusListItem[]) {
  verseTextRef.current = {
    itemTexts: items.map((it) => ({ item: it, lines: [{ verse: it.verseStart, text: `text ${it.label}` }], missing: false })),
    loading: false,
  };
}

const searchDeps = {} as VerseSearchDeps;
beforeEach(() => { verseTextRef.current = { itemTexts: [], loading: false }; });
afterEach(cleanup);

describe('FocusListView', () => {
  it('renders the verse count', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    render(<FocusListView focus={makeFocus(items)} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.getByText('2 verses')).toBeInTheDocument();
  });

  it('shows the empty state when the list has no items', () => {
    render(<FocusListView focus={makeFocus([])} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.getByText(/No verses yet/i)).toBeInTheDocument();
  });

  it('toggles the Add panel', () => {
    render(<FocusListView focus={makeFocus([])} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.queryByLabelText(/paste references/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add verses/i }));
    expect(screen.getByLabelText(/paste references/i)).toBeInTheDocument();
  });

  it('reorders a verse up in edit mode', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    const focus = makeFocus(items);
    render(<FocusListView focus={focus} translation="BSB" searchDeps={searchDeps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit list/i }));
    fireEvent.click(screen.getByRole('button', { name: /Move John 3:17 up/i }));
    expect(focus.reorderItem).toHaveBeenCalledWith('b', 'up');
  });

  it('removes a verse in edit mode', () => {
    const items = [item('a', 'John 3:16')];
    wireVerseText(items);
    const focus = makeFocus(items);
    render(<FocusListView focus={focus} translation="BSB" searchDeps={searchDeps} />);
    fireEvent.click(screen.getByRole('button', { name: /edit list/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remove John 3:16/i }));
    expect(focus.removeItem).toHaveBeenCalledWith('a');
  });
});
