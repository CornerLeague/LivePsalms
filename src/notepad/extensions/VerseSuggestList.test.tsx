// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VerseSuggestList } from './VerseSuggestList';
import type { VerseCandidate } from '../bible/verse-search-types';

afterEach(cleanup);

const cand: VerseCandidate = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  text: 'For God so loved the world', translation: 'BSB', source: 'fts', score: 0.55,
};

describe('VerseSuggestList', () => {
  it('renders a row per candidate and fires onSelect on click', () => {
    const onSelect = vi.fn();
    render(<VerseSuggestList items={[cand]} selectedIndex={0} onSelect={onSelect} loading={false} offline={false} />);
    fireEvent.click(screen.getByText(/John 3:16/));
    expect(onSelect).toHaveBeenCalledWith(cand);
  });

  it('shows the passage label for ranged candidates', () => {
    const passage: VerseCandidate = { ...cand, osis: 'jhn.3.1', verseStart: 1, verseEnd: 21, label: 'John 3:1–21 · passage' };
    render(<VerseSuggestList items={[passage]} selectedIndex={0} onSelect={vi.fn()} loading={false} offline={false} />);
    expect(screen.getByText('John 3:1–21 · passage')).toBeTruthy();
  });

  it('renders the offline "needs connection" state', () => {
    render(<VerseSuggestList items={[]} selectedIndex={0} onSelect={vi.fn()} loading={false} offline />);
    expect(screen.getByText(/needs connection/i)).toBeTruthy();
  });

  it('renders a loading hint while semantic is pending', () => {
    render(<VerseSuggestList items={[cand]} selectedIndex={0} onSelect={vi.fn()} loading offline={false} />);
    expect(screen.getByText(/searching/i)).toBeTruthy();
  });

  it('renders a keep-typing hint when empty and not loading/offline', () => {
    render(<VerseSuggestList items={[]} selectedIndex={0} onSelect={vi.fn()} loading={false} offline={false} />);
    expect(screen.getByText(/keep typing/i)).toBeTruthy();
  });

  it('marks the selected row with is-selected class and aria-selected', () => {
    const second: VerseCandidate = { ...cand, osis: 'rom.8.28', book: 'Romans', chapter: 8, verseStart: 28 };
    render(<VerseSuggestList items={[cand, second]} selectedIndex={1} onSelect={vi.fn()} loading={false} offline={false} />);
    const rows = screen.getAllByRole('option');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].classList.contains('is-selected')).toBe(true);
    expect(rows[0].getAttribute('aria-selected')).toBe('false');
  });

  it('shows only the searching hint when loading with no items yet', () => {
    render(<VerseSuggestList items={[]} selectedIndex={0} onSelect={vi.fn()} loading offline={false} />);
    expect(screen.getByText(/searching/i)).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText(/keep typing/i)).toBeNull();
  });
});
