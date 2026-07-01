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
    renameList: vi.fn(),
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
  it('renders the first verse text and the 1/N counter', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    render(<FocusListView focus={makeFocus(items)} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.getByText('text John 3:16')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verses/ })).toHaveTextContent('1 / 2');
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

  it('Next arrow advances to verse 2; Prev disabled at index 0; Next disabled at last', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    render(<FocusListView focus={makeFocus(items)} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.getByRole('button', { name: /Previous verse/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next verse/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Next verse/ }));
    expect(screen.getByText('text John 3:17')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next verse/ })).toBeDisabled();
  });

  it('verse dropdown opens and lists every verse; clicking a label shows that verse', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17'), item('c', 'John 3:18')];
    wireVerseText(items);
    render(<FocusListView focus={makeFocus(items)} translation="BSB" searchDeps={searchDeps} />);
    fireEvent.click(screen.getByRole('button', { name: /Verses/ }));
    expect(screen.getByText('1. John 3:16')).toBeInTheDocument();
    expect(screen.getByText('2. John 3:17')).toBeInTheDocument();
    expect(screen.getByText('3. John 3:18')).toBeInTheDocument();
    fireEvent.click(screen.getByText('3. John 3:18'));
    expect(screen.getByText('text John 3:18')).toBeInTheDocument();
  });

  it('reorder and remove buttons in dropdown call the right hook methods', () => {
    const items = [item('a', 'John 3:16'), item('b', 'John 3:17')];
    wireVerseText(items);
    const focus = makeFocus(items);
    render(<FocusListView focus={focus} translation="BSB" searchDeps={searchDeps} />);
    fireEvent.click(screen.getByRole('button', { name: /Verses/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move John 3:17 up/ }));
    expect(focus.reorderItem).toHaveBeenCalledWith('b', 'up');
    fireEvent.click(screen.getByRole('button', { name: /Remove John 3:16/ }));
    expect(focus.removeItem).toHaveBeenCalledWith('a');
  });

  it('has no "Edit list" control', () => {
    const items = [item('a', 'John 3:16')];
    wireVerseText(items);
    render(<FocusListView focus={makeFocus(items)} translation="BSB" searchDeps={searchDeps} />);
    expect(screen.queryByLabelText('Edit list')).toBeNull();
  });
});
