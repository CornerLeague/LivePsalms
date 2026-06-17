// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BookSuggestList } from './BookSuggestList';
import type { BookOrVerseItem } from './book-matcher';

const bookItems: BookOrVerseItem[] = [
  { kind: 'book', book: 'Ruth' },
  { kind: 'book', book: 'Romans' },
  { kind: 'book', book: 'Revelation' },
];

describe('BookSuggestList', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders one row per book and marks the selected one', () => {
    render(<BookSuggestList items={bookItems} selectedIndex={1} onSelect={() => {}} loading={false} hint={null} offline={false} />);
    expect(screen.getByText('Ruth')).toBeTruthy();
    expect(screen.getByText('Romans')).toBeTruthy();
    expect(screen.getByText('Revelation')).toBeTruthy();
    const selected = screen.getByText('Romans').closest('[role="option"]');
    expect(selected?.getAttribute('aria-selected')).toBe('true');
  });

  it('fires onSelect with the clicked item', () => {
    const onSelect = vi.fn();
    render(<BookSuggestList items={bookItems} selectedIndex={0} onSelect={onSelect} loading={false} hint={null} offline={false} />);
    fireEvent.click(screen.getByText('Revelation'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'book', book: 'Revelation' });
  });

  it('renders a resolved verse row with its reference and text', () => {
    const verse: BookOrVerseItem[] = [{
      kind: 'verse',
      candidate: { osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28, verseEnd: null, text: 'And we know…', translation: 'BSB', source: 'reference', score: 1 },
    }];
    render(<BookSuggestList items={verse} selectedIndex={0} onSelect={() => {}} loading={false} hint={null} offline={false} />);
    expect(screen.getByText('Romans 8:28')).toBeTruthy();
    expect(screen.getByText('And we know…')).toBeTruthy();
  });

  it('shows the hint when one is provided and there are no items', () => {
    render(<BookSuggestList items={[]} selectedIndex={0} onSelect={() => {}} loading={false} hint="Add chapter:verse, e.g. 8:28" offline={false} />);
    expect(screen.getByText('Add chapter:verse, e.g. 8:28')).toBeTruthy();
  });

  it('shows the offline message when offline', () => {
    render(<BookSuggestList items={[]} selectedIndex={0} onSelect={() => {}} loading={false} hint={null} offline={true} />);
    expect(screen.getByText('Verse search needs connection')).toBeTruthy();
  });
});
