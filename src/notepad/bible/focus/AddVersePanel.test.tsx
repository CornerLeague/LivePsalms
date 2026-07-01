// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AddVersePanel } from './AddVersePanel';
import type { VerseSearchDeps, RawFtsRow } from '../verse-search-types';

afterEach(cleanup);

// A deps stub whose FTS path returns one John 3:16 row; the rest are inert.
function depsWithFts(rows: RawFtsRow[]): VerseSearchDeps {
  return {
    ftsSearch: async () => rows,
    semanticSearch: async () => [],
    resolvePericope: async () => null,
    fetchVerseText: async () => null,
  };
}

describe('AddVersePanel — type / paste', () => {
  it('parses a pasted batch and calls onAddRefs with the parsed refs', () => {
    const onAddRefs = vi.fn();
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={depsWithFts([])} translation="BSB" />);
    fireEvent.change(screen.getByLabelText(/paste references/i), {
      target: { value: 'John 3:16, Eph 2:8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
      { book: 'eph', chapter: 2, verseStart: 8, verseEnd: 8, label: 'Ephesians 2:8' },
    ]);
  });

  it('reports the unparseable fragments and still adds the rest', () => {
    const onAddRefs = vi.fn();
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={depsWithFts([])} translation="BSB" />);
    fireEvent.change(screen.getByLabelText(/paste references/i), {
      target: { value: 'John 3:16, gibberish' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
    expect(screen.getByText(/Couldn.t read:/i)).toHaveTextContent('gibberish');
  });
});

describe('AddVersePanel — search', () => {
  it('adds a tapped search result as a ScriptureRef', async () => {
    const onAddRefs = vi.fn();
    const deps = depsWithFts([
      { id: 'jhn.3.16', book: 'jhn', chapter: 3, verseStart: 16, verseEnd: null, text: 'For God so loved the world' },
    ]);
    render(<AddVersePanel onAddRefs={onAddRefs} searchDeps={deps} translation="BSB" />);
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    fireEvent.change(screen.getByLabelText(/search verses/i), { target: { value: 'loved' } });

    const result = await screen.findByRole('button', { name: /John 3:16/ });
    fireEvent.click(result);
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 16, verseEnd: 16, label: 'John 3:16' },
    ]);
  });
});

describe('AddVersePanel — browse navigator', () => {
  function renderSearch(
    loadChapterVerses?: (book: string, chapter: number, translation: 'BSB' | 'KJV' | 'WEB') => Promise<number[]>,
  ) {
    const onAddRefs = vi.fn();
    render(
      <AddVersePanel
        onAddRefs={onAddRefs}
        searchDeps={depsWithFts([])}
        translation="BSB"
        loadChapterVerses={loadChapterVerses}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    return { onAddRefs };
  }

  it('shows book pills on the Search tab, and filters them by typing', () => {
    renderSearch();
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/search verses/i), { target: { value: 'psal' } });
    expect(screen.getByRole('button', { name: 'Psalm' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'John' })).not.toBeInTheDocument();
  });

  it('tapping a book shows chapter bubbles for that book', () => {
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'John' }));
    // John has 21 chapters
    expect(screen.getByRole('button', { name: 'Chapter 3' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Chapter \d+$/ })).toHaveLength(21);
  });

  it('tapping a chapter loads verse bubbles from the injected fake', async () => {
    const fakeLoad = vi.fn().mockResolvedValue([1, 2, 3]);
    renderSearch(fakeLoad);
    fireEvent.click(screen.getByRole('button', { name: 'John' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 3' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Verse 1' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Verse 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verse 3' })).toBeInTheDocument();
  });

  it('tapping a verse calls onAddRefs with the correct ScriptureRef', async () => {
    const fakeLoad = vi.fn().mockResolvedValue([1, 2, 3]);
    const { onAddRefs } = renderSearch(fakeLoad);
    fireEvent.click(screen.getByRole('button', { name: 'John' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 3' }));
    await waitFor(() => screen.getByRole('button', { name: 'Verse 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verse 3' }));
    expect(onAddRefs).toHaveBeenCalledWith([
      { book: 'jhn', chapter: 3, verseStart: 3, verseEnd: 3, label: 'John 3:3' },
    ]);
  });

  it('back buttons step up a level: verse→chapter→book', async () => {
    const fakeLoad = vi.fn().mockResolvedValue([1]);
    renderSearch(fakeLoad);
    // Go to chapter level
    fireEvent.click(screen.getByRole('button', { name: 'John' }));
    expect(screen.getByRole('button', { name: 'Chapter 1' })).toBeInTheDocument();
    // Go to verse level
    fireEvent.click(screen.getByRole('button', { name: 'Chapter 1' }));
    await waitFor(() => screen.getByRole('button', { name: 'Verse 1' }));
    // Back to chapter (verse-level back button shows "← John 1")
    fireEvent.click(screen.getByRole('button', { name: '← John 1' }));
    expect(screen.getByRole('button', { name: 'Chapter 1' })).toBeInTheDocument();
    // Back to book (chapter-level back button shows "← John")
    fireEvent.click(screen.getByRole('button', { name: '← John' }));
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
  });
});
