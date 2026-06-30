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

// jsdom doesn't implement ResizeObserver — stub it for Radix Tooltip.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

const useBiblePassages = vi.fn();
vi.mock('./useBiblePassages', () => ({ useBiblePassages: (...a: unknown[]) => useBiblePassages(...a) }));
vi.mock('sonner', () => ({ toast: vi.fn() }));

import { BibleReader } from './BibleReader';
import { toast } from 'sonner';
import type { BibleReaderFocusBridge } from './BibleReader';
import type { FocusList } from './focus/focus-list-types';

beforeEach(() => {
  useBiblePassages.mockReset();
  vi.mocked(toast).mockClear();
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

  it('fires a device-only toast nudge when the version is changed in the reader', () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'KJV' } });
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('on this device'));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('KJV'));
  });

  it('shows a device-only tooltip on the translation info affordance', async () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    fireEvent.focus(screen.getByLabelText('Translation info'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/applies to this device only/i);
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

  it('exposes the active translation attribution', async () => {
    render(<BibleReader translation="KJV" onTranslationChange={() => {}} />);
    fireEvent.focus(screen.getByLabelText('Translation info'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(/public domain/i);
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

const quickList: FocusList = { id: '__quick__', title: 'Quick list', position: -1, items: [] };

function makeBridge(over: Partial<BibleReaderFocusBridge> = {}): BibleReaderFocusBridge {
  return {
    focusModeOn: false,
    onToggleFocusMode: vi.fn(),
    activeList: quickList,
    onAddCurrentVerse: vi.fn(),
    renderFocusBody: () => <div data-testid="focus-body">FOCUS BODY</div>,
    ...over,
  };
}

describe('BibleReader focus bridge', () => {
  it('renders no focus toggle when no focus prop is given', () => {
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /focus list/i })).not.toBeInTheDocument();
  });

  it('renders the focus toggle and reports a click', () => {
    const bridge = makeBridge();
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} focus={bridge} />);
    fireEvent.click(screen.getByRole('button', { name: /focus list/i }));
    expect(bridge.onToggleFocusMode).toHaveBeenCalled();
  });

  it('renders the focus body (not the chapter) when focus mode is on', () => {
    const bridge = makeBridge({ focusModeOn: true });
    render(<BibleReader initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}} focus={bridge} />);
    expect(screen.getByTestId('focus-body')).toBeInTheDocument();
    expect(screen.queryByText(/In the beginning was the Word/)).not.toBeInTheDocument();
  });

  it('adds the current verse to the active list without selecting it', () => {
    const bridge = makeBridge();
    const onSelectVerse = vi.fn();
    render(
      <BibleReader
        initialBook="jhn" initialChapter={1} translation="BSB" onTranslationChange={() => {}}
        focus={bridge} onSelectVerse={onSelectVerse}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add John 1:1 to Quick list/i }));
    expect(bridge.onAddCurrentVerse).toHaveBeenCalledWith({
      book: 'jhn', chapter: 1, verseStart: 1, verseEnd: 1, label: 'John 1:1',
    });
    expect(onSelectVerse).not.toHaveBeenCalled(); // stopPropagation kept the tap off the verse
  });
});
