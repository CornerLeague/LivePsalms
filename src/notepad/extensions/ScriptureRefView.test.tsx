// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ScriptureRefCard } from './ScriptureRefView';

// Repo vitest config has globals:false and no auto-cleanup, so RTL renders
// must be torn down between tests (matches the convention in other .test.tsx).
afterEach(cleanup);

const baseAttrs = {
  osis: 'jhn.3.16', book: 'John', chapter: 3, verseStart: 16, verseEnd: null,
  translation: 'BSB' as const, text: 'For God so loved the world',
};

describe('ScriptureRefCard', () => {
  it('renders collapsed by default as a reference label, without refetching present text', () => {
    const fetchVerseText = vi.fn();
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={fetchVerseText} />);
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
    expect(screen.queryByText(/For God so loved/)).toBeNull();
    expect(fetchVerseText).not.toHaveBeenCalled();
  });

  it('keeps the reference pill visible when expanded', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByText(/John 3:16/));
    // Pill stays AND the verse + translation are now revealed.
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    expect(screen.getByText('BSB')).toBeTruthy();
  });

  it('collapses again on a second click, hiding the verse but keeping the pill', () => {
    render(<ScriptureRefCard attrs={baseAttrs} online updateText={vi.fn()} fetchVerseText={vi.fn()} />);
    fireEvent.click(screen.getByText(/John 3:16/)); // expand
    expect(screen.getByText(/For God so loved/)).toBeTruthy();
    fireEvent.click(screen.getByText(/John 3:16/)); // collapse
    expect(screen.queryByText(/For God so loved/)).toBeNull();
    expect(screen.getByText(/John 3:16/)).toBeTruthy();
  });

  it('lazy-fills empty text when online and writes it back', async () => {
    const updateText = vi.fn();
    const fetchVerseText = vi.fn(async () => ({ text: 'Backfilled verse', translation: 'BSB', reference: 'John 3:16' }));
    render(<ScriptureRefCard attrs={{ ...baseAttrs, text: '' }} online updateText={updateText} fetchVerseText={fetchVerseText} />);
    await waitFor(() => expect(fetchVerseText).toHaveBeenCalledOnce());
    expect(updateText).toHaveBeenCalledWith('Backfilled verse');
  });

  it('does not lazy-fill when offline', () => {
    const fetchVerseText = vi.fn();
    render(<ScriptureRefCard attrs={{ ...baseAttrs, text: '' }} online={false} updateText={vi.fn()} fetchVerseText={fetchVerseText} />);
    expect(fetchVerseText).not.toHaveBeenCalled();
  });
});
