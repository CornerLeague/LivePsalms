// @vitest-environment jsdom
// src/notepad/bible/BibleReader.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// jsdom doesn't implement window.matchMedia — stub it so useIsMobile doesn't throw.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

const useBiblePassages = vi.fn();
vi.mock('./useBiblePassages', () => ({ useBiblePassages: (...a: unknown[]) => useBiblePassages(...a) }));

import { BibleReader } from './BibleReader';

beforeEach(() => {
  useBiblePassages.mockReset();
  useBiblePassages.mockReturnValue({
    loading: false,
    error: null,
    verses: [
      { verse: 1, text: 'In the beginning was the Word' },
      { verse: 2, text: 'He was with God in the beginning' },
    ],
  });
});
afterEach(cleanup);

describe('BibleReader', () => {
  it('renders the current passage heading and verses', () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    expect(screen.getByText('John 1')).toBeInTheDocument();
    expect(screen.getByText(/In the beginning was the Word/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // verse number
  });

  it('advances to the next chapter and reports the passage change', () => {
    const onPassageChange = vi.fn();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} onPassageChange={onPassageChange} />);
    fireEvent.click(screen.getByRole('button', { name: /next chapter/i }));
    expect(screen.getByText('John 2')).toBeInTheDocument();
    expect(onPassageChange).toHaveBeenLastCalledWith({ book: 'jhn', chapter: 2 });
  });

  it('disables previous at chapter 1 and reports verse selection', () => {
    const onSelectVerse = vi.fn();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} onSelectVerse={onSelectVerse} />);
    expect(screen.getByRole('button', { name: /previous chapter/i })).toBeDisabled();
    fireEvent.click(screen.getByText(/In the beginning was the Word/));
    expect(onSelectVerse).toHaveBeenLastCalledWith({ book: 'jhn', chapter: 1, verse: 1 });
  });

  it('shows a loading state', () => {
    useBiblePassages.mockReturnValue({ loading: true, error: null, verses: [] });
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('opens the navigator and jumps to a chosen book + chapter', () => {
    const onPassageChange = vi.fn();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} onPassageChange={onPassageChange} />);

    // Open navigator via the heading button.
    fireEvent.click(screen.getByRole('button', { name: /browse books/i }));

    // Pick a book (Genesis) then chapter 3.
    fireEvent.click(screen.getByRole('button', { name: /^Genesis$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^chapter 3$/i }));

    expect(screen.getByText('Genesis 3')).toBeInTheDocument();
    expect(onPassageChange).toHaveBeenLastCalledWith({ book: 'gen', chapter: 3 });
  });

  it('filters the book list as you type in the search bar', () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /browse books/i }));

    const search = screen.getByLabelText(/search books or verse/i);
    fireEvent.change(search, { target: { value: 'Samuel' } });

    // "Samuel" surfaces the numbered books without typing the number.
    expect(screen.getByRole('button', { name: /^1 Samuel$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2 Samuel$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Genesis$/ })).not.toBeInTheDocument();
  });

  it('offers a "Go to" jump for a typed verse reference and follows it', () => {
    const onPassageChange = vi.fn();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} onPassageChange={onPassageChange} />);
    fireEvent.click(screen.getByRole('button', { name: /browse books/i }));

    fireEvent.change(screen.getByLabelText(/search books or verse/i), {
      target: { value: 'Genesis 3:5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /go to genesis 3:5/i }));

    expect(screen.getByText('Genesis 3')).toBeInTheDocument();
    expect(onPassageChange).toHaveBeenLastCalledWith({ book: 'gen', chapter: 3 });
  });
});

describe('BibleReader translation selector', () => {
  it('renders a translation control and reports changes', () => {
    const onTranslationChange = vi.fn();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={onTranslationChange} />);
    const select = screen.getByLabelText('Translation') as HTMLSelectElement;
    expect(select.value).toBe('BSB');
    fireEvent.change(select, { target: { value: 'KJV' } });
    expect(onTranslationChange).toHaveBeenCalledWith('KJV');
  });

  it('exposes the active translation attribution', () => {
    render(<BibleReader translation="KJV" onTranslationChange={() => {}} />);
    expect(screen.getByLabelText('Translation info').getAttribute('title')).toMatch(/public domain/i);
  });
});

describe('BibleReader verse layout control', () => {
  it('renders the layout control labelled with the current mode', () => {
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="inline" onVerseLayoutChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /change verse layout \(currently inline\)/i })).toBeInTheDocument();
  });

  it('cycles inline -> lines on click', () => {
    const onVerseLayoutChange = vi.fn();
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="inline" onVerseLayoutChange={onVerseLayoutChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change verse layout/i }));
    expect(onVerseLayoutChange).toHaveBeenCalledWith('lines');
  });

  it('cycles spaced -> inline on click', () => {
    const onVerseLayoutChange = vi.fn();
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="spaced" onVerseLayoutChange={onVerseLayoutChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change verse layout/i }));
    expect(onVerseLayoutChange).toHaveBeenCalledWith('inline');
  });

  it('keeps verse anchors, text, and tap selection in spaced mode', () => {
    const onSelectVerse = vi.fn();
    const { container } = render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        verseLayout="spaced" onVerseLayoutChange={() => {}}
        onSelectVerse={onSelectVerse}
      />,
    );
    const verse1 = container.querySelector('#bible-verse-1') as HTMLElement;
    expect(verse1).not.toBeNull();
    expect(verse1.textContent).toMatch(/In the beginning was the Word/);
    fireEvent.click(screen.getByText(/In the beginning was the Word/));
    expect(onSelectVerse).toHaveBeenLastCalledWith({ book: 'jhn', chapter: 1, verse: 1 });
  });

  it('defaults to inline (joined prose) when no layout prop is given', () => {
    const { container } = render(
      <BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />,
    );
    // Inline mode renders the verses inside a <p>; block modes use a <div>.
    const verse1 = container.querySelector('#bible-verse-1') as HTMLElement;
    expect(verse1.closest('p')).not.toBeNull();
  });
});
