// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const bibleReaderProps = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: null }));
vi.mock('@/notepad/bible/BibleReader', () => ({
  // Lightweight stand-in for the real BibleReader. Mirrors its documented
  // contract (`memorizeEnabled = !!onAddToMemorize`) closely enough to
  // verify StudyReader's wiring without pulling in the full reader/data stack.
  BibleReader: (props: Record<string, unknown>) => {
    bibleReaderProps(props);
    const onSelectVerse = props.onSelectVerse as ((ref: unknown) => void) | undefined;
    const onAddToMemorize = props.onAddToMemorize as
      | ((ref: unknown, text: string) => void)
      | undefined;
    const ref = { book: props.initialBook, chapter: props.initialChapter, verse: 1 };
    return (
      <div>
        reader {String(props.initialBook)}:{String(props.initialChapter)}
        <button type="button" onClick={() => onSelectVerse?.(ref)}>
          verse 1
        </button>
        {onAddToMemorize && (
          <button type="button" onClick={() => onAddToMemorize(ref, 'sample text')}>
            Add to Memorize
          </button>
        )}
      </div>
    );
  },
}));
vi.mock('@/notepad/bible/useBibleTranslation', () => ({
  useBibleTranslation: () => ({ translation: 'BSB', setTranslation: vi.fn() }),
}));
vi.mock('@/auth/context/useAuthSession', () => ({
  useAuthSession: () => ({ user: null }),
}));

import { StudyReader } from './StudyReader';
import { BiblePrefsProvider } from '@/notepad/bible/prefs/BiblePrefsProvider';

beforeEach(() => {
  bibleReaderProps.mockReset();
});
afterEach(cleanup);

describe('StudyReader', () => {
  it('renders the BibleReader seeded with the open passage', () => {
    render(
      <BiblePrefsProvider>
        <StudyReader book="rom" chapter={8} onPassageChange={() => {}} />
      </BiblePrefsProvider>,
    );
    expect(screen.getByText('reader rom:8')).toBeTruthy();
  });
});

describe('StudyReader onSelectVerse', () => {
  it('forwards onSelectVerse to BibleReader', () => {
    const onSelectVerse = vi.fn();
    render(
      <BiblePrefsProvider>
        <StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} onSelectVerse={onSelectVerse} />
      </BiblePrefsProvider>,
    );
    const props = bibleReaderProps.mock.calls[0][0];
    expect(props.onSelectVerse).toBe(onSelectVerse);
  });

  it('still calls onSelectVerse when a verse is tapped (the study action is preserved)', () => {
    const onSelectVerse = vi.fn();
    render(
      <BiblePrefsProvider>
        <StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} onSelectVerse={onSelectVerse} />
      </BiblePrefsProvider>,
    );
    fireEvent.click(screen.getByText('verse 1'));
    expect(onSelectVerse).toHaveBeenCalledWith({ book: 'jhn', chapter: 3, verse: 1 });
  });
});

describe('StudyReader memorize popup removal', () => {
  it('does not show an Add to Memorize control when a verse is tapped', () => {
    render(
      <BiblePrefsProvider>
        <StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} />
      </BiblePrefsProvider>,
    );
    fireEvent.click(screen.getByText('verse 1'));
    expect(screen.queryByRole('button', { name: /add to memorize/i })).toBeNull();
    expect(screen.queryByText(/add to memorize/i)).toBeNull();
  });

  it('does not pass onAddToMemorize to BibleReader', () => {
    render(
      <BiblePrefsProvider>
        <StudyReader book="jhn" chapter={3} onPassageChange={vi.fn()} />
      </BiblePrefsProvider>,
    );
    const props = bibleReaderProps.mock.calls[0][0];
    expect(props.onAddToMemorize).toBeUndefined();
  });
});
